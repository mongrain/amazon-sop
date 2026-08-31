const assert = require('assert');
const {
    pickNumeric,
    mapPerformanceRow,
    asinsToPrefill,
    rowHasAnyMetric,
    mergePrefillIntoRows,
    previousCompleteDay,
    sameDayRange,
    resolveMetricsPullRange,
    isEmptyField,
    fillEmptySprintFields,
    toFormPercent,
    sumFbaQty,
    extractPerformanceList,
    lookupFromPerformanceRow,
    isSprintPortfolioName,
    findSprintPortfolioId,
    campaignMatchesAsin,
    sumCampaignAdMetrics,
    overlaySprintAdMetrics
} = require('../service/lingxing-metrics');

assert.strictEqual(pickNumeric({ sessions: '12' }, ['sessions']), 12);
assert.strictEqual(pickNumeric({ session: 8 }, ['sessions', 'session']), 8);
assert.strictEqual(pickNumeric({ sessions: '' }, ['sessions']), null);
assert.strictEqual(pickNumeric({ sessions: 'x' }, ['sessions']), null);

const mapped = mapPerformanceRow({
    asin: 'B0ABC',
    order_num: 3,
    sales_amount: 120.5,
    ad_cost: 12,
    ad_sales: 80,
    impressions: 1000,
    clicks: 40,
    ad_order_num: 2,
    sessions: 90,
    core_kw_rank: 5,
    small_cate_rank: 12,
    cate_rank: 100
});
assert.strictEqual(mapped.asin, 'B0ABC');
assert.strictEqual(mapped.sessions, 90);
assert.strictEqual(mapped.orders, 3);
assert.strictEqual(mapped.impressions, 1000);
assert.strictEqual(mapped.ad_impressions, null);
assert.strictEqual(mapped.clicks, 40);
assert.strictEqual(mapped.ad_spend, 12);
assert.strictEqual(mapped.ad_sales, 80);
assert.strictEqual(mapped.total_sales, 120.5);
assert.strictEqual(mapped.ad_orders, 2);
assert.strictEqual(mapped.core_kw_rank, undefined);
assert.strictEqual(mapped.bsr_rank, 12);
assert.strictEqual(mapped.tacos, 9.96);

assert.deepStrictEqual(
    asinsToPrefill(['B0A', 'B0B', 'b0c'], ['b0a', 'B0X']),
    ['B0B', 'b0c']
);

assert.strictEqual(rowHasAnyMetric({ asin: 'B0A', sessions: '' }), false);
assert.strictEqual(rowHasAnyMetric({ asin: 'B0A', sessions: 1 }), true);
assert.strictEqual(rowHasAnyMetric({ asin: 'B0A', ad_spend: 0 }), true);

const merged = mergePrefillIntoRows(
    [
        { id: 1, asin: 'B0A', sessions: 9, orders: '', impressions: '', clicks: '', ad_spend: '', ad_sales: '', total_sales: '', ad_orders: '', bsr_rank: '' },
        { id: 2, asin: 'B0B', sessions: '', orders: '', impressions: '', clicks: '', ad_spend: '', ad_sales: '', total_sales: '', ad_orders: '', bsr_rank: '' }
    ],
    [
        { asin: 'B0A', sessions: 100, orders: 2, bsr_rank: 8 },
        { asin: 'B0B', sessions: 50, orders: 1, ad_spend: 3.2, bsr_rank: 12 }
    ]
);
assert.strictEqual(merged[0].sessions, 9);
assert.strictEqual(merged[0].bsr_rank, '');
assert.strictEqual(merged[1].sessions, 50);
assert.strictEqual(merged[1].orders, 1);
assert.strictEqual(merged[1].ad_spend, 3.2);
assert.strictEqual(merged[1].bsr_rank, 12);

assert.deepStrictEqual(previousCompleteDay('2026-08-13'), {
    start_date: '2026-08-12',
    end_date: '2026-08-12'
});

assert.deepStrictEqual(sameDayRange('2026-08-17'), {
    start_date: '2026-08-17',
    end_date: '2026-08-17'
});

