require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const https = require('https');
const net = require('net');
const path = require('path');
const tls = require('tls');
const { execFileSync } = require('child_process');

const GOOGLE_TRENDS_BASE = 'https://trends.google.com/trends/api';
const CACHE_ROOT = path.join(__dirname, '../data/google-trends/cache');
const CACHE_TTL_MS = Number(process.env.GOOGLE_TRENDS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const REQUEST_INTERVAL_MS = Number(process.env.GOOGLE_TRENDS_REQUEST_INTERVAL_MS || 3000);
const REQUEST_TIMEOUT_MS = Number(process.env.GOOGLE_TRENDS_TIMEOUT_MS || 60000);
const DEFAULT_GEO = String(process.env.GOOGLE_TRENDS_GEO || 'US').trim().toUpperCase();
const DEFAULT_HL = String(process.env.GOOGLE_TRENDS_HL || 'en-US').trim();
const DEFAULT_TZ = Number(process.env.GOOGLE_TRENDS_TZ || 360);
const SESSION_COOKIE_PATH = path.join(CACHE_ROOT, 'session-cookie.json');
let cachedProxyAgent = null;
let cachedProxyUrl = null;
let sessionCookie = '';

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

function stripGoogleJsonPrefix(payload) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
    return text.replace(/^\)\]\}',?\n?/, '');
}

function parseGoogleJson(payload) {
    const text = stripGoogleJsonPrefix(payload);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error('Google Trends 返回内容无法解析');
    }
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

function firstCookiePair(setCookie) {
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!raw) return '';
    return String(raw).split(';')[0].trim();
}

