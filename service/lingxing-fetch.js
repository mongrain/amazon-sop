const { callYanjunTool } = require('./yanjun-mcp');
const { extractPerformanceList } = require('./lingxing-metrics');

async function queryProductPerformance({ startDate, endDate, asins, offset = 0, length = 50, callTool = callYanjunTool }) {
    const args = {
        offset,
        length,
        start_date: startDate,
        end_date: endDate,
        currency_code: 'USD',
        search_field: 'asin',
        summary_field: 'asin'
    };
    if (Array.isArray(asins) && asins.length) {
        args.search_value = asins;
    }
    const payload = await callTool('lingxing_query_product_performance_asin_lists', args);
    return extractPerformanceList(payload);
}

async function queryProductPerformanceAll({ startDate, endDate, asins, callTool = callYanjunTool }) {
    const pageSize = 50;
    const all = [];
    let offset = 0;
    while (offset < 2000) {
        const page = await queryProductPerformance({
            startDate,
            endDate,
            asins,
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
    queryProductPerformance,
    queryProductPerformanceAll
};
