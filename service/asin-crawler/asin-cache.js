const { queryOne, runSql } = require('../../database');

async function getTodayCache(asin, amazonDomain) {
    const row = await queryOne(
        `SELECT raw_json, flat_json FROM asin_crawl_cache
         WHERE asin = ? AND amazon_domain = ? AND cache_date = CURDATE()`,
        [String(asin || '').trim().toUpperCase(), amazonDomain || 'amazon.com']
    );
    if (!row) return null;
    return {
        raw: typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json,
        flat: typeof row.flat_json === 'string' ? JSON.parse(row.flat_json) : row.flat_json
    };
}

async function setTodayCache(asin, amazonDomain, rawData, flatData) {
    const asinText = String(asin || '').trim().toUpperCase();
    const domain = amazonDomain || 'amazon.com';
    await runSql(
        `INSERT INTO asin_crawl_cache (asin, amazon_domain, cache_date, raw_json, flat_json)
         VALUES (?, ?, CURDATE(), ?, ?)
         ON DUPLICATE KEY UPDATE
            raw_json = VALUES(raw_json),
            flat_json = VALUES(flat_json),
            cached_at = NOW()`,
        [asinText, domain, JSON.stringify(rawData), JSON.stringify(flatData)]
    );
}

module.exports = {
    getTodayCache,
    setTodayCache
};
