const assert = require('assert');
const {
    generateOptimizePlan,
    buildOptimizeUserContent,
    OPTIMIZE_SYSTEM_PROMPT,
    buildWeekDays
} = require('../service/weekly-review');

assert.ok(
    OPTIMIZE_SYSTEM_PROMPT.includes('换打法') || OPTIMIZE_SYSTEM_PROMPT.includes('不要编造')
);
assert.ok(OPTIMIZE_SYSTEM_PROMPT.includes('CONTINUE'));

const optWeek = buildWeekDays('2026-08-10', '2026-08-14', [
    { record_date: '2026-08-10', orders: 3, ad_spend: 10, total_sales: 100, tacos: 10 }
]);
const userContent = buildOptimizeUserContent({
    review: { asin: 'B0XX' },
    sprint: {
        sprint_goal: '冲量',
        target_daily_orders: 5,
        ctr_7d: 0.4,
        cvr_7d: 8,
        cpc: 0.8,
        promo_tacos_limit: 25,
        stable_tacos_target: 15,
        max_loss_7d: 70,
        budget_cap: 200
    },
    week: optWeek,
    suggestion: { decision: 'CONTINUE' },
    ads: { campaigns: [{ name: 'B0XX-冲刺' }], keywords: [], search_terms: [] }
});
assert.ok(userContent.includes('B0XX'));
assert.ok(userContent.includes('冲量'));
assert.ok(userContent.includes('CONTINUE'));
assert.ok(userContent.includes('suggested_decision'));
assert.ok(userContent.includes('B0XX-冲刺'));
assert.ok(userContent.includes('campaigns'));

let chatCalls = 0;
const chatFn = async (sys, user) => {
    chatCalls += 1;
    assert.strictEqual(sys, OPTIMIZE_SYSTEM_PROMPT);
    assert.ok(user.includes('B0XX'));
    return '  - 控花费\n- 冲单量  ';
};

(async () => {
    const generated = await generateOptimizePlan({
        review: { asin: 'B0XX', optimization_plan: '' },
        sprint: { sprint_goal: '冲量' },
        week: optWeek,
        suggestion: { decision: 'CONTINUE' },
        ads: { campaigns: [], keywords: [], search_terms: [] },
        chatFn
    });
    assert.strictEqual(generated.summary, '- 控花费\n- 冲单量');
    assert.strictEqual(generated.optimization_plan, generated.summary);
    assert.strictEqual(chatCalls, 1);

    chatCalls = 0;
    const overwritten = await generateOptimizePlan({
        review: { asin: 'B0XX', optimization_plan: '已有方案' },
        sprint: {},
        week: optWeek,
        suggestion: { decision: 'CONTINUE' },
        ads: { campaigns: [], keywords: [], search_terms: [] },
        chatFn
    });
    assert.strictEqual(overwritten.summary, '- 控花费\n- 冲单量');
    assert.strictEqual(overwritten.optimization_plan, overwritten.summary);
    assert.strictEqual(chatCalls, 1);

    chatCalls = 0;
    let emptyErr = null;
    try {
        await generateOptimizePlan({
            review: { asin: 'B0XX', optimization_plan: '   ' },
            sprint: {},
            week: optWeek,
            suggestion: { decision: 'CONTINUE' },
            ads: { campaigns: [], keywords: [], search_terms: [] },
            chatFn: async () => '   '
        });
    } catch (e) {
        emptyErr = e;
    }
    assert.ok(emptyErr);
    assert.strictEqual(emptyErr.status, 502);

    console.log('ok');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
