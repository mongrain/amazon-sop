const assert = require('assert');
const {
    pickNumeric,
    mapPerformanceRow,
    asinsToPrefill,
    rowHasAnyMetric,
    mergePrefillIntoRows,
    previousCompleteDay,
    isEmptyField,
    fillEmptySprintFields,
    toFormPercent,
    sumFbaQty,
    extractPerformanceList,
    lookupFromPerformanceRow
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
assert.strictEqual(mapped.clicks, 40);
assert.strictEqual(mapped.ad_spend, 12);
assert.strictEqual(mapped.ad_sales, 80);
assert.strictEqual(mapped.total_sales, 120.5);
assert.strictEqual(mapped.ad_orders, 2);
assert.strictEqual(mapped.core_kw_rank, undefined);
assert.strictEqual(mapped.bsr_rank, 12);

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

console.log('ok');
