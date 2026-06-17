require('dotenv').config();
const fs = require('fs');
const path = require('path');

function getEnvInt(name, defaultValue, { minimumValue = null, maximumValue = null } = {}) {
    const raw = process.env[name];
    if (raw == null) return defaultValue;
    const text = String(raw).trim();
    if (!text) return defaultValue;
    const value = Number.parseInt(text, 10);
    if (!Number.isFinite(value)) return defaultValue;
    let bounded = value;
    if (minimumValue != null) bounded = Math.max(minimumValue, bounded);
    if (maximumValue != null) bounded = Math.min(maximumValue, bounded);
    return bounded;
}

const DEFAULT_MAX_UPLOAD_BYTES = getEnvInt('SELLERSPRITE_MAX_UPLOAD_BYTES', 15_000_000, { minimumValue: 0 });
const DEFAULT_UPLOAD_URL = 'https://www.sellersprite.com/resources/upload-img';
const DEFAULT_BASE_URL = 'https://www.sellersprite.com';

function todayPrefix() {
    const d = new Date();
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function normalizePrefix(prefix) {
    if (!prefix) return '';
    return String(prefix).trim().replace(/^[\\/]+|[\\/]+$/g, '');
}

function normalizeDomain(domain) {
    if (!domain) return '';
    const text = String(domain).trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text.replace(/\/+$/g, '');
    return `https://${text.replace(/\/+$/g, '')}`;
}

function getUploadConfig({ uploadUrl, baseUrl, cookie, headers } = {}) {
    const config = {
        uploadUrl: String(uploadUrl || process.env.SELLERSPRITE_UPLOAD_URL || DEFAULT_UPLOAD_URL).trim(),
        baseUrl: normalizeDomain(baseUrl || process.env.SELLERSPRITE_BASE_URL || DEFAULT_BASE_URL),
        cookie: String(cookie != null ? cookie : (process.env.SELLERSPRITE_COOKIE || '')).trim(),
        headers: headers || null
    };
    if (!config.uploadUrl) throw new Error('Missing upload url');
    return config;
}

function buildObjectKey(localPath, { uploadPrefix, filename } = {}) {
    const normalizedPrefix = normalizePrefix(uploadPrefix != null ? uploadPrefix : todayPrefix());
    const fileName = filename || path.basename(localPath);
    return normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
}

function guessContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return 'application/octet-stream';
}

function buildUploadHeaders(uploadUrl, cookie) {
    let origin = DEFAULT_BASE_URL;
    try {
        const u = new URL(uploadUrl);
        origin = `${u.protocol}//${u.host}`;
    } catch (e) {}

    const headers = {
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        accept: 'application/json, text/javascript, */*; q=0.01',
        origin,
        referer: 'https://www.sellersprite.com/cn/bbs'
    };
    if (cookie) headers.cookie = cookie;
    return headers;
}

function cleanUrlText(text) {
    if (text == null) return '';
    if (typeof text !== 'string') return '';
    let cleaned = text.trim();
    while (cleaned && (cleaned[0] === '`' || cleaned[0] === "'" || cleaned[0] === '"')) cleaned = cleaned.slice(1).trimStart();
    while (cleaned && (cleaned[cleaned.length - 1] === '`' || cleaned[cleaned.length - 1] === "'" || cleaned[cleaned.length - 1] === '"')) cleaned = cleaned.slice(0, -1).trimEnd();
    return cleaned.trim();
}

