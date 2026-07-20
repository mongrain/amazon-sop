const { queryAll, queryOne, runSql } = require('../../database');
const tokenPool = require('./token-pool');
const { kickWorker } = require('./job-runner');

const ASIN_RE = /^[A-Z0-9]{10}$/;
const MAX_ASINS = Number(process.env.SEARCHAPI_MAX_ASINS_PER_JOB || 500);

function mapJobRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        status: row.status,
        amazon_domain: row.amazon_domain,
        total_count: row.total_count,
        success_count: row.success_count,
        fail_count: row.fail_count,
        created_by: row.created_by,
        error_message: row.error_message,
        created_at: row.created_at,
        started_at: row.started_at,
        finished_at: row.finished_at
    };
}

function parseAsinInput(text) {
    const lines = String(text || '').split(/\r?\n/);
    const asins = [];
    const seen = new Set();
    const warnings = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;
        const asin = raw.toUpperCase();
        if (!ASIN_RE.test(asin)) {
            warnings.push(`第 ${i + 1} 行 ASIN 无效: ${raw}`);
            continue;
        }
        if (seen.has(asin)) continue;
        seen.add(asin);
        asins.push(asin);
    }

    if (asins.length > MAX_ASINS) {
        throw new Error(`单次任务最多 ${MAX_ASINS} 个 ASIN`);
    }

    return { asins, warnings };
}

async function createJob({ asinsText, amazonDomain, createdBy }) {
    const activeCount = await tokenPool.countActiveTokens();
    if (activeCount <= 0) {
        throw new Error('无可用 SearchAPI token，请先添加 token');
    }

    const { asins, warnings } = parseAsinInput(asinsText);
    if (!asins.length) {
        throw new Error('未找到有效 ASIN');
    }

    const domain = String(amazonDomain || 'amazon.com').trim() || 'amazon.com';
    const jobResult = await runSql(
        `INSERT INTO asin_crawl_jobs (status, amazon_domain, total_count, created_by)
         VALUES ('pending', ?, ?, ?)`,
        [domain, asins.length, createdBy || null]
    );
    const jobId = jobResult.insertId;

    for (const asin of asins) {
        await runSql(
            `INSERT INTO asin_crawl_items (job_id, asin, status) VALUES (?, ?, 'pending')`,
            [jobId, asin]
        );
    }

    kickWorker();

    const job = await getJob(jobId);
    return { job, warnings };
}

async function listJobs({ limit = 20, offset = 0 } = {}) {
    const rows = await queryAll(
        `SELECT * FROM asin_crawl_jobs
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [Number(limit), Number(offset)]
    );
    return rows.map(mapJobRow);
}

async function getJob(id) {
    const row = await queryOne('SELECT * FROM asin_crawl_jobs WHERE id = ?', [Number(id)]);
    return mapJobRow(row);
}

async function listJobItems(jobId) {
    return queryAll(
        `SELECT id, job_id, asin, status, error_message, token_id, created_at, finished_at,
                (raw_json IS NOT NULL) AS has_json
         FROM asin_crawl_items
         WHERE job_id = ?
         ORDER BY id ASC`,
        [Number(jobId)]
    );
}

async function getJobItemJson(itemId) {
    const row = await queryOne(
        `SELECT id, job_id, asin, status, raw_json FROM asin_crawl_items WHERE id = ?`,
        [Number(itemId)]
    );
    if (!row) return null;
    if (!row.raw_json) {
        throw new Error('暂无 JSON 数据');
    }
    const data = typeof row.raw_json === 'string'
        ? JSON.parse(row.raw_json)
        : row.raw_json;
    return {
        id: row.id,
        job_id: row.job_id,
        asin: row.asin,
        status: row.status,
        data
    };
}

async function cancelJob(jobId) {
    const job = await getJob(jobId);
    if (!job) return null;
    if (!['pending', 'running'].includes(job.status)) {
        throw new Error('只能取消进行中的任务');
    }

    await runSql(
        `UPDATE asin_crawl_items
         SET status = 'failed',
             error_message = '任务已取消',
             finished_at = NOW()
         WHERE job_id = ? AND status IN ('pending', 'processing')`,
        [Number(jobId)]
    );
    await runSql(
        `UPDATE asin_crawl_jobs
         SET status = 'cancelled',
             finished_at = NOW(),
             error_message = COALESCE(error_message, '任务已取消')
         WHERE id = ? AND status IN ('pending', 'running')`,
        [Number(jobId)]
    );

    return getJob(jobId);
}

module.exports = {
    parseAsinInput,
    createJob,
    listJobs,
    getJob,
    listJobItems,
    getJobItemJson,
    cancelJob
};