function mergeCookiePairs(...parts) {
    const map = new Map();
    for (const part of parts) {
        String(part || '')
            .split(';')
            .map(item => item.trim())
            .filter(Boolean)
            .forEach(item => {
                const eq = item.indexOf('=');
                if (eq > 0) map.set(item.slice(0, eq), item.slice(eq + 1));
            });
    }
    return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function loadSessionCookie() {
    if (sessionCookie) return sessionCookie;
    const envCookie = String(process.env.GOOGLE_TRENDS_COOKIE || '').trim();
    if (envCookie) {
        sessionCookie = envCookie;
        return sessionCookie;
    }
    if (!fs.existsSync(SESSION_COOKIE_PATH)) return '';
    try {
        const cached = JSON.parse(fs.readFileSync(SESSION_COOKIE_PATH, 'utf8'));
        sessionCookie = String(cached && cached.cookie || '').trim();
    } catch (e) {
        sessionCookie = '';
    }
    return sessionCookie;
}

function saveSessionCookie(cookie) {
    const normalized = String(cookie || '').trim();
    if (!normalized) return;
    sessionCookie = normalized;
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    fs.writeFileSync(SESSION_COOKIE_PATH, JSON.stringify({
        cookie: normalized,
        saved_at: new Date().toISOString()
    }, null, 2), 'utf8');
}

function captureSessionCookieFromResponse(response) {
    const setCookie = response && response.headers && response.headers['set-cookie'];
    const pair = firstCookiePair(setCookie);
    if (!pair) return false;
    saveSessionCookie(mergeCookiePairs(loadSessionCookie(), pair));
    return true;
}

function buildHeaders() {
    const headers = {
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://trends.google.com/trends/explore',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
    const cookie = loadSessionCookie();
    if (cookie) headers.Cookie = cookie;
    return headers;
}

async function requestGoogleTrends(url, { params, label = 'Google Trends' } = {}) {
    const options = {
        params,
        headers: buildHeaders(),
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
        ...getRequestTransportOptions()
    };

    let response = await axios.get(url, options);
    if (response.status === 429 && captureSessionCookieFromResponse(response)) {
        options.headers = buildHeaders();
        response = await axios.get(url, options);
    }

    if (response.status === 429) {
        const error = new Error(`${label} 请求过于频繁或当前网络被限制，请稍后重试，或配置 GOOGLE_TRENDS_COOKIE 后再试`);
        error.response = response;
        throw error;
    }
    if (response.status === 403) {
        const error = new Error(`${label} 拒绝了当前请求，请配置 GOOGLE_TRENDS_COOKIE 或更换可访问 Google 的网络`);
        error.response = response;
        throw error;
    }
    if (response.status >= 400) {
        const detail = typeof response.data === 'string'
            ? response.data.slice(0, 120).replace(/\s+/g, ' ')
            : '';
        const error = new Error(`${label} 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
        error.response = response;
        throw error;
    }

    return response;
}

function formatRequestError(error) {
    if (!error) return '未知错误';
    if (error.response) {
        const status = error.response.status;
        if (status === 429) return 'Google Trends 请求过于频繁或当前网络被限制，请稍后重试，或配置 GOOGLE_TRENDS_COOKIE 后再试';
        if (status === 403) return 'Google Trends 拒绝了当前请求，请配置 GOOGLE_TRENDS_COOKIE 或更换可访问 Google 的网络';
        const detail = typeof error.response.data === 'string'
            ? error.response.data.slice(0, 120).replace(/\s+/g, ' ')
            : '';
        return `Google Trends 返回 HTTP ${status}${detail ? `：${detail}` : ''}`;
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return '连接 Google Trends 超时，请确认服务器网络可以访问 trends.google.com';
    }
    if (error.code) return `${error.code}${error.message ? `：${error.message}` : ''}`;
    return error.message || '未知错误';
}

function readWindowsProxyUrl() {
    if (process.platform !== 'win32') return '';
    try {
        const output = execFileSync(
            'reg',
            ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'],
            { encoding: 'utf8', windowsHide: true }
        );
        if (!/\b0x1\b/i.test(output)) return '';

        const serverOutput = execFileSync(
            'reg',
            ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
            { encoding: 'utf8', windowsHide: true }
        );
        const match = serverOutput.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
        if (!match) return '';
        const proxyServer = match[1].trim();
        const httpsMatch = proxyServer.match(/https=([^;]+)/i);
        const httpMatch = proxyServer.match(/http=([^;]+)/i);
        const rawProxy = httpsMatch ? httpsMatch[1] : (httpMatch ? httpMatch[1] : proxyServer.split(';')[0]);
        return rawProxy ? `http://${rawProxy.replace(/^https?:\/\//i, '')}` : '';
    } catch (e) {
        return '';
    }
}

function resolveProxyUrl() {
    return String(
        process.env.GOOGLE_TRENDS_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY ||
        process.env.https_proxy ||
        process.env.http_proxy ||
        readWindowsProxyUrl() ||
        ''
    ).trim();
}

function createHttpsProxyAgent(proxyUrl) {
    const proxy = new URL(proxyUrl);
    const proxyPort = Number(proxy.port || 80);

    return new class HttpsProxyAgent extends https.Agent {
        constructor() {
            super({ keepAlive: true });
        }

        createConnection(options, callback) {
            const targetHost = options.host || options.hostname;
            const targetPort = Number(options.port || 443);
            const socket = net.connect(proxyPort, proxy.hostname);
            let settled = false;
            let buffered = Buffer.alloc(0);

            function done(error, secureSocket) {
                if (settled) return;
                settled = true;
                callback(error, secureSocket);
            }

            socket.setTimeout(REQUEST_TIMEOUT_MS);
            socket.once('error', error => done(error));
            socket.once('timeout', () => done(new Error('代理连接超时')));
            socket.once('connect', () => {
                const auth = proxy.username
                    ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`
                    : '';
                socket.write(
                    `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
                    `Host: ${targetHost}:${targetPort}\r\n` +
                    'Proxy-Connection: Keep-Alive\r\n' +
                    auth +
                    '\r\n'
                );
            });

            function onData(chunk) {
                buffered = Buffer.concat([buffered, chunk]);
                const marker = buffered.indexOf('\r\n\r\n');
                if (marker === -1) return;

                socket.removeListener('data', onData);
                const header = buffered.slice(0, marker).toString('utf8');
                const rest = buffered.slice(marker + 4);
                if (!/^HTTP\/1\.[01] 200\b/.test(header)) {
                    done(new Error(`代理 CONNECT 失败：${header.split('\r\n')[0] || '未知响应'}`));
                    socket.destroy();
                    return;
                }

                if (rest.length) socket.unshift(rest);
                const secureSocket = tls.connect({
                    socket,
                    servername: options.servername || targetHost
                }, () => done(null, secureSocket));
                secureSocket.once('error', error => done(error));
            }

            socket.on('data', onData);
        }
    }();
}

function getRequestTransportOptions() {
    const proxyUrl = resolveProxyUrl();
    if (!proxyUrl) return {};
    if (!cachedProxyAgent || cachedProxyUrl !== proxyUrl) {
        cachedProxyUrl = proxyUrl;
        cachedProxyAgent = createHttpsProxyAgent(proxyUrl);
    }
    return {
        httpsAgent: cachedProxyAgent,
        proxy: false
    };
}

function findTimeseriesWidget(widgets) {
    return (widgets || []).find(widget => {
        const id = String(widget.id || '').toUpperCase();
        const type = String(widget.type || '').toUpperCase();
        return id === 'TIMESERIES' || type === 'TIMESERIES'
            || id.includes('TIMESERIES') || type.includes('TIMESERIES');
    });
}

function normalizePoint(row) {
    const rawValue = Array.isArray(row.value) ? row.value[0] : row.value;
    const value = Number(rawValue);
    const formattedValue = Array.isArray(row.formattedValue) ? row.formattedValue[0] : row.formattedValue;
    const timestamp = Number(row.time);
    const date = Number.isFinite(timestamp)
        ? new Date(timestamp * 1000).toISOString().slice(0, 10)
        : (row.formattedTime || '');

    return {
        date,
        time: row.time,
        formattedTime: row.formattedTime || date,
        searches: Number.isFinite(value) ? value : 0,
        value: Number.isFinite(value) ? value : 0,
        formattedValue: formattedValue || String(Number.isFinite(value) ? value : 0),
        empty: Array.isArray(row.isPartial) ? Boolean(row.isPartial[0]) : Boolean(row.isPartial)
    };
}

async function fetchExplore(keyword, interval, geo) {
    const req = {
        comparisonItem: [{
            keyword,
            geo,
            time: resolveGoogleTime(interval)
        }],
        category: 0,
        property: ''
    };

    const response = await requestGoogleTrends(`${GOOGLE_TRENDS_BASE}/explore`, {
        params: {
            hl: DEFAULT_HL,
            tz: DEFAULT_TZ,
            req: JSON.stringify(req)
        },
        label: 'Google Trends explore'
    });

    return parseGoogleJson(response.data);
}

async function fetchTimeline(widget) {
    if (!widget || !widget.token || !widget.request) {
        throw new Error('Google Trends 未返回趋势时间序列组件');
    }

    const response = await requestGoogleTrends(`${GOOGLE_TRENDS_BASE}/widgetdata/multiline`, {
        params: {
            hl: DEFAULT_HL,
            tz: DEFAULT_TZ,
            req: JSON.stringify(widget.request),
            token: widget.token
        },
        label: 'Google Trends timeline'
    });

    const body = parseGoogleJson(response.data);
    const rows = body && body.default && Array.isArray(body.default.timelineData)
        ? body.default.timelineData
        : [];

    return rows.map(normalizePoint);
}

async function fetchTrendsFromGoogle(keyword, interval, geo) {
    const explore = await fetchExplore(keyword, interval, geo);
    const widget = findTimeseriesWidget(explore.widgets);
    const data = await fetchTimeline(widget);

    return {
        code: 'OK',
        message: 'Google Trends relative interest, scaled 0-100',
        success: true,
        data
    };
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

async function getGoogleTrends(keyword, interval = 'w', { forceRefresh = false, geo = DEFAULT_GEO } = {}) {
    const normalizedKeyword = normalizeKeyword(keyword);
    const normalizedInterval = normalizeInterval(interval);
    const normalizedGeo = String(geo || DEFAULT_GEO).trim().toUpperCase();

    if (!normalizedKeyword) {
        throw new Error('关键词不能为空');
    }

    if (!forceRefresh) {
        const cached = readCache(normalizedKeyword, normalizedInterval, normalizedGeo);
        if (cached) {
            return {
                keyword: normalizedKeyword,
                interval: normalizedInterval,
                geo: normalizedGeo,
                code: cached.code,
                message: cached.message,
                success: cached.success,
                data: cached.data,
                source: 'cache',
                cached_at: cached.cached_at
            };
        }
    }

    let apiResult;
    try {
        apiResult = await rateLimiter.schedule(
            () => fetchTrendsFromGoogle(normalizedKeyword, normalizedInterval, normalizedGeo)
        );
    } catch (error) {
        const message = formatRequestError(error);
        const stale = readCache(normalizedKeyword, normalizedInterval, normalizedGeo, { allowStale: true });
        if (stale && !forceRefresh) {
            return {
                keyword: normalizedKeyword,
                interval: normalizedInterval,
                geo: normalizedGeo,
                code: stale.code,
                message: `Google Trends 实时请求失败，已返回过期缓存：${message}`,
                success: stale.success,
                data: stale.data,
                source: 'stale_cache',
                cached_at: stale.cached_at,
                warning: message
            };
        }
        throw new Error(`Google Trends 请求失败：${message}`);
    }
    const cachedAt = new Date().toISOString();
    const payload = {
        keyword: normalizedKeyword,
        interval: normalizedInterval,
        geo: normalizedGeo,
        code: apiResult.code,
        message: apiResult.message,
        success: apiResult.success,
        data: apiResult.data,
        cached_at: cachedAt
    };
    writeCache(normalizedKeyword, normalizedInterval, normalizedGeo, payload);

    return {
        ...payload,
        source: 'google_trends'
    };
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
    const results = [];

    for (const keyword of list) {
        try {
            const result = await getGoogleTrends(keyword, interval, { forceRefresh, geo });
            results.push(result);
        } catch (e) {
            results.push({
                keyword,
                interval,
                geo,
                code: 'ERROR',
                message: e.message,
                success: false,
                data: [],
                source: 'error',
                error: e.message
            });
        }
    }

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
    parseKeywords
};
