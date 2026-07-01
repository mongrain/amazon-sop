const { getSellTime, siteToStation, ERR_GLOBAL_403, ERR_ROBOT_CHECK } = require('./get-sell-time');
const { computeOperatingStartedAtFromTotalDays } = require('./operating-days');

const REQUEST_INTERVAL_MS = 35000;
const ABORT_403_MESSAGE = 'SellerSprite 返回 ERR_GLOBAL_403，已终止后续抓取';

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
let apiForbidden403 = false;

function initOperatingDaysQueue(ctx) {
    dbCtx = ctx;
}

function isSellTimeBlocked403() {
    return apiForbidden403;
}

async function abortQueueDueTo403(message) {
    if (!dbCtx) return;
    apiForbidden403 = true;
    await dbCtx.runSql(
        `UPDATE product_operating_days_tasks
         SET status = 'failed', error_message = ?, updated_at = NOW()
         WHERE status IN ('pending', 'processing')`,
        [message.slice(0, 2000)]
    );
    console.error('[operating-days] ERR_GLOBAL_403，已终止后续抓取:', message);
}

function kickWorker() {
    if (!dbCtx || workerBusy || workerScheduled || apiForbidden403) return;
    workerScheduled = true;
    setImmediate(() => {
        workerScheduled = false;
        runWorkerLoop().catch((error) => {
            console.error('[operating-days] worker error:', error);
        });
    });
}

async function claimNextTask() {
    const task = await dbCtx.queryOne(
        `SELECT id, product_id, asin, station
         FROM product_operating_days_tasks
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT 1`
    );
    if (!task) return null;

    const claimed = await dbCtx.runSql(
        `UPDATE product_operating_days_tasks
         SET status = 'processing', updated_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [task.id]
    );
    if (!claimed || !claimed.affectedRows) return null;
    return task;
}

async function executeTask(task) {
    await rateLimiter.schedule(async () => {
        try {
            const existing = await dbCtx.queryOne(
                'SELECT operating_started_at FROM products WHERE id = ?',
                [task.product_id]
            );
            if (existing?.operating_started_at) {
                await dbCtx.runSql(
                    `UPDATE product_operating_days_tasks
                     SET status = 'done', operating_started_at = ?, error_message = NULL, updated_at = NOW()
                     WHERE id = ?`,
                    [existing.operating_started_at, task.id]
                );
                return;
            }

            const result = await getSellTime({ asin: task.asin, station: task.station });
            const totalDays = result?.data?.totalDays;
            if (totalDays == null || Number.isNaN(Number(totalDays))) {
                throw new Error('接口未返回有效的 data.totalDays');
            }

            const startedAt = computeOperatingStartedAtFromTotalDays(totalDays);
            if (!startedAt) {
                throw new Error('无法根据 totalDays 计算运营开始时间');
            }

            await dbCtx.runSql(
                'UPDATE products SET operating_started_at = ?, updated_at = NOW() WHERE id = ?',
                [startedAt, task.product_id]
            );
            await dbCtx.runSql(
                `UPDATE product_operating_days_tasks
                 SET status = 'done', operating_started_at = ?, error_message = NULL, updated_at = NOW()
                 WHERE id = ?`,
                [startedAt, task.id]
            );
        } catch (error) {
            const code = error.code || error.response?.data?.code;
            if (code === ERR_GLOBAL_403 || code === ERR_ROBOT_CHECK) {
                const message = String(error.message || ABORT_403_MESSAGE);
                await abortQueueDueTo403(message);
                throw error;
            }

            const message = String(error.message || error);
            console.error(`[operating-days] task ${task.id} ASIN ${task.asin} failed:`, message);
            await dbCtx.runSql(
                `UPDATE product_operating_days_tasks
                 SET status = 'failed', error_message = ?, updated_at = NOW()
                 WHERE id = ?`,
                [message.slice(0, 2000), task.id]
            );
        }
    });
}

async function runWorkerLoop() {
    if (!dbCtx || workerBusy || apiForbidden403) return;
    workerBusy = true;
    try {
        while (!apiForbidden403) {
            const task = await claimNextTask();
            if (!task) break;
            try {
                await executeTask(task);
            } catch (error) {
                if (apiForbidden403 || error.code === ERR_GLOBAL_403) break;
            }
        }
    } finally {
        workerBusy = false;
        if (!apiForbidden403) {
            const pending = await dbCtx.queryOne(
                `SELECT id FROM product_operating_days_tasks WHERE status = 'pending' LIMIT 1`
            );
            if (pending) kickWorker();
        }
    }
}

/**
 * 新增产品后写入运营开始日期抓取任务；已有运营开始日期则跳过。
 */
async function enqueueOperatingDaysTask({ productId, asin, seq, station }) {
    if (!dbCtx || apiForbidden403) return;
    const pid = Number(productId);
    const asinText = String(asin || '').trim().toUpperCase();
    if (!pid || !asinText) return;

    const product = await dbCtx.queryOne(
        'SELECT operating_started_at FROM products WHERE id = ?',
        [pid]
    );
    if (product?.operating_started_at) return;

    const resolvedStation = station ? String(station).toUpperCase() : siteToStation(seq);
    await dbCtx.runSql(
        `INSERT INTO product_operating_days_tasks (product_id, asin, station, status)
         VALUES (?, ?, ?, 'pending')
         ON DUPLICATE KEY UPDATE
            asin = VALUES(asin),
            station = VALUES(station),
            status = IF(status = 'done', status, 'pending'),
            error_message = NULL,
            updated_at = NOW()`,
        [pid, asinText, resolvedStation]
    );
    kickWorker();
}

function startOperatingDaysWorker() {
    kickWorker();
}

/**
 * 将缺少运营开始日期的未放弃产品加入抓取队列。
 */
async function enqueueOperatingDaysForAllActiveProducts() {
    if (!dbCtx) throw new Error('运营天数队列未初始化');

    apiForbidden403 = false;

    const allActive = await dbCtx.queryAll(
        `SELECT id, asin, seq, operating_started_at FROM products WHERE status != '已放弃' ORDER BY id ASC`
    );
    const products = (allActive || []).filter(p => !p.operating_started_at);

    for (const product of products) {
        const asinText = String(product.asin || '').trim().toUpperCase();
        if (!asinText) continue;

        const station = siteToStation(product.seq);
        await dbCtx.runSql(
            `INSERT INTO product_operating_days_tasks (product_id, asin, station, status)
             VALUES (?, ?, ?, 'pending')
             ON DUPLICATE KEY UPDATE
                asin = VALUES(asin),
                station = VALUES(station),
                status = IF(status = 'done', status, 'pending'),
                error_message = NULL,
                updated_at = NOW()`,
            [product.id, asinText, station]
        );
    }

    kickWorker();
    return {
        total: (allActive || []).length,
        enqueued: products.length,
        skipped: (allActive || []).length - products.length
    };
}

module.exports = {
    initOperatingDaysQueue,
    enqueueOperatingDaysTask,
    enqueueOperatingDaysForAllActiveProducts,
    startOperatingDaysWorker,
    isSellTimeBlocked403
};
