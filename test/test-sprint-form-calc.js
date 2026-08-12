const assert = require('assert');
const {
    calcEndDate,
    calcRequiredImpressions,
    calcBudgetCap,
    calcFinanceDefaults
} = require('../frontend/src/utils/sprint-form-calc.js');

assert.strictEqual(calcEndDate('2026-08-01', 14), '2026-08-14');
assert.strictEqual(calcEndDate('', 14), '');
assert.strictEqual(calcRequiredImpressions(10, 0.5, 10), 20000); // 10 / (0.005 * 0.1)
assert.strictEqual(calcRequiredImpressions(10, 0, 10), null);
assert.strictEqual(calcBudgetCap(20000, 0.5), 10000);
assert.deepStrictEqual(
    calcFinanceDefaults({ profitMarginRatio: 0.25, profitUsd: 2, currentDailyOrders: 5 }),
    { profit_margin_pct: 25, promo_tacos_limit: 25, stable_tacos_target: 15, max_loss_7d: 70 }
);
assert.strictEqual(
    calcFinanceDefaults({ profitMarginRatio: 0.25, profitUsd: 2, currentDailyOrders: null }).max_loss_7d,
    null
);
assert.deepStrictEqual(
    calcFinanceDefaults({ profitMarginRatio: null, profitUsd: 2, currentDailyOrders: 5 }),
    { profit_margin_pct: null, promo_tacos_limit: null, stable_tacos_target: null, max_loss_7d: 70 }
);
assert.strictEqual(
    calcFinanceDefaults({ profitMarginRatio: 0.25, profitUsd: null, currentDailyOrders: 5 }).max_loss_7d,
    null
);
assert.strictEqual(
    calcFinanceDefaults({ profitMarginRatio: 0.25, profitUsd: 0, currentDailyOrders: 5 }).max_loss_7d,
    0
);
console.log('ok');