function extractPublicUrl(payload, baseUrl) {
    const tryResolve = (value) => {
        if (!value || typeof value !== 'string') return '';
        const urlText = cleanUrlText(value);
        if (/^https?:\/\//i.test(urlText)) return urlText;
        if (urlText.startsWith('/')) return new URL(urlText, `${baseUrl}/`).toString();
        if (urlText.startsWith('static/') || urlText.startsWith('uploads/')) return new URL(urlText, `${baseUrl}/`).toString();
        return '';
    };

    if (typeof payload === 'string') return tryResolve(payload);
    if (!payload || typeof payload !== 'object') return '';

    const candidates = [];
    for (const key of ['url', 'file_url', 'fileUrl', 'image_url', 'imageUrl', 'path']) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) candidates.push(payload[key]);
    }

    const data = payload.data;
    if (typeof data === 'string') {
        candidates.push(data);
    } else if (Array.isArray(data) && data.length) {
        candidates.push(data[0]);
    } else if (data && typeof data === 'object') {
        for (const key of ['url', 'file_url', 'fileUrl', 'image_url', 'imageUrl', 'path', 'src']) {
            if (Object.prototype.hasOwnProperty.call(data, key)) candidates.push(data[key]);
        }
    }

    for (const item of candidates) {
        const resolved = tryResolve(item);
        if (resolved) return resolved;
    }
    return '';
}

async function upload(localPath, options = {}) {
    if (!globalThis.fetch) throw new Error('Global fetch is not available in this Node.js runtime');
    if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) throw new Error(`Local file not found: ${localPath}`);

    const {
        key = null,
        uploadPrefix = null,
        uploadUrl = null,
        baseUrl = null,
        cookie = null,
        headers = null,
        timeout = 30_000,
        maxUploadBytes = null
    } = options || {};

    const config = getUploadConfig({ uploadUrl, baseUrl, cookie, headers });
    const objectKey = key || buildObjectKey(localPath, { uploadPrefix });
    let fileName = path.posix.basename(String(objectKey).replace(/\\/g, '/')) || path.basename(localPath);

    const fileStats = fs.statSync(localPath);
    const limit = (() => {
        if (maxUploadBytes == null) return DEFAULT_MAX_UPLOAD_BYTES;
        const parsed = Number.parseInt(String(maxUploadBytes), 10);
        return Number.isFinite(parsed) ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
    })();
    if (limit > 0 && fileStats.size > limit) {
        throw new Error(`File too large: ${fileStats.size} bytes (limit ${limit}). Consider compressing before upload.`);
    }

    const contentType = guessContentType(fileName);
    const buffer = fs.readFileSync(localPath);
    const form = new FormData();
    if (typeof File === 'function') {
        form.append('upload', new File([buffer], fileName, { type: contentType }));
    } else {
        form.append('upload', new Blob([buffer], { type: contentType }), fileName);
    }

    const requestHeaders = buildUploadHeaders(config.uploadUrl, config.cookie);
    if (config.headers && typeof config.headers === 'object') {
        for (const [k, v] of Object.entries(config.headers)) requestHeaders[k] = v;
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(0, Number(timeout) || 0);
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response;
    let rawText = '';
    try {
        response = await fetch(config.uploadUrl, {
            method: 'POST',
            headers: requestHeaders,
            body: form,
            signal: controller.signal
        });
        rawText = await response.text();
    } finally {
        if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
        throw new Error(`Upload request failed: status=${response.status}, body=${rawText.slice(0, 500)}`);
    }

    let uploadResult;
    try {
        uploadResult = JSON.parse(rawText);
    } catch (e) {
        uploadResult = { raw_text: rawText };
    }

    if (uploadResult && typeof uploadResult === 'object' && !Array.isArray(uploadResult)) {
        const codeValue = String(uploadResult.code || '').trim().toLowerCase();
        if (codeValue && codeValue !== 'ok' && codeValue !== 'success' && codeValue !== '0') {
            throw new Error(`Upload failed: code=${uploadResult.code}, message=${uploadResult.message || ''}`);
        }
    }

    const publicUrl = extractPublicUrl(uploadResult, config.baseUrl);
    if (!publicUrl) throw new Error('Upload succeeded but no public url found in response');

    return {
        key: objectKey,
        public_url: publicUrl,
        result: uploadResult
    };
}

module.exports = { upload };
