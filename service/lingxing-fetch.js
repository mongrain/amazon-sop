const { callYanjunTool } = require('./yanjun-mcp');
const {
    extractPerformanceList,
    findSprintPortfolioId,
    campaignMatchesAsin,
    sumCampaignAdMetrics
} = require('./lingxing-metrics');
const { resolveUs50ProfileId } = require('./lingxing-ads-optimize');

/** 领星店铺：50宴君北美站-US */
const LINGXING_SID_50_US = '17438';

async function queryProductPerformance({ startDate, endDate, asins, sids, offset = 0, length = 50, callTool = callYanjunTool }) {
    const args = {
        offset,
        length,
        start_date: startDate,
        end_date: endDate,
        currency_code: 'USD',
        search_field: 'asin',
        summary_field: 'asin'
    };
    if (sids) args.sids = sids;
    if (Array.isArray(asins) && asins.length) {
        args.search_value = asins;
    }
    const payload = await callTool('lingxing_query_product_performance_asin_lists', args);
    return extractPerformanceList(payload);
}

async function queryProductPerformanceAll({ startDate, endDate, asins, sids, callTool = callYanjunTool }) {
    const pageSize = 50;
    const all = [];
    let offset = 0;
    while (offset < 2000) {
        const page = await queryProductPerformance({
            startDate,
            endDate,
            asins,
            sids,
            offset,
            length: pageSize,
            callTool
        });
        all.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}

async function queryAdReportPages(toolName, baseArgs, callTool) {
    const pageSize = 50;
    const all = [];
    for (let page = 1; page <= 40; page += 1) {
        const payload = await callTool(toolName, {
            ...baseArgs,
            page,
            length: pageSize
        });
        const rows = extractPerformanceList(payload);
        all.push(...rows);
        if (rows.length < pageSize) break;
    }
    return all;
}

async function querySprintAdMetricsByAsin({ startDate, endDate, asins, callTool = callYanjunTool }) {
    const keys = [...new Set((asins || []).map((asin) => String(asin || '').trim().toUpperCase()).filter(Boolean))];
    const empty = {
        ad_impressions: null,
        clicks: null,
        ad_spend: null,
        ad_sales: null,
        ad_orders: null
    };
    const result = new Map();
    for (const key of keys) result.set(key, empty);

    if (keys.length === 0) return result;

    const shopsPayload = await callTool('lingxing_ad_auth_shops', {});
    const profileId = resolveUs50ProfileId(shopsPayload);
    if (profileId == null) {
        const err = new Error('未找到50宴君北美广告店铺');
        err.status = 400;
        throw err;
    }

    const report_date = `${startDate} - ${endDate}`;
    const commonArgs = {
        report_date,
        profile_ids: [profileId],
        sort_field: 'spends',
        sort_type: 'desc'
    };
    const portfolios = await queryAdReportPages('lingxing_ad_portfolio_report_shop', commonArgs, callTool);
    const portfolioId = findSprintPortfolioId(portfolios);
    if (!portfolioId) return result;

    const campaigns = await queryAdReportPages('lingxing_ad_campaign_report', {
        ...commonArgs,
        portfolio_id: String(portfolioId)
    }, callTool);

    for (const key of keys) {
        const matched = campaigns.filter((row) => campaignMatchesAsin(row, key));
        result.set(key, sumCampaignAdMetrics(matched));
    }
    return result;
}

module.exports = {
    LINGXING_SID_50_US,
    queryProductPerformance,
    queryProductPerformanceAll,
    querySprintAdMetricsByAsin
};
