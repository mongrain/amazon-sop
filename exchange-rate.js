/**
 * USD/CNY 汇率：每日拉取一次，失败时使用缓存
 */

const PAIR = 'USD/CNY';

async function fetchRateFromApi() {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=CNY');
    if (!res.ok) throw new Error('汇率 API 请求失败: ' + res.status);
    const data = await res.json();
    const rate = data && data.rates && data.rates.CNY;
    if (!rate || !Number.isFinite(rate)) throw new Error('汇率 API 返回无效数据');
    return Number(rate);
}

async function getCachedRate(queryOne) {
    const row = await queryOne('SELECT rate, fetched_at FROM exchange_rates WHERE pair = ?', [PAIR]);
    if (!row) return null;
    return { rate: Number(row.rate), fetched_at: row.fetched_at };
}

async function saveRate(runSql, rate) {
    await runSql(
        `INSERT INTO exchange_rates (pair, rate, fetched_at) VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE rate = VALUES(rate), fetched_at = NOW()`,
        [PAIR, rate]
    );
}

function isStale(fetchedAt) {
    if (!fetchedAt) return true;
    const ts = new Date(fetchedAt).getTime();
    if (Number.isNaN(ts)) return true;
    return Date.now() - ts > 24 * 60 * 60 * 1000;
}

async function getUsdCnyRate({ queryOne, runSql, forceRefresh = false }) {
    const cached = await getCachedRate(queryOne);
    if (!forceRefresh && cached && !isStale(cached.fetched_at)) {
        return { rate: cached.rate, fetched_at: cached.fetched_at, source: 'cache' };
    }
    try {
        const rate = await fetchRateFromApi();
        await saveRate(runSql, rate);
        const updated = await getCachedRate(queryOne);
        return { rate, fetched_at: updated ? updated.fetched_at : new Date().toISOString(), source: 'api' };
    } catch (e) {
        if (cached && cached.rate) {
            return { rate: cached.rate, fetched_at: cached.fetched_at, source: 'cache_fallback', error: e.message };
        }
        return { rate: 7.2, fetched_at: null, source: 'default_fallback', error: e.message };
    }
}

module.exports = { getUsdCnyRate, PAIR };
