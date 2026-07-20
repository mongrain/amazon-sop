const tokenPool = require('../token-pool');
const { fetchAmazonProduct, isTokenExhaustedError, isRetryableError } = require('../searchapi');
const { flattenForCsv } = require('./flatten');
const asinCache = require('./asin-cache');

const REQUEST_INTERVAL_MS = Number(process.env.SEARCHAPI_REQUEST_INTERVAL_MS || 2000);
const RETRY_DELAY_MS = 3000;
const MAX_NETWORK_RETRIES = 2;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class IntervalRateLimiter {
    constructor(minIntervalMs) {
        this.minIntervalMs = minIntervalMs;
        this.lastAt = 0;
        this.chain = Promise.resolve();
    }

    schedule(task) {
        this.chain = this.chain.then(async () => {
            const now = Date.now();
            const wait = Math.max(0, this.lastAt + this.minIntervalMs - now);
            if (wait > 0) await sleep(wait);
            this.lastAt = Date.now();
            return task();
        });
        return this.chain;
    }
}

const rateLimiter = new IntervalRateLimiter(REQUEST_INTERVAL_MS);

let dbCtx = null;
let workerBusy = false;
let workerScheduled = false;

function initAsinCrawlerRunner(ctx) {
    dbCtx = ctx;
}

function kickWorker() {
    if (!dbCtx || workerBusy || workerScheduled) return;
    workerScheduled = true;
    setImmediate(() => {
        workerScheduled = false;
        runWorkerLoop().catch((error) => {
            console.error('[asin-crawler] worker error:', error);
        });
    });
}

async function claimNextItem() {
    const item = await dbCtx.queryOne(
        `SELECT i.id, i.job_id, i.asin, j.amazon_domain, j.status AS job_status
         FROM asin_crawl_items i
         INNER JOIN asin_crawl_jobs j ON j.id = i.job_id
         WHERE i.status = 'pending'
           AND j.status IN ('pending', 'running')
         ORDER BY i.id ASC
         LIMIT 1`
    );
    if (!item) return null;

    const claimed = await dbCtx.runSql(
        `UPDATE asin_crawl_items
         SET status = 'processing'
         WHERE id = ? AND status = 'pending'`,
        [item.id]
    );
    if (!claimed || !claimed.affectedRows) return null;
    return item;
}

async function ensureJobRunning(jobId) {
    await dbCtx.runSql(
        `UPDATE asin_crawl_jobs
         SET status = 'running',
             started_at = COALESCE(started_at, NOW())
         WHERE id = ? AND status = 'pending'`,
        [jobId]
    );
}

