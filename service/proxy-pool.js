const fs = require('fs');
const path = require('path');
const lack = require('lack-proxy');
const { execFileSync } = require('child_process');

const DEFAULT_POOL_FILE = path.join(__dirname, '../config/proxies.json');
const DEFAULT_COOLDOWN_MS = Number(process.env.GOOGLE_TRENDS_PROXY_COOLDOWN_MS || 5 * 60 * 1000);
const GOOGLE_TRENDS_ALLOWLIST = ['trends.google.com', '*.google.com'];

let activeProxyUrl = null;
let lackProxyInitialized = false;

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

function normalizeProxyUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    return `http://${text}`;
}

function parseProxyList(raw) {
    return [...new Set(
        String(raw || '')
            .split(/[\n,，;；]+/)
            .map(normalizeProxyUrl)
            .filter(Boolean)
    )];
}

function loadPoolFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return { proxies: [], cooldownMs: DEFAULT_COOLDOWN_MS };
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(parsed)) {
            return {
                proxies: parsed.map(normalizeProxyUrl).filter(Boolean),
                cooldownMs: DEFAULT_COOLDOWN_MS
            };
        }
        const proxies = Array.isArray(parsed.proxies) ? parsed.proxies : [];
        return {
            proxies: proxies.map(normalizeProxyUrl).filter(Boolean),
            cooldownMs: Number(parsed.cooldown_ms || parsed.cooldownMs || DEFAULT_COOLDOWN_MS) || DEFAULT_COOLDOWN_MS
        };
    } catch (e) {
        return { proxies: [], cooldownMs: DEFAULT_COOLDOWN_MS };
    }
}

function loadConfiguredProxies() {
    const poolFile = String(process.env.GOOGLE_TRENDS_PROXY_POOL_FILE || DEFAULT_POOL_FILE).trim();
    const fromFile = loadPoolFile(poolFile);
    if (fromFile.proxies.length) return fromFile;

    const fromList = parseProxyList(process.env.GOOGLE_TRENDS_PROXIES);
    if (fromList.length) {
        return { proxies: fromList, cooldownMs: DEFAULT_COOLDOWN_MS };
    }

    const single = normalizeProxyUrl(
        process.env.GOOGLE_TRENDS_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY ||
        process.env.https_proxy ||
        process.env.http_proxy ||
        readWindowsProxyUrl()
    );
    return {
        proxies: single ? [single] : [],
        cooldownMs: DEFAULT_COOLDOWN_MS
    };
}

function buildLackProxyConfig(proxyUrl) {
    const url = new URL(normalizeProxyUrl(proxyUrl));
    const config = {
        host: url.hostname,
        port: Number(url.port || 80),
        allowlist: GOOGLE_TRENDS_ALLOWLIST
    };

    if (url.username) {
        const auth = Buffer.from(
            `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password || '')}`
        ).toString('base64');
        config.headers = { 'Proxy-Authorization': `Basic ${auth}` };
    }

    return config;
}

function initLackProxy() {
    if (lackProxyInitialized) return;
    lackProxyInitialized = true;

    lack.proxy(() => {
        if (!activeProxyUrl) return false;
        return buildLackProxyConfig(activeProxyUrl);
    });
}

class ProxyPool {
    constructor() {
        this.reload();
        this.cooldownUntil = new Map();
        this.rotateIndex = 0;
        initLackProxy();
    }

    reload() {
        const loaded = loadConfiguredProxies();
        this.proxies = loaded.proxies;
        this.cooldownMs = loaded.cooldownMs;
    }

    size() {
        return this.proxies.length;
    }

    isAvailable(proxyUrl) {
        const until = this.cooldownUntil.get(proxyUrl) || 0;
        return Date.now() >= until;
    }

    getAvailableProxies() {
        const available = this.proxies.filter(url => this.isAvailable(url));
        if (!available.length) return this.proxies.slice();
        return available;
    }

    getNextProxy() {
        const candidates = this.getAvailableProxies();
        if (!candidates.length) return null;
        const proxyUrl = candidates[this.rotateIndex % candidates.length];
        this.rotateIndex = (this.rotateIndex + 1) % candidates.length;
        return proxyUrl;
    }

    markFailure(proxyUrl, reason) {
        if (!proxyUrl) return;
        const cooldown = reason && reason.status === 403
            ? Math.max(this.cooldownMs, 10 * 60 * 1000)
            : this.cooldownMs;
        this.cooldownUntil.set(proxyUrl, Date.now() + cooldown);
    }

    activateProxy(proxyUrl) {
        initLackProxy();
        activeProxyUrl = proxyUrl || null;
    }

    clearActiveProxy() {
        activeProxyUrl = null;
    }

    shouldRotateOnResponse(response) {
        const status = response && response.status;
        return status === 429 || status === 403;
    }

    shouldRotateOnError(error) {
        if (!error) return false;
        if (error.response && this.shouldRotateOnResponse(error.response)) return true;
        const code = String(error.code || '');
        return ['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
            || /代理|Tunneling socket|lack-proxy/i.test(String(error.message || ''));
    }

    maskProxyUrl(proxyUrl) {
        if (!proxyUrl) return 'direct';
        try {
            const url = new URL(proxyUrl);
            const auth = url.username ? `${url.username}:***@` : '';
            return `${url.protocol}//${auth}${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
        } catch (e) {
            return 'proxy';
        }
    }
}

const defaultPool = new ProxyPool();

module.exports = {
    ProxyPool,
    defaultPool,
    loadConfiguredProxies,
    readWindowsProxyUrl,
    normalizeProxyUrl,
    initLackProxy
};
