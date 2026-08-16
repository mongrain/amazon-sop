const assert = require('assert');
const {
    toYmd,
    weekDateList,
    ymdDiffDays,
    currentSprintWeekStart,
    isOnSprintWeekGrid,
    planSprintReviewEnsure,
    ensureSprintCurrentReview,
    buildWeekDays,
    datesToPull,
    countSkippedExisting,
    decideReview,
    buildSummary,
    buildSuggestion,
    assembleReviewPayload,
    mappedHasMetric,
    computeDerivedMetrics,
    applySuggestion,
    isEmptyField
} = require('../service/weekly-review');

assert.strictEqual(toYmd('2026-08-10'), '2026-08-10');
assert.strictEqual(toYmd('2026-08-10T16:00:00.000Z').startsWith('2026-08-'), true);
assert.strictEqual(toYmd(new Date(2026, 7, 10)), '2026-08-10');
assert.strictEqual(toYmd(''), '');

assert.deepStrictEqual(weekDateList('2026-08-10'), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
    '2026-08-14', '2026-08-15', '2026-08-16'
]);

assert.strictEqual(ymdDiffDays('2026-08-12', '2026-08-12'), 0);
assert.strictEqual(ymdDiffDays('2026-08-12', '2026-08-19'), 7);
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-12'), '2026-08-12');
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-18'), '2026-08-12');
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-19'), '2026-08-19');
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-11'), null);
assert.strictEqual(isOnSprintWeekGrid('2026-08-12', '2026-08-12'), true);
assert.strictEqual(isOnSprintWeekGrid('2026-08-19', '2026-08-12'), true);
assert.strictEqual(isOnSprintWeekGrid('2026-08-10', '2026-08-12'), false);

const planned = planSprintReviewEnsure({
    startYmd: '2026-08-12',
    todayYmd: '2026-08-14',
    pendingWeekStarts: ['2026-08-10', '2026-08-12']
});
assert.strictEqual(planned.currentStart, '2026-08-12');
assert.deepStrictEqual(planned.deleteWeekStarts, ['2026-08-10']);

const week = buildWeekDays('2026-08-10', '2026-08-14', [
    { record_date: '2026-08-10', orders: 3, ad_spend: 10, total_sales: 100, tacos: 10, impressions: 1000, clicks: 40 },
    { record_date: '2026-08-11', orders: 5, ad_spend: 20, total_sales: 100, tacos: 20, impressions: 1000, clicks: 40 }
]);
assert.strictEqual(week.days.length, 7);
assert.strictEqual(week.start, '2026-08-10');
assert.strictEqual(week.end, '2026-08-16');
assert.strictEqual(week.today, '2026-08-14');
assert.strictEqual(week.days[0].status, 'filled');
assert.strictEqual(week.days[2].status, 'missing');
assert.strictEqual(week.days[4].status, 'upcoming');
assert.strictEqual(week.days[6].status, 'upcoming');
assert.strictEqual(week.totals.filled_days, 2);
assert.strictEqual(week.totals.orders_sum, 8);
assert.strictEqual(week.totals.ad_spend_sum, 30);
assert.strictEqual(week.totals.actual_max_loss, 30);
assert.strictEqual(week.totals.actual_tacos, 15);
assert.strictEqual(week.totals.avg_daily_orders, 4);
assert.strictEqual(week.totals.ctr, 4);
assert.strictEqual(week.totals.cvr, 10);
assert.strictEqual(week.totals.cpc, 0.38);

assert.deepStrictEqual(datesToPull(week.days), ['2026-08-12', '2026-08-13']);
assert.strictEqual(countSkippedExisting(week.days), 2);

assert.strictEqual(decideReview({
    actual_max_loss: 80, actual_tacos: 10, avg_daily_orders: 9, filled_days: 3
}, { max_loss_7d: 70, stable_tacos_target: 15, target_daily_orders: 5 }), 'STOPPED');

assert.strictEqual(decideReview({
    actual_max_loss: 50, actual_tacos: 14, avg_daily_orders: 5, filled_days: 3
}, { max_loss_7d: 70, stable_tacos_target: 15, target_daily_orders: 5 }), 'MAINTENANCE');

assert.strictEqual(decideReview({
    actual_max_loss: 50, actual_tacos: 20, avg_daily_orders: 5, filled_days: 3
}, { max_loss_7d: 70, stable_tacos_target: 15, target_daily_orders: 5 }), 'CONTINUE');

assert.strictEqual(decideReview({
    actual_max_loss: 80, actual_tacos: 10, avg_daily_orders: 9, filled_days: 3
}, { max_loss_7d: null, stable_tacos_target: 15, target_daily_orders: 5 }), 'MAINTENANCE');

assert.strictEqual(decideReview({
    actual_max_loss: 50, actual_tacos: 14, avg_daily_orders: 5, filled_days: 3
}, { max_loss_7d: 70, stable_tacos_target: 15, target_daily_orders: null }), 'CONTINUE');

