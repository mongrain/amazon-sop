const axios = require('axios');

const SEARCHAPI_URL = 'https://www.searchapi.io/api/v1/search';
const TIMEOUT_MS = Number(process.env.SEARCHAPI_TIMEOUT_MS || 60000);
const EXHAUSTED_KEYWORDS = ['quota', 'credit', 'exhausted', 'insufficient', 'limit reached'];

function isTokenExhaustedError(error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) return true;
    const bodyText = JSON.stringify(error?.response?.data || '').toLowerCase();
    return EXHAUSTED_KEYWORDS.some(k => bodyText.includes(k));
}

function isRetryableError(error) {
    if (isTokenExhaustedError(error)) return false;
    const status = error?.response?.status;
    if (status && status >= 500) return true;
    const code = error?.code;
    return ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(code);
}

async function fetchSearchApi({ params, apiKey }) {
    const response = await axios.get(SEARCHAPI_URL, {
        params: {
            ...params,
            api_key: apiKey
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true
    });

    if (response.status >= 400) {
        const err = new Error(`SearchAPI HTTP ${response.status}`);
        err.response = response;
        throw err;
    }

    return response.data || {};
}

async function fetchAmazonProduct({ asin, amazonDomain = 'amazon.com', apiKey }) {
    const data = await fetchSearchApi({
        params: {
            engine: 'amazon_product',
            asin: String(asin || '').trim().toUpperCase(),
            amazon_domain: amazonDomain || 'amazon.com'
        },
        apiKey
    });

    if (!data.product) {
        const err = new Error('SearchAPI 未返回 product 数据');
        throw err;
    }
    return data;
}

module.exports = {
    fetchSearchApi,
    fetchAmazonProduct,
    isTokenExhaustedError,
    isRetryableError
};
