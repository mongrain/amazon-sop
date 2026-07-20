require('dotenv').config();
const fs = require('fs');
const path = require('path');
const tokenPool = require('./asin-crawler/token-pool');
const { fetchSearchApi, isTokenExhaustedError, isRetryableError } = require('./asin-crawler/searchapi');

const CACHE_ROOT = path.join(__dirname, '../data/google-trends/cache');
const CACHE_TTL_MS = Number(process.env.GOOGLE_TRENDS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const REQUEST_INTERVAL_MS = Number(
    process.env.GOOGLE_TRENDS_REQUEST_INTERVAL_MS ||
    process.env.SEARCHAPI_REQUEST_INTERVAL_MS ||
    3000
);
const DEFAULT_GEO = String(process.env.GOOGLE_TRENDS_GEO || 'US').trim().toUpperCase();
const DEFAULT_HL = String(process.env.GOOGLE_TRENDS_HL || 'en-US').trim();
const DEFAULT_TZ = Number(process.env.GOOGLE_TRENDS_TZ || 360);
/** SearchAPI TIMESERIES 单次最多 5 个关键词 */
const BATCH_SIZE = Math.min(5, Math.max(1, Number(process.env.GOOGLE_TRENDS_BATCH_SIZE || 5)));

const INTERVAL_TIME_MAP = {
    h: 'now 1-H',
    d: 'now 1-d',
    w: 'today 3-m',
    m: 'today 12-m',
    y: 'today 5-y'
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeKeyword(keyword) {
    return String(keyword || '').trim();
}

function normalizeInterval(interval) {
    const value = String(interval || 'w').trim().toLowerCase();
    return value || 'w';
}

function resolveGoogleTime(interval) {
    const value = normalizeInterval(interval);
    if (INTERVAL_TIME_MAP[value]) return INTERVAL_TIME_MAP[value];
    if (/\d{4}-\d{2}-\d{2}\s+\d{4}-\d{2}-\d{2}/.test(value)) return value;
    if (/^(now|today|all)\b/i.test(value)) return value;
    return INTERVAL_TIME_MAP.w;
}

function getCachePath(keyword, interval, geo) {
    const safeKey = encodeURIComponent(`${geo}:${keyword.toLowerCase()}`);
    return path.join(CACHE_ROOT, `${safeKey}_${interval}.json`);
}

function readCache(keyword, interval, geo, { allowStale = false } = {}) {
    const cachePath = getCachePath(keyword, interval, geo);
    if (!fs.existsSync(cachePath)) return null;
    try {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (!cached || !Array.isArray(cached.data)) return null;
        const cachedAt = cached.cached_at ? new Date(cached.cached_at).getTime() : NaN;
        if (!allowStale && (Number.isNaN(cachedAt) || Date.now() - cachedAt > CACHE_TTL_MS)) return null;
        return cached;
    } catch (e) {
        return null;
    }
}

function writeCache(keyword, interval, geo, payload) {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    const cachePath = getCachePath(keyword, interval, geo);
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
}

function formatRequestError(error) {
    if (!error) return '未知错误';
    if (error.response) {
        const status = error.response.status;
        const body = error.response.data;
        const detail = typeof body === 'string'
            ? body.slice(0, 120).replace(/\s+/g, ' ')
            : (body?.error || body?.message || '');
        if (status === 401 || status === 403) {
            return 'SearchAPI token 无效或额度已用尽，请在 ASIN 爬虫页面添加或重置 token';
        }
        return `SearchAPI 返回 HTTP ${status}${detail ? `：${detail}` : ''}`;
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return 'SearchAPI 请求超时';
    }
    return error.message || '未知错误';
}

function chunkArray(list, size) {
    const chunks = [];
    for (let i = 0; i < list.length; i += size) {
        chunks.push(list.slice(i, i + size));
    }
    return chunks;
}

function mapSearchApiTimeline(timeline, keyword) {
    const normalizedKeyword = normalizeKeyword(keyword).toLowerCase();
    return timeline.map(row => {
        const values = Array.isArray(row.values) ? row.values : [];
        let entry = values.find(item => String(item.query || '').trim().toLowerCase() === normalizedKeyword);
        if (!entry && values.length === 1) entry = values[0];
        const value = Number(entry?.extracted_value ?? entry?.value ?? 0);
        const timestamp = Number(row.timestamp);
        const date = Number.isFinite(timestamp)
            ? new Date(timestamp * 1000).toISOString().slice(0, 10)
            : '';
        return {
            date,
            time: row.timestamp,
            formattedTime: row.date || date,
            searches: Number.isFinite(value) ? value : 0,
            value: Number.isFinite(value) ? value : 0,
            formattedValue: entry?.value != null ? String(entry.value) : String(Number.isFinite(value) ? value : 0),
            empty: false
        };
    });
}

/**
 * 批量拉取关键词趋势（SearchAPI 单次最多 5 个，用逗号拼接）
 * @returns {Promise<Map<string, object>>} keyword -> { code, message, success, data }
 */
async function fetchTrendsBatchFromSearchApi(keywords, interval, geo) {
    const list = keywords.map(normalizeKeyword).filter(Boolean);
    if (!list.length) {
        throw new Error('关键词不能为空');
    }
    if (list.length > BATCH_SIZE) {
        throw new Error(`单次 SearchAPI 请求最多 ${BATCH_SIZE} 个关键词`);
    }

    const activeCount = await tokenPool.countActiveTokens();
    if (activeCount <= 0) {
        throw new Error('无可用 SearchAPI token，请先在 ASIN 爬虫页面添加 token');
    }

    const triedTokenIds = new Set();
    let lastError = '';

    while (true) {
        const token = await tokenPool.acquireToken();
        if (!token) {
            throw new Error(lastError || '无可用 SearchAPI token，请先在 ASIN 爬虫页面添加 token');
        }
        if (triedTokenIds.has(token.id)) {
            throw new Error(lastError || '全部 SearchAPI token 已失效，请添加或重置 token');
        }
        triedTokenIds.add(token.id);

        try {
            await tokenPool.touchTokenUsed(token.id);
            const params = {
                engine: 'google_trends',
                q: list.join(','),
                data_type: 'TIMESERIES',
                geo,
                time: resolveGoogleTime(interval),
                hl: DEFAULT_HL,
                tz: DEFAULT_TZ
            };
            const data = await fetchSearchApi({ params, apiKey: token.token });
            const timeline = data.interest_over_time && Array.isArray(data.interest_over_time.timeline_data)
                ? data.interest_over_time.timeline_data
                : [];
            if (!timeline.length) {
                throw new Error('SearchAPI 未返回 interest_over_time 数据');
            }

            const resultMap = new Map();
            for (const keyword of list) {
                resultMap.set(keyword, {
                    code: 'OK',
                    message: 'Google Trends relative interest via SearchAPI, scaled 0-100',
                    success: true,
                    data: mapSearchApiTimeline(timeline, keyword)
                });
            }
            return resultMap;
        } catch (error) {
            lastError = formatRequestError(error);
            if (isTokenExhaustedError(error)) {
                await tokenPool.markTokenExhausted(token.id, lastError);
                continue;
            }
            if (isRetryableError(error)) {
                await tokenPool.recordTokenFailure(token.id, lastError);
                await sleep(3000);
                continue;
            }
            throw new Error(lastError);
        }
    }
}

class RateLimiter {
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

const rateLimiter = new RateLimiter(REQUEST_INTERVAL_MS);

function buildCachedResult(keyword, interval, geo, cached, source) {
    return {
        keyword,
        interval,
        geo,
        code: cached.code,
        message: cached.message,
        success: cached.success,
        data: cached.data,
        source,
        cached_at: cached.cached_at
    };
}

function buildErrorResult(keyword, interval, geo, message) {
    return {
        keyword,
        interval,
        geo,
        code: 'ERROR',
        message,
        success: false,
        data: [],
        source: 'error',
        error: message
    };
}

async function getGoogleTrends(keyword, interval = 'w', { forceRefresh = false, geo = DEFAULT_GEO } = {}) {
    const batch = await getGoogleTrendsBatch([keyword], { interval, forceRefresh, geo });
    const result = batch.results[0];
    if (!result) throw new Error('关键词不能为空');
    if (!result.success) throw new Error(result.error || result.message || 'Google Trends 请求失败');
    return result;
}

function parseKeywords(input) {
    if (Array.isArray(input)) {
        return [...new Set(input.map(normalizeKeyword).filter(Boolean))];
    }
    return [...new Set(
        String(input || '')
            .split(/[\n,，;；\t]+/)
            .map(normalizeKeyword)
            .filter(Boolean)
    )];
}

async function getGoogleTrendsBatch(keywords, options = {}) {
    const list = parseKeywords(keywords);
    if (!list.length) {
        throw new Error('请至少提供一个关键词');
    }
    if (list.length > 5000) {
        throw new Error('单次最多查询 5000 个关键词');
    }

    const interval = normalizeInterval(options.interval);
    const forceRefresh = Boolean(options.forceRefresh);
    const geo = String(options.geo || DEFAULT_GEO).trim().toUpperCase();

    const resultByKeyword = new Map();
    const needFetch = [];

    for (const keyword of list) {
        if (!forceRefresh) {
            const cached = readCache(keyword, interval, geo);
            if (cached) {
                resultByKeyword.set(keyword, buildCachedResult(keyword, interval, geo, cached, 'cache'));
                continue;
            }
        }
        needFetch.push(keyword);
    }

    const chunks = chunkArray(needFetch, BATCH_SIZE);
    for (const chunk of chunks) {
        try {
            const apiMap = await rateLimiter.schedule(
                () => fetchTrendsBatchFromSearchApi(chunk, interval, geo)
            );
            const cachedAt = new Date().toISOString();
            for (const keyword of chunk) {
                const apiResult = apiMap.get(keyword);
                if (!apiResult) {
                    resultByKeyword.set(
                        keyword,
                        buildErrorResult(keyword, interval, geo, 'SearchAPI 未返回该关键词数据')
                    );
                    continue;
                }
                const payload = {
                    keyword,
                    interval,
                    geo,
                    code: apiResult.code,
                    message: apiResult.message,
                    success: apiResult.success,
                    data: apiResult.data,
                    cached_at: cachedAt
                };
                writeCache(keyword, interval, geo, payload);
                resultByKeyword.set(keyword, { ...payload, source: 'searchapi' });
            }
        } catch (error) {
            const message = error.message || formatRequestError(error);
            for (const keyword of chunk) {
                const stale = readCache(keyword, interval, geo, { allowStale: true });
                if (stale && !forceRefresh) {
                    resultByKeyword.set(keyword, {
                        ...buildCachedResult(keyword, interval, geo, stale, 'stale_cache'),
                        message: `SearchAPI 请求失败，已返回过期缓存：${message}`,
                        warning: message
                    });
                } else {
                    resultByKeyword.set(keyword, buildErrorResult(keyword, interval, geo, message));
                }
            }
        }
    }

    const results = list.map(keyword => resultByKeyword.get(keyword)).filter(Boolean);

    return {
        interval,
        geo,
        results,
        total: results.length,
        success_count: results.filter(item => item.success && Array.isArray(item.data) && item.data.length).length
    };
}

module.exports = {
    getGoogleTrends,
    getGoogleTrendsBatch,
    parseKeywords,
    BATCH_SIZE
};
