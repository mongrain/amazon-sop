const axios = require('axios');
const imghash = require('imghash');

const DEFAULT_THRESHOLD = 10;

function hammingDistance(hashA, hashB) {
    const a = String(hashA || '').toLowerCase();
    const b = String(hashB || '').toLowerCase();
    if (!a || !b || a.length !== b.length) {
        throw new Error('无效的感知哈希');
    }
    let dist = 0;
    for (let i = 0; i < a.length; i += 1) {
        const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
        // 统计 4bit 中的 1
        dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
    }
    return dist;
}

async function downloadImageBuffer(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: Number(process.env.STOREFRONT_PHASH_TIMEOUT_MS || 30000),
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024
    });
    return Buffer.from(response.data);
}

async function computePhash(buffer) {
    // imghash 对 Buffer 走 hashRaw；bits=8 → 64-bit pHash（16 个 hex 字符）
    const hash = await imghash.hash(buffer, 8);
    return String(hash);
}

async function perceptualHashCompare(urlA, urlB, { threshold = DEFAULT_THRESHOLD } = {}) {
    const bufA = await downloadImageBuffer(urlA);
    const bufB = await downloadImageBuffer(urlB);
    const hashA = await computePhash(bufA);
    const hashB = await computePhash(bufB);
    const distance = hammingDistance(hashA, hashB);
    const th = Number(threshold);
    return {
        similar: distance <= th,
        distance,
        threshold: th
    };
}

module.exports = {
    hammingDistance,
    computePhash,
    perceptualHashCompare,
    downloadImageBuffer
};