const chinaMorning = new Date('2026-08-18T03:05:00.000Z');
assert.deepStrictEqual(resolveMetricsPullRange('2026-08-18', chinaMorning), {
    start_date: '2026-08-18',
    end_date: '2026-08-18'
});
assert.deepStrictEqual(resolveMetricsPullRange('2026-08-17', chinaMorning), {
    start_date: '2026-08-17',
    end_date: '2026-08-17'
});
assert.deepStrictEqual(resolveMetricsPullRange('2026-08-16', chinaMorning), {
    start_date: '2026-08-16',
    end_date: '2026-08-16'
});
assert.deepStrictEqual(resolveMetricsPullRange('2026-08-10', chinaMorning), {
    start_date: '2026-08-10',
    end_date: '2026-08-10'
});

assert.strictEqual(isEmptyField(''), true);
assert.strictEqual(isEmptyField('  '), true);
assert.strictEqual(isEmptyField(null), true);
assert.strictEqual(isEmptyField(0), false);
assert.strictEqual(isEmptyField('0.3'), false);

const filled = fillEmptySprintFields(
    { fba_warehouse_qty: '', ctr_7d: 0.4, cvr_7d: '', current_daily_orders: '', current_rank: '' },
    { fba_warehouse_qty: 120, ctr_7d: 0.9, cvr_7d: 8.5, current_daily_orders: 87, current_rank: '小类排名12名, 大类排名100名' }
);
assert.strictEqual(filled.fba_warehouse_qty, 120);
assert.strictEqual(filled.ctr_7d, 0.4);
assert.strictEqual(filled.cvr_7d, 8.5);
assert.strictEqual(filled.current_daily_orders, 87);
assert.strictEqual(filled.current_rank, '小类排名12名, 大类排名100名');

assert.strictEqual(toFormPercent(0.004), 0.4);
assert.strictEqual(toFormPercent(0.42), 42);
assert.strictEqual(toFormPercent(8.5), 8.5);
assert.strictEqual(toFormPercent(null), null);

assert.strictEqual(mapPerformanceRow({ tacos: 0.15 }).tacos, 15);
assert.strictEqual(mapPerformanceRow({ tacos: 15 }).tacos, 15);
assert.strictEqual(mapPerformanceRow({ ta_cos: 12 }).tacos, 12);
assert.strictEqual(mapPerformanceRow({ tacos_rate: 0.18 }).tacos, 18);
assert.strictEqual(mapPerformanceRow({ acoas: 0.0257 }).tacos, 2.57);
assert.strictEqual(mapPerformanceRow({ advertising_cost_of_sales: 0.2 }).tacos, null);
assert.strictEqual(mapPerformanceRow({ ad_cost: 10, amount: 50 }).tacos, 20);
assert.strictEqual(mapPerformanceRow({ tacos: 12, ad_cost: 10, amount: 50 }).tacos, 12);
assert.strictEqual(mapPerformanceRow({ ad_cost: 10, amount: 0 }).tacos, null);
assert.strictEqual(mapPerformanceRow({ ad_cost: 10 }).tacos, null);
assert.strictEqual(mapPerformanceRow({
    tacos: 0,
    acoas: 0,
    ad_cost: 32.48,
    amount: 1263.21
}).tacos, 2.57);
assert.strictEqual(mapPerformanceRow({
    tacos: '0.0000',
    acoas: '0.0000',
    spend: '0.00',
    amount: '1263.21'
}).tacos, null);

const { fillTacosFallback } = require('../service/lingxing-metrics');
assert.strictEqual(fillTacosFallback({ ad_spend: 10, total_sales: 80 }).tacos, 12.5);
assert.strictEqual(fillTacosFallback({ tacos: 9, ad_spend: 10, total_sales: 80 }).tacos, 9);

assert.strictEqual(sumFbaQty([
    { afn_fulfillable_quantity: 10 },
    { fulfillable_quantity: 5 },
    { quantity: 3 }
]), 18);

