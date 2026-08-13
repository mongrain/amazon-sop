const { callYanjunTool } = require('./yanjun-mcp');
const { extractPerformanceList } = require('./lingxing-metrics');

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

module.exports = {
    LINGXING_SID_50_US,
    queryProductPerformance,
    queryProductPerformanceAll
};
