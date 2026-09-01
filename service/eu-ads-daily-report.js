const { callYanjunTool } = require('./yanjun-mcp');
const { extractPerformanceList, sumCampaignAdMetrics } = require('./lingxing-metrics');

const EU_COUNTRY_ORDER = ['UK', 'DE', 'FR', 'IT', 'ES'];
const METRIC_ORDER = ['impressions', 'clicks', 'orders'];
const EU_COUNTRY_SET = new Set(EU_COUNTRY_ORDER);

const METRIC_LABELS = {
    impressions: '曝光',
    clicks: '点击',
    orders: '出单'
};

function shiftYmd(ymd, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function completeDayWindow(todayYmd) {
    const yesterday = shiftYmd(todayYmd, -1);
    const dates = [];
    for (let i = 6; i >= 0; i -= 1) {
        dates.push(shiftYmd(yesterday, -i));
    }
    return dates;
}

function metricLabel(metric) {
    return METRIC_LABELS[metric] || metric;
}

function normalizeCountryCode(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return null;
    if (code === 'GB' || code === 'UK') return 'UK';
    if (EU_COUNTRY_SET.has(code)) return code;
    return null;
}

function pickShopList(payload) {
    const fromExtract = extractPerformanceList(payload);
    if (fromExtract.length) return fromExtract;
    const candidates = [
        payload && payload.list,
        payload && payload.data,
        payload && payload.shops
    ];
    for (const list of candidates) {
        if (Array.isArray(list)) return list;
    }
    return [];
}

function pickShopCountry(row) {
    return normalizeCountryCode(
        row && (row.country || row.marketplace || row.country_code)
    );
}

function pickProfileId(row) {
    const raw = row && (row.profile_id != null ? row.profile_id : row.profileId);
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    const s = String(raw).trim();
    return /^\d+$/.test(s) ? s : null;
}

function listEuAdShops(payload) {
    const shops = [];
    for (const row of pickShopList(payload)) {
        const country = pickShopCountry(row);
        const profileId = pickProfileId(row);
        if (!country || profileId == null) continue;
        shops.push({
            country,
            profileId,
            name: String((row && row.name) || '').trim()
        });
    }
    return shops;
}

function rowKey(country, metric) {
    return `${country} · ${metricLabel(metric)}`;
}

function pickMetricValue(dayMetrics, metric) {
    if (!dayMetrics || typeof dayMetrics !== 'object') return null;
    const n = Number(dayMetrics[metric]);
    return Number.isFinite(n) ? n : null;
}

function buildReportMatrix({ dates, dailyByCountry }) {
    const safeDates = Array.isArray(dates) ? dates : [];
    const rows = [];
    for (const country of EU_COUNTRY_ORDER) {
        const countryDays = (dailyByCountry && dailyByCountry[country]) || {};
        for (const metric of METRIC_ORDER) {
            const values = {};
            for (const ymd of safeDates) {
                values[ymd] = pickMetricValue(countryDays[ymd], metric);
            }
            let trend = null;
            if (safeDates.length >= 2) {
                const lastDay = safeDates[safeDates.length - 1];
                const prevDay = safeDates[safeDates.length - 2];
                const lastVal = values[lastDay];
                const prevVal = values[prevDay];
                if (Number.isFinite(lastVal) && Number.isFinite(prevVal) && lastVal > prevVal) {
                    trend = 'up';
                }
            }
            rows.push({
                key: rowKey(country, metric),
                country,
                metric,
                values,
                trend
            });
        }
    }
    return { dates: safeDates, rows };
}

function deltaDirection(prev, next) {
    if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
    if (next > prev) return 'up';
    if (next < prev) return 'down';
    return 'flat';
}

function countryHasData(countryDays, dates) {
    for (const ymd of dates) {
        const day = countryDays && countryDays[ymd];
        if (!day) continue;
        for (const metric of METRIC_ORDER) {
            if (Number.isFinite(Number(day[metric]))) return true;
        }
    }
    return false;
}

/** UI 层应统一加前缀「建议，需你手动执行」。 */
function buildSuggestions(matrix) {
    const dates = matrix && matrix.dates ? matrix.dates : [];
    if (dates.length < 2) return [];
    const lastDay = dates[dates.length - 1];
    const prevDay = dates[dates.length - 2];
    const suggestions = [];

    for (const country of EU_COUNTRY_ORDER) {
        const rows = (matrix.rows || []).filter((row) => row.country === country);
        if (!rows.length) continue;
        const hasAny = rows.some((row) => {
            const v = row.values[lastDay];
            return Number.isFinite(v);
        });
        if (!hasAny) continue;

        const getVal = (metric) => {
            const row = rows.find((item) => item.metric === metric);
            return row ? row.values[lastDay] : null;
        };
        const getPrev = (metric) => {
            const row = rows.find((item) => item.metric === metric);
            return row ? row.values[prevDay] : null;
        };

        const impressions = getVal('impressions');
        const clicks = getVal('clicks');
        const orders = getVal('orders');
        const prevImpressions = getPrev('impressions');
        const prevClicks = getPrev('clicks');
        const prevOrders = getPrev('orders');

        const impDir = deltaDirection(prevImpressions, impressions);
        const clkDir = deltaDirection(prevClicks, clicks);
        const ordDir = deltaDirection(prevOrders, orders);

        const evidence = `${lastDay} vs ${prevDay}：曝光 ${prevImpressions ?? '—'}→${impressions ?? '—'}，点击 ${prevClicks ?? '—'}→${clicks ?? '—'}，出单 ${prevOrders ?? '—'}→${orders ?? '—'}`;
        let action = '';
        let review = '再观察 1～2 个完整日后再决定是否调整。';

        if (impDir === 'down' && clkDir === 'down') {
            action = '检查预算是否撞顶、出价是否偏低，必要时小幅提高预算或竞价。';
        } else if (clkDir === 'up' && ordDir === 'down') {
            action = '排查搜索词相关性与 Listing 转化，优先否定无效词并优化落地页。';
        } else if (impDir === 'up' && (clkDir === 'flat' || clkDir === 'down')) {
            action = '关注 CTR 与主图/标题吸引力，必要时优化素材提升点击效率。';
        } else if (impDir === 'up' && clkDir === 'up' && ordDir === 'up') {
            action = '三项同步改善，可继续观察；若预算充足可谨慎加预算放大有效流量。';
            review = '保持监控 ACoS/出单效率，连续 2 个完整日稳定后再加预算。';
        } else if (ordDir === 'up') {
            action = '出单改善，先观察花费效率，再决定是否小幅加预算。';
        } else {
            action = '指标波动不大，先维持现状并继续跟踪。';
        }

        suggestions.push({ country, evidence, action, review });
    }

    return suggestions.slice(0, 5);
}

function mergeDayMetrics(existing, incoming) {
    const next = { ...(existing || {}) };
    for (const metric of METRIC_ORDER) {
        const a = Number(next[metric]);
        const b = Number(incoming && incoming[metric]);
        const hasA = Number.isFinite(a);
        const hasB = Number.isFinite(b);
        if (hasA && hasB) next[metric] = a + b;
        else if (hasB) next[metric] = b;
        else if (hasA) next[metric] = a;
        else next[metric] = null;
    }
    return next;
}

function mapCampaignTotals(rows) {
    const totals = sumCampaignAdMetrics(rows);
    return {
        impressions: totals.ad_impressions,
        clicks: totals.clicks,
        orders: totals.ad_orders
    };
}

async function queryCampaignRowsForDay({ profileId, ymd, callTool }) {
    const pageSize = 50;
    const all = [];
    for (let page = 1; page <= 40; page += 1) {
        const payload = await callTool('lingxing_ad_campaign_report', {
            report_date: `${ymd} - ${ymd}`,
            profile_ids: [profileId],
            sort_field: 'spends',
            sort_type: 'desc',
            page,
            length: pageSize
        });
        let rows = extractPerformanceList(payload);
        if (!rows.length && payload && Array.isArray(payload.list)) {
            rows = payload.list;
        }
        all.push(...rows);
        if (rows.length < pageSize) break;
    }
    return all;
}

async function fetchEuAdsDailyReport({ todayYmd, callTool = callYanjunTool } = {}) {
    const dates = completeDayWindow(todayYmd);
    const shopsPayload = await callTool('lingxing_ad_auth_shops', {});
    const shops = listEuAdShops(shopsPayload);
    if (!shops.length) {
        const err = new Error('未找到欧洲广告授权店铺');
        err.status = 400;
        throw err;
    }

    const dailyByCountry = {};
    const failures = [];

    for (const shop of shops) {
        if (!dailyByCountry[shop.country]) dailyByCountry[shop.country] = {};
        for (const ymd of dates) {
            try {
                const rows = await queryCampaignRowsForDay({
                    profileId: shop.profileId,
                    ymd,
                    callTool
                });
                const totals = mapCampaignTotals(rows);
                dailyByCountry[shop.country][ymd] = mergeDayMetrics(
                    dailyByCountry[shop.country][ymd],
                    totals
                );
            } catch (error) {
                failures.push({
                    country: shop.country,
                    profileId: shop.profileId,
                    date: ymd,
                    message: error && error.message ? error.message : String(error)
                });
            }
        }
    }

    const matrix = buildReportMatrix({ dates, dailyByCountry });
    const suggestions = buildSuggestions(matrix);

    return {
        dates,
        rows: matrix.rows,
        suggestions,
        fetchedAt: new Date().toISOString(),
        failures,
        shops
    };
}

module.exports = {
    EU_COUNTRY_ORDER,
    METRIC_ORDER,
    metricLabel,
    shiftYmd,
    completeDayWindow,
    normalizeCountryCode,
    listEuAdShops,
    rowKey,
    buildReportMatrix,
    buildSuggestions,
    queryCampaignRowsForDay,
    fetchEuAdsDailyReport
};