async function markItemSuccess(itemId, jobId, tokenId, rawData) {
    const flat = flattenForCsv(rawData);
    await dbCtx.runSql(
        `UPDATE asin_crawl_items
         SET status = 'success',
             raw_json = ?,
             flat_json = ?,
             token_id = ?,
             error_message = NULL,
             finished_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(rawData), JSON.stringify(flat), tokenId, itemId]
    );
    await dbCtx.runSql(
        `UPDATE asin_crawl_jobs
         SET success_count = success_count + 1
         WHERE id = ?`,
        [jobId]
    );
}

async function markItemFailed(itemId, jobId, errorMessage) {
    const message = String(errorMessage || '').slice(0, 500);
    await dbCtx.runSql(
        `UPDATE asin_crawl_items
         SET status = 'failed',
             error_message = ?,
             finished_at = NOW()
         WHERE id = ?`,
        [message, itemId]
    );
    await dbCtx.runSql(
        `UPDATE asin_crawl_jobs
         SET fail_count = fail_count + 1
         WHERE id = ?`,
        [jobId]
    );
}

async function markJobFailed(jobId, errorMessage) {
    const message = String(errorMessage || '').slice(0, 1000);
    await dbCtx.runSql(
        `UPDATE asin_crawl_jobs
         SET status = 'failed',
             error_message = ?,
             finished_at = NOW()
         WHERE id = ? AND status IN ('pending', 'running')`,
        [message, jobId]
    );
}

async function finalizeJobIfDone(jobId) {
    const pending = await dbCtx.queryOne(
        `SELECT id FROM asin_crawl_items
         WHERE job_id = ? AND status IN ('pending', 'processing')
         LIMIT 1`,
        [jobId]
    );
    if (pending) return;

    const job = await dbCtx.queryOne(
        'SELECT success_count, fail_count, total_count FROM asin_crawl_jobs WHERE id = ?',
        [jobId]
    );
    if (!job) return;

    const status = Number(job.success_count) > 0 ? 'completed' : 'failed';
    const errorMessage = status === 'failed' && Number(job.success_count) === 0
        ? '全部 ASIN 爬取失败'
        : null;

    await dbCtx.runSql(
        `UPDATE asin_crawl_jobs
         SET status = ?,
             error_message = COALESCE(error_message, ?),
             finished_at = NOW()
         WHERE id = ? AND status IN ('pending', 'running')`,
        [status, errorMessage, jobId]
    );
}

async function executeItem(item) {
    await ensureJobRunning(item.job_id);

    const job = await dbCtx.queryOne(
        'SELECT status FROM asin_crawl_jobs WHERE id = ?',
        [item.job_id]
    );
    if (!job || !['pending', 'running'].includes(job.status)) {
        await dbCtx.runSql(
            `UPDATE asin_crawl_items SET status = 'pending' WHERE id = ? AND status = 'processing'`,
            [item.id]
        );
        return;
    }

    const cached = await asinCache.getTodayCache(item.asin, item.amazon_domain);
    if (cached?.raw) {
        await markItemSuccess(item.id, item.job_id, null, cached.raw);
        await finalizeJobIfDone(item.job_id);
        return;
    }

    await rateLimiter.schedule(async () => {
        const triedTokenIds = new Set();
        let networkRetries = 0;
        let lastError = '';

        while (true) {
            const token = await tokenPool.acquireToken();
            if (!token) {
                lastError = '无可用 SearchAPI token，请添加或重置 token';
                await markItemFailed(item.id, item.job_id, lastError);
                await markJobFailed(item.job_id, lastError);
                return;
            }
            if (triedTokenIds.has(token.id)) {
                lastError = lastError || '全部 SearchAPI token 已失效，请添加或重置 token';
                await markItemFailed(item.id, item.job_id, lastError);
                await markJobFailed(item.job_id, lastError);
                return;
            }

            triedTokenIds.add(token.id);

            try {
                await tokenPool.touchTokenUsed(token.id);
                const rawData = await fetchAmazonProduct({
                    asin: item.asin,
                    amazonDomain: item.amazon_domain,
                    apiKey: token.token
                });
                const flat = flattenForCsv(rawData);
                await asinCache.setTodayCache(item.asin, item.amazon_domain, rawData, flat);
                await markItemSuccess(item.id, item.job_id, token.id, rawData);
                await finalizeJobIfDone(item.job_id);
                return;
            } catch (error) {
                lastError = String(error.message || error);

                if (isTokenExhaustedError(error)) {
                    await tokenPool.markTokenExhausted(token.id, lastError);
                    continue;
                }

                if (isRetryableError(error) && networkRetries < MAX_NETWORK_RETRIES) {
                    networkRetries += 1;
                    await tokenPool.recordTokenFailure(token.id, lastError);
                    await sleep(RETRY_DELAY_MS);
                    continue;
                }

                await markItemFailed(item.id, item.job_id, lastError);
                await finalizeJobIfDone(item.job_id);
                return;
            }
        }
    });
}

async function runWorkerLoop() {
    if (!dbCtx || workerBusy) return;
    workerBusy = true;
    try {
        while (true) {
            const item = await claimNextItem();
            if (!item) break;
            try {
                await executeItem(item);
            } catch (error) {
                console.error(`[asin-crawler] item ${item.id} failed:`, error.message || error);
            }
        }
    } finally {
        workerBusy = false;
        const pending = await dbCtx.queryOne(
            `SELECT i.id
             FROM asin_crawl_items i
             INNER JOIN asin_crawl_jobs j ON j.id = i.job_id
             WHERE i.status = 'pending' AND j.status IN ('pending', 'running')
             LIMIT 1`
        );
        if (pending) kickWorker();
    }
}

async function resumeStuckJobs() {
    if (!dbCtx) return;

    await dbCtx.runSql(
        `UPDATE asin_crawl_items SET status = 'pending' WHERE status = 'processing'`
    );
    await dbCtx.runSql(
        `UPDATE asin_crawl_jobs SET status = 'pending' WHERE status = 'running'`
    );
    kickWorker();
}

module.exports = {
    initAsinCrawlerRunner,
    kickWorker,
    resumeStuckJobs
};