const realMapped = mapPerformanceRow({
    asin: 'B07SRSJZSL',
    sessions: 521,
    order_items: 585,
    impressions: 159511,
    clicks: 762,
    spend: '609.29',
    ad_sales_amount: '2319.60',
    amount: '9792.12',
    ad_order_quantity: 134
});
assert.strictEqual(realMapped.orders, 585);
assert.strictEqual(realMapped.ad_spend, 609.29);
assert.strictEqual(realMapped.ad_sales, 2319.6);
assert.strictEqual(realMapped.total_sales, 9792.12);
assert.strictEqual(realMapped.ad_orders, 134);
assert.strictEqual(realMapped.tacos, 6.22);

const asinLevelMapped = mapPerformanceRow({
    asin: 'B07SRSJZSL',
    sessions: 69,
    sessions_mobile: 304,
    sessions_total: 373,
    order_items: 78,
    volume: 80,
    orders: 9,
    amount: '1263.21',
    sales: '171.04',
    ad_sales_amount: '171.04',
    ad_order_quantity: 9,
    impressions: 28636,
    clicks: 148,
    spend: '0.00'
});
assert.strictEqual(asinLevelMapped.sessions, 373);
assert.strictEqual(asinLevelMapped.orders, 78);
assert.strictEqual(asinLevelMapped.total_sales, 1263.21);
assert.strictEqual(asinLevelMapped.ad_sales, 171.04);
assert.strictEqual(asinLevelMapped.ad_orders, 9);
assert.strictEqual(asinLevelMapped.ad_spend, null);
assert.strictEqual(asinLevelMapped.tacos, null);

assert.strictEqual(mapPerformanceRow({ order_num: 12, order_items: 20, orders: 3 }).orders, 12);

const delayedSessions = mapPerformanceRow({
    sessions: 0,
    sessions_total: 0,
    order_items: 64,
    amount: '1071.33'
});
assert.strictEqual(delayedSessions.sessions, null);
assert.strictEqual(delayedSessions.orders, 64);
assert.strictEqual(delayedSessions.total_sales, 1071.33);

assert.deepStrictEqual(
    lookupFromPerformanceRow({
        total_fulfillable: 6104,
        afn_fulfillable_quantity: 999,
        quantity: 14815,
        ctr: '0.0048',
        cvr: '0.2477',
        volume_avg_7d: '87.0',
        small_cate_rank: 12,
        cate_rank: 100
    }),
    {
        fba_warehouse_qty: 6104,
        ctr_7d: 0.48,
        cvr_7d: 24.77,
        current_daily_orders: 87,
        current_rank: '小类排名12名, 大类排名100名'
    }
);

assert.strictEqual(extractPerformanceList({ data: { data: { list: [{ asin: 'B0A' }] } } }).length, 1);
assert.strictEqual(extractPerformanceList({ data: { data: [{ campaign_id: 'c1' }] } }).length, 1);

assert.strictEqual(isSprintPortfolioName('C冲刺广告的分组'), true);
assert.strictEqual(isSprintPortfolioName(' C冲刺广告的分组 '), true);
assert.strictEqual(isSprintPortfolioName('C冲刺广告'), false);
assert.strictEqual(isSprintPortfolioName('B0XX-冲刺'), false);

assert.strictEqual(findSprintPortfolioId([
    { portfolio_name: '其它', portfolio_id: '1' },
    { name: 'C冲刺广告的分组', portfolio_id: '88' }
]), '88');
assert.strictEqual(findSprintPortfolioId([{ name: '其它', portfolio_id: '1' }]), null);

assert.strictEqual(campaignMatchesAsin({ asin: 'b0xx', campaign_name: 'x' }, 'B0XX'), true);
assert.strictEqual(campaignMatchesAsin({ campaign_name: 'B0XX-冲刺-自动' }, 'b0xx'), true);
assert.strictEqual(campaignMatchesAsin({ campaign_name: 'B0YY-冲刺' }, 'B0XX'), false);

assert.deepStrictEqual(sumCampaignAdMetrics([
    { impressions: 100, clicks: 10, spends: '1.2', sales: '8', orders: 2 },
    { impressions: 50, clicks: 5, spends: 0.8, sales: 4, orders: '1' }
]), {
    ad_impressions: 150,
    clicks: 15,
    ad_spend: 2,
    ad_sales: 12,
    ad_orders: 3
});
assert.deepStrictEqual(sumCampaignAdMetrics([]), {
    ad_impressions: null,
    clicks: null,
    ad_spend: null,
    ad_sales: null,
    ad_orders: null
});

