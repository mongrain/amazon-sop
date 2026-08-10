const axios = require('axios');
const { amazonDomainToTld, mapAmazonProduct } = require('./amazon-map');

function envMs(primary, legacy, fallback) {
    const v = process.env[primary] ?? process.env[legacy];
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TIMEOUT_MS = envMs('SCRAPERAPI_TIMEOUT_MS', 'SEARCHAPI_TIMEOUT_MS', 60000);
const BASE = 'https://api.scraperapi.com';
const EXHAUSTED_KEYWORDS = [
    'quota', 'credit', 'exhausted', 'insufficient', 'limit reached',
    'concurrency', 'payment required', 'upgrade your plan'
];

function isTokenExhaustedError(error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403 || status === 402) return true;
    const bodyText = JSON.stringify(error?.response?.data || error?.message || '').toLowerCase();
    return EXHAUSTED_KEYWORDS.some((k) => bodyText.includes(k));
}

function isRetryableError(error) {
    if (isTokenExhaustedError(error)) return false;
    const status = error?.response?.status;
    if (status && status >= 500) return true;
    const code = error?.code;
    return ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(code);
}

async function scraperApiGet(params) {
    const response = await axios.get(BASE, {
        params,
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(d) => d]
    });
    if (response.status >= 400) {
        const err = new Error(`ScraperAPI HTTP ${response.status}`);
        err.response = {
            status: response.status,
            data: response.data
        };
        throw err;
    }
    return response.data;
}

async function fetchAmazonProduct({ asin, amazonDomain = 'amazon.com', apiKey }) {
    const tld = amazonDomainToTld(amazonDomain);
    const response = await axios.get(`${BASE}/structured/amazon/product`, {
        params: {
            api_key: apiKey,
            asin: String(asin || '').trim().toUpperCase(),
            tld
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true
    });
    if (response.status >= 400) {
        const err = new Error(`ScraperAPI HTTP ${response.status}`);
        err.response = response;
        throw err;
    }
    const data = response.data || {};
    if (!data || (typeof data === 'object' && !data.name && !data.title && !data.product_information)) {
        throw new Error('ScraperAPI 未返回 Amazon 商品数据');
    }
    return mapAmazonProduct(data);
}

async function fetchUrlViaScraperApi({ url, apiKey, render }) {
    const useRender = render != null
        ? Boolean(render)
        : String(process.env.SCRAPERAPI_RENDER || 'true').toLowerCase() !== 'false';
    const params = {
        api_key: apiKey,
        url: String(url)
    };
    if (useRender) params.render = 'true';
    return scraperApiGet(params);
}

module.exports = {
    fetchAmazonProduct,
    fetchUrlViaScraperApi,
    isTokenExhaustedError,
    isRetryableError,
    TIMEOUT_MS
};
