require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OALUR_BASE = 'https://vip.oalur.com';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const CACHE_ROOT = path.join(__dirname, '../../data/product-selection-reviews/cache');

/** 欧鹭评论下载固定参数（站点/平台等与抓包一致；ASIN 由任务传入） */
const OALUR_DEFAULTS = {
    site: 'US',
    platform: 'AMAZON',
    lang: 'en'
};

function normalizeAsin(asin) {
    const value = String(asin || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(value)) {
        throw new Error('ASIN 格式无效，须为 10 位字母数字');
    }
    return value;
}

function buildReviewParams(asin) {
    const normalizedAsin = normalizeAsin(asin);
    const { site, platform, lang } = OALUR_DEFAULTS;
    return {
        asin: normalizedAsin,
        site,
        platform,
        lang,
        referer: `${OALUR_BASE}/comment?asin=${normalizedAsin}&site=${site}`,
        downloadBody: {
            asins: [normalizedAsin],
            range: 'pasin',
            desc: true,
            pageNo: 1,
            size: 20,
            sortBy: 'date',
            downloadImg: false,
            translate: true
        }
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getOalurCookie() {
    const cookie = String(process.env.OALUR_COOKIE || '').trim();
    if (!cookie) {
        throw new Error('未配置 OALUR_COOKIE，请在 .env 中设置欧鹭登录 Cookie');
    }
    return cookie;
}

function getAsinCacheDir(asin) {
    return path.join(CACHE_ROOT, String(asin || '').trim().toUpperCase());
}

function getAsinCacheMetaPath(asin) {
    return path.join(getAsinCacheDir(asin), 'meta.json');
}

function readAsinCache(asin) {
    const metaPath = getAsinCacheMetaPath(asin);
    if (!fs.existsSync(metaPath)) return null;
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (!meta.localPath || !fs.existsSync(meta.localPath)) return null;
        return meta;
    } catch (e) {
        return null;
    }
}

function writeAsinCache(asin, meta) {
    const dir = getAsinCacheDir(asin);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getAsinCacheMetaPath(asin), JSON.stringify(meta, null, 2), 'utf8');
}

function copyReviewToDir(sourcePath, saveDir, filename) {
    fs.mkdirSync(saveDir, { recursive: true });
    const destPath = path.join(saveDir, path.basename(filename || sourcePath));
    fs.copyFileSync(sourcePath, destPath);
    return destPath;
}

function createOalurClient(reviewParams) {
    const { site, platform, lang, referer, downloadBody } = reviewParams;    const cookie = getOalurCookie();
    const commonHeaders = {
        Cookie: cookie,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-Locale': 'zh_CN',
        Origin: OALUR_BASE,
        Referer: referer,
        'User-Agent': DEFAULT_USER_AGENT
    };

    function assertOkResponse(data, action) {
        if (!data || data.code !== 0) {
            const msg = (data && data.message) || `${action}失败`;
            throw new Error(msg);
        }
    }

    async function requestReviewDownload() {
        const response = await axios.post(
            `${OALUR_BASE}/gw/search/api/reviews/download`,
            downloadBody,            {
                params: { site, platform },
                headers: commonHeaders,
                timeout: 60000
            }
        );
        assertOkResponse(response.data, '发起评论下载');
        return response.data;
    }

    async function fetchPreviewRecords() {
        const response = await axios.get(`${OALUR_BASE}/gw/dlc/private/preview`, {
            params: { site, lang, platform },
            headers: commonHeaders,
            timeout: 60000
        });
        assertOkResponse(response.data, '查询下载任务');
        const records = response.data.data && response.data.data.records;
        return Array.isArray(records) ? records : [];
    }

    async function pollReviewFile(asin, { maxAttempts = 60, intervalMs = 2000, startedAt } = {}) {
        const startedMs = startedAt ? new Date(startedAt).getTime() : Date.now() - 5000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const records = await fetchPreviewRecords();
            const candidates = records
                .filter(rec => rec.fileType === 'REVIEW' && String(rec.filename || '').includes(asin))
                .filter(rec => {
                    if (!rec.createdAt) return true;
                    const createdMs = new Date(String(rec.createdAt).replace(' ', 'T')).getTime();
                    return !Number.isNaN(createdMs) && createdMs >= startedMs - 10000;
                })
                .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

            const latest = candidates[0];
            if (latest) {
                if (latest.fileStatus === 'DONE' && Number(latest.percent) >= 100) {
                    return latest;
                }
                if (latest.fileStatus === 'FAILED') {
                    throw new Error(`欧鹭评论导出失败：${latest.filename || asin}`);
                }
            }

            if (attempt < maxAttempts) {
                await sleep(intervalMs);
            }
        }

        throw new Error('评论下载超时，请稍后重试');
    }

    async function getReviewFileUrl(fileId) {
        const response = await axios.get(`${OALUR_BASE}/gw/dlc/private/fileUrl`, {
            params: { site, lang, fileId, platform },
            headers: commonHeaders,
            timeout: 60000
        });
        assertOkResponse(response.data, '获取评论文件链接');
        const fileUrl = response.data.data;
        if (!fileUrl) throw new Error('欧鹭未返回评论文件下载地址');
        return fileUrl;
    }

    async function downloadReviewFile(fileUrl, saveDir, filename) {
        fs.mkdirSync(saveDir, { recursive: true });
        const safeName = path.basename(filename || 'reviews.xlsx');
        const localPath = path.join(saveDir, safeName);

        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        fs.writeFileSync(localPath, response.data);
        return localPath;
    }

    return {
        requestReviewDownload,
        pollReviewFile,
        getReviewFileUrl,
        downloadReviewFile
    };
}

/**
 * 完整流程：优先读 ASIN 缓存 → 否则发起下载 → 轮询 preview → 获取 fileUrl → 保存并写入缓存
 */
async function downloadOalurReviews({ saveDir, asin }) {
    const reviewParams = buildReviewParams(asin);
    const { asin: normalizedAsin, site, platform } = reviewParams;

    const cached = readAsinCache(normalizedAsin);
    if (cached) {
        const localPath = copyReviewToDir(cached.localPath, saveDir, cached.filename);
        return {
            asin: cached.asin || normalizedAsin,            site: cached.site || site,
            platform: cached.platform || platform,
            fileId: cached.fileId,
            filename: cached.filename,
            fileUrl: cached.fileUrl || null,
            localPath,
            createdAt: cached.createdAt,
            cachedAt: cached.cachedAt,
            fromCache: true
        };
    }

    const client = createOalurClient(reviewParams);
    const startedAt = new Date();

    await client.requestReviewDownload();
    const record = await client.pollReviewFile(normalizedAsin, { startedAt: startedAt.toISOString() });
    const fileUrl = await client.getReviewFileUrl(record.fileId);
    const cacheDir = getAsinCacheDir(normalizedAsin);
    const cachePath = await client.downloadReviewFile(fileUrl, cacheDir, record.filename);

    const meta = {
        asin: normalizedAsin,        site,
        platform,
        fileId: record.fileId,
        filename: record.filename,
        fileUrl,
        localPath: cachePath,
        createdAt: record.createdAt,
        cachedAt: new Date().toISOString()
    };
    writeAsinCache(normalizedAsin, meta);
    const localPath = copyReviewToDir(cachePath, saveDir, record.filename);

    return {
        ...meta,
        localPath,
        fromCache: false
    };
}

module.exports = {
    OALUR_DEFAULTS,
    normalizeAsin,
    buildReviewParams,
    downloadOalurReviews
};