const overlaid = overlaySprintAdMetrics(
    mapPerformanceRow({
        asin: 'B0XX',
        sessions_total: 373,
        order_items: 78,
        amount: '1263.21',
        impressions: 28636,
        clicks: 148,
        spend: '0.00',
        ad_sales_amount: '171.04',
        ad_order_quantity: 9
    }),
    sumCampaignAdMetrics([
        { campaign_name: 'B0XX-冲刺-自动', impressions: 900, clicks: 40, spends: 16.24, sales: 94.94, orders: 6 }
    ])
);
assert.strictEqual(overlaid.sessions, 373);
assert.strictEqual(overlaid.orders, 78);
assert.strictEqual(overlaid.total_sales, 1263.21);
assert.strictEqual(overlaid.impressions, 28636);
assert.strictEqual(overlaid.ad_impressions, 900);
assert.strictEqual(overlaid.clicks, 40);
assert.strictEqual(overlaid.ad_spend, 16.24);
assert.strictEqual(overlaid.ad_sales, 94.94);
assert.strictEqual(overlaid.ad_orders, 6);
assert.strictEqual(overlaid.tacos, 1.29);

const noSprintAds = overlaySprintAdMetrics(
    mapPerformanceRow({
        asin: 'B0XX',
        sessions_total: 10,
        order_items: 2,
        amount: 100,
        ad_order_quantity: 9,
        impressions: 500,
        clicks: 20,
        ad_sales_amount: 50
    }),
    sumCampaignAdMetrics([])
);
assert.strictEqual(noSprintAds.sessions, 10);
assert.strictEqual(noSprintAds.orders, 2);
assert.strictEqual(noSprintAds.total_sales, 100);
assert.strictEqual(noSprintAds.impressions, 500);
assert.strictEqual(noSprintAds.ad_impressions, null);
assert.strictEqual(noSprintAds.clicks, null);
assert.strictEqual(noSprintAds.ad_spend, null);
assert.strictEqual(noSprintAds.ad_sales, null);
assert.strictEqual(noSprintAds.ad_orders, null);
assert.strictEqual(noSprintAds.tacos, null);

const { querySprintAdMetricsByAsin } = require('../service/lingxing-fetch');

(async () => {
    const calls = [];
    const callTool = async (name, args) => {
        calls.push({ name, args });
        if (name === 'lingxing_ad_auth_shops') {
            return { list: [{ sid: '17438', profile_id: 3911921794447440, country: 'US' }] };
        }
        if (name === 'lingxing_ad_portfolio_report_shop') {
            return { data: { data: [
                { name: '其它', portfolio_id: '1' },
                { name: 'C冲刺广告的分组', portfolio_id: '88' }
            ] } };
        }
        if (name === 'lingxing_ad_campaign_report') {
            assert.strictEqual(String(args.portfolio_id), '88');
            assert.strictEqual(args.report_date, '2026-08-18 - 2026-08-18');
            return { data: { data: [
                { campaign_name: 'B0XX-冲刺-自动', asin: 'B0XX', impressions: 100, clicks: 10, spends: 5, sales: 20, orders: 2 },
                { campaign_name: 'B0YY-冲刺', asin: 'B0YY', impressions: 9, clicks: 1, spends: 1, sales: 3, orders: 1 }
            ] } };
        }
        throw new Error('unexpected ' + name);
    };
    const byAsin = await querySprintAdMetricsByAsin({
        startDate: '2026-08-18',
        endDate: '2026-08-18',
        asins: ['B0XX', 'B0ZZ'],
        callTool
    });
    assert.strictEqual(byAsin.get('B0XX').ad_impressions, 100);
    assert.strictEqual(byAsin.get('B0XX').ad_orders, 2);
    assert.strictEqual(byAsin.get('B0XX').ad_spend, 5);
    assert.strictEqual(byAsin.get('B0ZZ').ad_impressions, null);
    assert.strictEqual(byAsin.get('B0ZZ').ad_orders, null);
    console.log('ok');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
