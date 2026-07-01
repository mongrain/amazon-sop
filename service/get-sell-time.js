const axios = require('axios');

const KEEPA_BASE = 'https://e.sellersprite.com/v2/extension/keepa';
const ERR_GLOBAL_403 = 'ERR_GLOBAL_403';
const ERR_ROBOT_CHECK = 'ERR_ROBOT_CHECK';

class SellTimeApiError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'SellTimeApiError';
        this.code = code;
    }
}

function siteToStation(seq) {
    const text = String(seq || '').trim();
    const matched = text.match(/([A-Z]{2})$/i);
    return matched ? matched[1].toUpperCase() : 'US';
}

function buildRequestOptions({ asin, station = 'US' }) {
    return {
      method: 'GET',
      url: `https://e.sellersprite.com/v2/extension/keepa?station=${station}&asin=${asin}&period=DAY&tk=121077.424406&version=5.0.3&language=zh_CN&extension=libkfdihmladjiijocodhhkkkbjiadpd&source=offline`,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
        accept: 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'auth-fp': 'd6e96e76d0439be989dd94a2f1c0c23e',
        'auth-token': '2585292871nCxqxHHWBmmt3VQlnhYJ0Gig3ZmXys9s/lw4kf6EXv7/3PyWmaDv4CJmV0x8miW4',
        'content-type': 'application/json',
        priority: 'u=1, i',
        'random-token': '21415ddd-9c2c-4328-93d6-d274dcc27e2d',
        'sec-ch-ua': '"Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'none',
        'sec-fetch-storage-access': 'active',
        Cookie: '_gcl_au=1.1.590923243.1780738353; _ga=GA1.1.1942145673.1780738353; MEIQIA_TRACK_ID=3El1UNiOfYA5x7coB1VFdpZdJgx; MEIQIA_VISIT_ID=3El1UNS7ASToycgBAaB7dYlrNWO; Hm_lvt_e0dfc78949a2d7c553713cb5c573a486=1780738354,1782874650; Hm_lpvt_e0dfc78949a2d7c553713cb5c573a486=1782874650; HMACCOUNT=877F9414C98FC69F; _clck=1yliq8b%5E2%5Eg7d%5E0%5E2348; _clsk=16kh3i2%5E1782874660350%5E1%5E1%5Ej.clarity.ms%2Fcollect; _ga_38NCVF2XST=GS2.1.s1782874649$o38$g1$t1782874664$j45$l0$h1394296304; _ga_CN0F80S6GL=GS2.1.s1782874653$o153$g1$t1782874664$j49$l0$h0'
      }
    };
}

/**
 * 调用 SellerSprite Keepa 接口，返回运营天数等信息。
 * @param {{ asin: string, station?: string, seq?: string }} options
 */
async function getSellTime({ asin, station, seq }) {
    const asinText = String(asin || '').trim().toUpperCase();
    if (!asinText) throw new Error('ASIN 不能为空');

    const resolvedStation = station ? String(station).toUpperCase() : siteToStation(seq);
    const options = buildRequestOptions({ asin: asinText, station: resolvedStation });

    try {
        const res = await axios.request(options);
        const body = res.data || {};
        console.log(body);

        if (body.code === ERR_GLOBAL_403 || body.code === ERR_ROBOT_CHECK) {
            throw new SellTimeApiError(body.message || ERR_GLOBAL_403, ERR_GLOBAL_403);
        }
        if (body.code && body.code !== 'OK' && body.code !== '0') {
            throw new Error(body.message || body.code);
        }

        return body;
    } catch (error) {
        if (error instanceof SellTimeApiError) throw error;

        const responseBody = error.response?.data || {};
        if (responseBody.code === ERR_GLOBAL_403 || responseBody.code === ERR_ROBOT_CHECK) {
            throw new SellTimeApiError(responseBody.message || ERR_GLOBAL_403, ERR_GLOBAL_403);
        }

        const message = responseBody.message
            || responseBody.code
            || error.message
            || '请求失败';
        throw new Error(message);
    }
}

async function main() {
    const asin = process.argv[2];
    const station = process.argv[3] || 'US';
    if (!asin) {
        console.error('用法: node service/get-sell-time.js <ASIN> [station]');
        process.exit(1);
    }

    try {
        const result = await getSellTime({ asin, station });
        console.log(JSON.stringify(result, null, 2));
        if (result.data && result.data.totalDays != null) {
            const { computeOperatingStartedAtFromTotalDays, computeOperatingDays } = require('./operating-days');
            const startedAt = computeOperatingStartedAtFromTotalDays(result.data.totalDays);
            console.error(`\n运营天数 totalDays = ${result.data.totalDays}`);
            if (startedAt) {
                console.error(`运营开始时间 = ${startedAt}`);
                console.error(`当前计算运营天数 = ${computeOperatingDays(startedAt)} 天`);
            }
        }
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    getSellTime,
    siteToStation,
    buildRequestOptions,
    SellTimeApiError,
    ERR_GLOBAL_403,
    ERR_ROBOT_CHECK
};