const emptyWeek = buildWeekDays('2026-08-10', '2026-08-14', []);
assert.strictEqual(emptyWeek.totals.filled_days, 0);
assert.strictEqual(emptyWeek.totals.actual_max_loss, null);
assert.strictEqual(emptyWeek.totals.actual_tacos, null);
assert.strictEqual(decideReview(emptyWeek.totals, { max_loss_7d: 70, stable_tacos_target: 15, target_daily_orders: 5 }), 'CONTINUE');

const emptySuggestion = buildSuggestion(emptyWeek, { max_loss_7d: 70, stable_tacos_target: 15, target_daily_orders: 5 });
assert.strictEqual(emptySuggestion.decision, 'CONTINUE');
assert.strictEqual(emptySuggestion.actual_max_loss, null);
assert.ok(emptySuggestion.summary.includes('本周暂无日报'));

const stoppedSummary = buildSummary({
    weekStart: '2026-08-10',
    weekEnd: '2026-08-16',
    totals: { filled_days: 2, actual_max_loss: 80, actual_tacos: 20, avg_daily_orders: 4, ctr: 0.4, cvr: 8, cpc: 0.8 },
    sprint: { max_loss_7d: 70, promo_tacos_limit: 25, stable_tacos_target: 15, target_daily_orders: 5, ctr_7d: 0.4, cvr_7d: 8, cpc: 0.8 },
    decision: 'STOPPED'
});
assert.ok(stoppedSummary.includes('已超线'));
assert.ok(stoppedSummary.includes('本周广告花费已达或超过 7 天最大亏损额度'));

assert.strictEqual(mappedHasMetric({ asin: 'B0A' }), false);
assert.strictEqual(mappedHasMetric({ asin: 'B0A', sessions: 1 }), true);
assert.strictEqual(mappedHasMetric({ asin: 'B0A', ad_spend: 0 }), true);

const derived = computeDerivedMetrics({
    ad_spend: 10, ad_sales: 50, total_sales: 100, impressions: 1000, clicks: 40, orders: 4
});
assert.strictEqual(derived.acos, 20);
assert.strictEqual(derived.tacos, 10);
assert.strictEqual(derived.ctr, 0.04);
assert.strictEqual(derived.cvr, 0.1);

assert.strictEqual(computeDerivedMetrics({
    ad_spend: 10, ad_sales: 50, total_sales: 100, tacos: 12
}).tacos, 12);
assert.strictEqual(computeDerivedMetrics({
    ad_spend: 10, total_sales: 100
}).tacos, 10);
assert.strictEqual(computeDerivedMetrics({
    ad_spend: 10, total_sales: 0, tacos: 8
}).tacos, 8);
assert.strictEqual(computeDerivedMetrics({
    ad_spend: 10, total_sales: 0
}).tacos, null);

assert.strictEqual(isEmptyField(''), true);
assert.strictEqual(isEmptyField(0), false);

const filledForm = applySuggestion(
    { actual_max_loss: 1, actual_tacos: '', decision: '', summary: '' },
    { actual_max_loss: 80, actual_tacos: 15, decision: 'CONTINUE', summary: 'x' }
);
assert.strictEqual(filledForm.actual_max_loss, 1);
assert.strictEqual(filledForm.actual_tacos, 15);
assert.strictEqual(filledForm.decision, 'CONTINUE');

const payload = assembleReviewPayload({
    review: { id: 1, sprint_id: 12, asin: 'B0XX', week_start_date: '2026-08-10', status: 'PENDING' },
    sprint: { sprint_goal: '冲量', target_daily_orders: 5, max_loss_7d: 70, stable_tacos_target: 15, promo_tacos_limit: 25 },
    metricRows: [{ record_date: '2026-08-10', orders: 3, ad_spend: 10, total_sales: 100, tacos: 10, impressions: 1000, clicks: 40 }],
    todayYmd: '2026-08-14'
});
assert.strictEqual(payload.review.asin, 'B0XX');
assert.strictEqual(payload.sprint.sprint_goal, '冲量');
assert.strictEqual(payload.week.days.length, 7);
assert.strictEqual(payload.suggestion.decision, 'CONTINUE');

(async () => {
    const sqls = [];
    await ensureSprintCurrentReview({
        sprintId: 12,
        startYmd: '2026-08-12',
        todayYmd: '2026-08-14',
        queryAll: async () => [
            { week_start_date: '2026-08-10' },
            { week_start_date: '2026-08-12' }
        ],
        runSql: async (sql, params) => { sqls.push({ sql, params }); }
    });
    assert.ok(sqls.some((s) => String(s.sql).includes('DELETE') && s.params[2] === '2026-08-10'));
    assert.ok(!sqls.some((s) => String(s.sql).includes('DELETE') && s.params[2] === '2026-08-12'));
    assert.ok(sqls.some((s) => String(s.sql).includes('INSERT IGNORE') && s.params[1] === '2026-08-12'));

    const none = [];
    await ensureSprintCurrentReview({
        sprintId: 12,
        startYmd: '2026-08-20',
        todayYmd: '2026-08-14',
        queryAll: async () => [{ week_start_date: '2026-08-10' }],
        runSql: async (sql, params) => { none.push({ sql, params }); }
    });
    assert.ok(none.some((s) => String(s.sql).includes('DELETE')));
    assert.ok(!none.some((s) => String(s.sql).includes('INSERT')));

    console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
