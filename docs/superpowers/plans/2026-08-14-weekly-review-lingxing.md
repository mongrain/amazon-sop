# 周复盘领星补缺天 + 规则结论 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 周复盘填写页展示该周每日填报并对照冲刺目标/财务风控；手动「从领星拉取」只补本周已过缺天并写入日报；规则预填空着的亏损、TACOS、决策和结论。

**Architecture:** 周窗口、汇总、决策、结论文案放 `service/weekly-review.js` 纯函数。`GET /api/reviews/:id` 只读拼装；`POST /api/reviews/:id/lingxing-pull` 按天调现有 `queryProductPerformanceAll` 后写 `daily_asin_metrics`。前端只打本系统登录接口，空字段才套建议。

**Tech Stack:** Node + Express + Vue 3；测试用现有 `node test/*.js` + `assert`；不新增 npm 依赖。

## Global Constraints

- 周窗口 = 该条 `week_start_date` 周一到 +6 天周日，不看更早历史
- 打开详情不调领星；只手动点「从领星拉取」
- 只补 `日期 < 今天` 且该 ASIN 无日报的天；已有行不覆盖
- 领星按天 `start_date = end_date = 该日`，`currency_code=USD`；不拉关键词、广告活动、搜索词
- 写入 `data_source=MANUAL`；不新增来源枚举；不新增 `weekly_reviews` 列
- 本周实际最大亏损 = 本周 `ad_spend` 合计；TACOS = 花费合计 / 总销售额合计 × 100
- 决策：花费 ≥ `max_loss_7d` → STOPPED；否则 TACOS ≤ `stable_tacos_target` 且日均单量 ≥ `target_daily_orders` → MAINTENANCE；否则 CONTINUE
- 只预填空字段（`0` 不算空）；`COMPLETED` 不拉、不套建议
- 不改 `POST /api/v1/metrics/upload` 对外行为；不改 `POST /api/reviews/:id` 保存与项目状态同步
- yanjun URL 仅服务端 `YANJUN_MCP_URL`，不进前端
- 不调 GPT；不引入领星官方 SDK

## File Structure

- Create: `service/weekly-review.js` — 周日期、状态、汇总、决策、结论、拼装 payload、待拉日期、派生指标
- Create: `test/test-weekly-review.js`
- Modify: `routes/page-api.js` — 扩展 `GET /api/reviews/:id`；新增 `POST /api/reviews/:id/lingxing-pull`
- Modify: `frontend/src/views/ReviewFormView.js` — 本周表、对照、拉取按钮、空字段套建议
- 不改: `ReviewsView.js`、`server.js` 的 upload、冲刺保存

---

### Task 1: 周复盘纯函数

**Files:**
- Create: `service/weekly-review.js`
- Test: `test/test-weekly-review.js`

**Interfaces:**
- Consumes: `METRIC_KEYS` from `service/lingxing-metrics.js`（仅 `mappedHasMetric`）
- Produces:
  - `toYmd(value)` → `'YYYY-MM-DD'` 或 `''`。`Date` 用本地年月日；字符串取前导 `YYYY-MM-DD`
  - `weekDateList(weekStartYmd)` → 7 个日期字符串
  - `buildWeekDays(weekStartYmd, todayYmd, metricRows)` → `{ start, end, today, days, totals }`。`days` 恒 7 条；`status` 为 `filled` / `missing` / `upcoming`
  - `datesToPull(days)` → `status === 'missing'` 的日期数组
  - `countSkippedExisting(days)` → `filled` 天数
  - `decideReview(totals, sprint)` → `'STOPPED' | 'MAINTENANCE' | 'CONTINUE'`
  - `buildSummary({ weekStart, weekEnd, totals, sprint, decision })` → 中文结论
  - `buildSuggestion(week, sprint)` → `{ actual_max_loss, actual_tacos, decision, summary }`
  - `assembleReviewPayload({ review, sprint, metricRows, todayYmd })` → `{ review, sprint, week, suggestion }`
  - `mappedHasMetric(mapped)` → 任一 `METRIC_KEYS` 为有限数字
  - `computeDerivedMetrics(row)` → `{ acos, tacos, ctr, cvr }`，公式与 upload 相同
  - `applySuggestion(form, suggestion)` → 只填空字段；`0` 不覆盖
  - `isEmptyField(v)` → 空 / 空白为 true；`0` 为 false

`totals` 字段：`filled_days`, `orders_sum`, `ad_spend_sum`, `total_sales_sum`, `impressions_sum`, `clicks_sum`, `actual_max_loss`, `actual_tacos`, `avg_daily_orders`, `ctr`, `cvr`, `cpc`。0 天日报时 `actual_max_loss` / `actual_tacos` / `avg_daily_orders` 为 `null`。金额与 TACOS、CPC 保留 2 位小数；CTR/CVR 百分数保留 4 位；日均单量 2 位。

- [ ] **Step 1: Write the failing test**

创建 `test/test-weekly-review.js`：

```javascript
const assert = require('assert');
const {
    toYmd,
    weekDateList,
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

console.log('ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-weekly-review.js`

Expected: FAIL，`Cannot find module '../service/weekly-review'`

- [ ] **Step 3: Write minimal implementation**

创建 `service/weekly-review.js`：

```javascript
const { METRIC_KEYS } = require('./lingxing-metrics');

function isEmptyField(v) {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function toYmd(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const yyyy = value.getFullYear();
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        const dd = String(value.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    const s = String(value || '').trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : '';
}

function shiftYmd(ymd, days) {
    const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function weekDateList(weekStartYmd) {
    const start = toYmd(weekStartYmd);
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(shiftYmd(start, i));
    return dates;
}

function numOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function roundTo(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}

function sumKey(days, key) {
    let sum = 0;
    for (const day of days || []) {
        if (day.status !== 'filled') continue;
        const n = numOrNull(day[key]);
        sum += n == null ? 0 : n;
    }
    return sum;
}

function aggregateWeek(days) {
    const filled_days = (days || []).filter((d) => d.status === 'filled').length;
    const orders_sum = sumKey(days, 'orders');
    const ad_spend_sum = sumKey(days, 'ad_spend');
    const total_sales_sum = sumKey(days, 'total_sales');
    const impressions_sum = sumKey(days, 'impressions');
    const clicks_sum = sumKey(days, 'clicks');
    const actual_max_loss = filled_days === 0 ? null : roundTo(ad_spend_sum, 2);
    const actual_tacos = filled_days === 0 || total_sales_sum <= 0
        ? null
        : roundTo(ad_spend_sum / total_sales_sum * 100, 2);
    const avg_daily_orders = filled_days === 0 ? null : roundTo(orders_sum / filled_days, 2);
    const ctr = impressions_sum <= 0 ? null : roundTo(clicks_sum / impressions_sum * 100, 4);
    const cvr = clicks_sum <= 0 ? null : roundTo(orders_sum / clicks_sum * 100, 4);
    const cpc = clicks_sum <= 0 ? null : roundTo(ad_spend_sum / clicks_sum, 2);
    return {
        filled_days, orders_sum, ad_spend_sum, total_sales_sum, impressions_sum, clicks_sum,
        actual_max_loss, actual_tacos, avg_daily_orders, ctr, cvr, cpc
    };
}

function buildWeekDays(weekStartYmd, todayYmd, metricRows) {
    const dates = weekDateList(weekStartYmd);
    const today = toYmd(todayYmd);
    const byDate = new Map();
    for (const row of metricRows || []) {
        const d = toYmd(row.record_date);
        if (d) byDate.set(d, row);
    }
    const days = dates.map((date) => {
        const row = byDate.get(date);
        if (row) {
            return {
                date,
                status: 'filled',
                orders: numOrNull(row.orders),
                ad_spend: numOrNull(row.ad_spend),
                total_sales: numOrNull(row.total_sales),
                tacos: numOrNull(row.tacos),
                impressions: numOrNull(row.impressions),
                clicks: numOrNull(row.clicks)
            };
        }
        return {
            date,
            status: date >= today ? 'upcoming' : 'missing',
            orders: null,
            ad_spend: null,
            total_sales: null,
            tacos: null,
            impressions: null,
            clicks: null
        };
    });
    return {
        start: dates[0],
        end: dates[6],
        today,
        days,
        totals: aggregateWeek(days)
    };
}

function datesToPull(days) {
    return (days || []).filter((d) => d.status === 'missing').map((d) => d.date);
}

function countSkippedExisting(days) {
    return (days || []).filter((d) => d.status === 'filled').length;
}

function finiteOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function decideReview(totals, sprint) {
    const spend = totals && totals.actual_max_loss;
    const tacos = totals && totals.actual_tacos;
    const avg = totals && totals.avg_daily_orders;
    const maxLoss = finiteOrNull(sprint && sprint.max_loss_7d);
    const stable = finiteOrNull(sprint && sprint.stable_tacos_target);
    const targetOrders = finiteOrNull(sprint && sprint.target_daily_orders);
    if (maxLoss !== null && spend !== null && spend >= maxLoss) return 'STOPPED';
    if (stable !== null && tacos !== null && targetOrders !== null && avg !== null
        && tacos <= stable && avg >= targetOrders) {
        return 'MAINTENANCE';
    }
    return 'CONTINUE';
}

function fmtNum(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
    return String(roundTo(Number(v), digits));
}

function buildSummary({ weekStart, weekEnd, totals, sprint, decision }) {
    const filled = totals && totals.filled_days ? totals.filled_days : 0;
    if (filled === 0) {
        return `本周区间：${weekStart} ~ ${weekEnd}，已填 0/7 天。\n本周暂无日报。\n建议：CONTINUE。原因：本周暂无日报。`;
    }
    const maxLoss = finiteOrNull(sprint && sprint.max_loss_7d);
    const spend = totals.actual_max_loss;
    let spendLine = `花费合计 $${fmtNum(spend, 2)}`;
    if (maxLoss === null) spendLine += '（7天最大亏损额度未设）。';
    else if (spend !== null && spend >= maxLoss) spendLine += `（7天最大亏损额度 $${fmtNum(maxLoss, 2)}）：已超线。`;
    else spendLine += `（7天最大亏损额度 $${fmtNum(maxLoss, 2)}）：未超线。`;

    const promo = finiteOrNull(sprint && sprint.promo_tacos_limit);
    const stable = finiteOrNull(sprint && sprint.stable_tacos_target);
    let tacosLine = `本周 TACOS ${totals.actual_tacos == null ? '-' : fmtNum(totals.actual_tacos, 2) + '%'}`;
    const tacosBits = [];
    if (promo !== null) tacosBits.push(`推广期允许 ${fmtNum(promo, 2)}%`);
    if (stable !== null) tacosBits.push(`稳定期目标 ${fmtNum(stable, 2)}%`);
    if (tacosBits.length) tacosLine += `（${tacosBits.join('，')}）。`;
    else tacosLine += '。';

    const targetOrders = finiteOrNull(sprint && sprint.target_daily_orders);
    let ordersLine = `日均单量 ${fmtNum(totals.avg_daily_orders, 2)}`;
    if (targetOrders === null) ordersLine += '（目标未设）。';
    else if (totals.avg_daily_orders !== null && totals.avg_daily_orders >= targetOrders) {
        ordersLine += `（目标 ${fmtNum(targetOrders, 2)}）：已达标。`;
    } else {
        ordersLine += `（目标 ${fmtNum(targetOrders, 2)}）：未达标。`;
    }

    const metricBits = [];
    if (totals.ctr != null) {
        const goal = finiteOrNull(sprint && sprint.ctr_7d);
        metricBits.push(`本周 CTR ${fmtNum(totals.ctr, 4)}%${goal === null ? '' : `（目标 ${fmtNum(goal, 4)}%）`}`);
    }
    if (totals.cvr != null) {
        const goal = finiteOrNull(sprint && sprint.cvr_7d);
        metricBits.push(`CVR ${fmtNum(totals.cvr, 4)}%${goal === null ? '' : `（目标 ${fmtNum(goal, 4)}%）`}`);
    }
    if (totals.cpc != null) {
        const goal = finiteOrNull(sprint && sprint.cpc);
        metricBits.push(`CPC $${fmtNum(totals.cpc, 2)}${goal === null ? '' : `（目标 $${fmtNum(goal, 2)}）`}`);
    }

    let reason = '未触发停止或转维护条件';
    if (decision === 'STOPPED') reason = '本周广告花费已达或超过 7 天最大亏损额度';
    if (decision === 'MAINTENANCE') reason = '本周 TACOS 不高于稳定期目标且日均单量达到目标';

    const lines = [
        `本周区间：${weekStart} ~ ${weekEnd}，已填 ${filled}/7 天。`,
        spendLine,
        tacosLine,
        ordersLine
    ];
    if (metricBits.length) lines.push(metricBits.join('；') + '。');
    lines.push(`建议：${decision}。原因：${reason}。`);
    return lines.join('\n');
}

function buildSuggestion(week, sprint) {
    const totals = (week && week.totals) || aggregateWeek([]);
    const decision = decideReview(totals, sprint || {});
    return {
        actual_max_loss: totals.actual_max_loss,
        actual_tacos: totals.actual_tacos,
        decision,
        summary: buildSummary({
            weekStart: week && week.start,
            weekEnd: week && week.end,
            totals,
            sprint: sprint || {},
            decision
        })
    };
}

function pickSprint(sprint) {
    const src = sprint || {};
    return {
        sprint_goal: src.sprint_goal == null ? null : src.sprint_goal,
        target_daily_orders: numOrNull(src.target_daily_orders),
        ctr_7d: numOrNull(src.ctr_7d),
        cvr_7d: numOrNull(src.cvr_7d),
        cpc: numOrNull(src.cpc),
        promo_tacos_limit: numOrNull(src.promo_tacos_limit),
        stable_tacos_target: numOrNull(src.stable_tacos_target),
        max_loss_7d: numOrNull(src.max_loss_7d),
        profit_margin: numOrNull(src.profit_margin),
        budget_cap: numOrNull(src.budget_cap)
    };
}

function assembleReviewPayload({ review, sprint, metricRows, todayYmd }) {
    const weekStart = toYmd(review && review.week_start_date);
    const week = buildWeekDays(weekStart, todayYmd, metricRows);
    return {
        review,
        sprint: pickSprint(sprint),
        week,
        suggestion: buildSuggestion(week, sprint)
    };
}

function mappedHasMetric(mapped) {
    return METRIC_KEYS.some((key) => {
        const n = Number(mapped && mapped[key]);
        return mapped && mapped[key] !== '' && mapped[key] !== null && mapped[key] !== undefined
            && String(mapped[key]).trim() !== '' && Number.isFinite(n);
    });
}

function computeDerivedMetrics(row) {
    const ad_spend = numOrNull(row && row.ad_spend);
    const ad_sales = numOrNull(row && row.ad_sales);
    const total_sales = numOrNull(row && row.total_sales);
    const impressions = numOrNull(row && row.impressions);
    const clicks = numOrNull(row && row.clicks);
    const orders = numOrNull(row && row.orders);
    const acos = ad_sales && ad_sales > 0 && ad_spend !== null ? ad_spend / ad_sales * 100 : null;
    const tacos = total_sales && total_sales > 0 && ad_spend !== null ? ad_spend / total_sales * 100 : null;
    const ctr = impressions && impressions > 0 && clicks !== null ? clicks / impressions : null;
    const cvr = clicks && clicks > 0 && orders !== null ? orders / clicks : null;
    return { acos, tacos, ctr, cvr };
}

function applySuggestion(form, suggestion) {
    const next = { ...(form || {}) };
    const src = suggestion || {};
    for (const key of ['actual_max_loss', 'actual_tacos', 'decision', 'summary']) {
        if (isEmptyField(next[key]) && src[key] !== null && src[key] !== undefined && src[key] !== '') {
            next[key] = src[key];
        }
    }
    return next;
}

module.exports = {
    isEmptyField,
    toYmd,
    weekDateList,
    buildWeekDays,
    datesToPull,
    countSkippedExisting,
    decideReview,
    buildSummary,
    buildSuggestion,
    assembleReviewPayload,
    mappedHasMetric,
    computeDerivedMetrics,
    applySuggestion
};
```

CPC 期望：`30 / 80 = 0.375` → `roundTo(..., 2) = 0.38`。CTR：`80/2000*100 = 4`。CVR：`8/80*100 = 10`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-weekly-review.js`

Expected: 打印 `ok`，exit 0。若 CPC/CTR 断言因四舍五入失败，按 `roundTo` 规则改测试期望，不改业务公式。

- [ ] **Step 5: Commit**

```bash
git add test/test-weekly-review.js service/weekly-review.js
git commit -m "feat: 周复盘汇总决策与结论文案纯函数"
```

---

### Task 2: 扩展 GET `/api/reviews/:id`

**Files:**
- Modify: `routes/page-api.js`（约 755–770 行的 `GET /api/reviews/:id`）

**Interfaces:**
- Consumes: `assembleReviewPayload`, `toYmd`, `weekDateList` from `service/weekly-review.js`；`toDateString` from ctx
- Produces: `loadReviewBundle(id, todayYmd)` → payload 或 `null`；GET 返回 `{ review, sprint, week, suggestion }`。`review` 仍含 `asin`。不调领星、不写库。

在文件顶部现有 lingxing require 旁增加：

```javascript
const {
    assembleReviewPayload,
    toYmd,
    weekDateList
} = require('../service/weekly-review');
```

在 `registerProtectedPageApi` 里、`app.get('/api/reviews/:id'` 之前加入 `loadReviewBundle`（Task 3 复用，不要写在 handler 里再 require）：

```javascript
    async function loadReviewBundle(id, todayYmd) {
        const review = await queryOne(
            `SELECT wr.*, sp.asin
             FROM weekly_reviews wr
             JOIN sprint_projects sp ON wr.sprint_id = sp.id
             WHERE wr.id = ?`,
            [id]
        );
        if (!review) return null;
        const sprint = await queryOne(
            `SELECT sprint_goal, target_daily_orders, ctr_7d, cvr_7d, cpc,
                    promo_tacos_limit, stable_tacos_target, max_loss_7d, profit_margin, budget_cap
             FROM sprint_projects WHERE id = ?`,
            [review.sprint_id]
        ) || {};
        const dates = weekDateList(toYmd(review.week_start_date));
        const metrics = dates.length
            ? await queryAll(
                `SELECT record_date, orders, impressions, clicks, ad_spend, total_sales, tacos
                 FROM daily_asin_metrics
                 WHERE asin = ? AND record_date BETWEEN ? AND ?`,
                [review.asin, dates[0], dates[6]]
            )
            : [];
        return assembleReviewPayload({ review, sprint, metricRows: metrics, todayYmd });
    }

    app.get('/api/reviews/:id', async (req, res) => {
        try {
            const bundle = await loadReviewBundle(Number(req.params.id), toDateString(new Date()));
            if (!bundle) return res.status(404).json({ error: '复盘不存在' });
            res.json(bundle);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
```

- [ ] **Step 1: 顶部 require，加入 `loadReviewBundle`，GET 只调用它**
- [ ] **Step 2: Run** `node test/test-weekly-review.js`

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/page-api.js
git commit -m "feat: 周复盘详情返回本周日报与规则建议"
```

---

### Task 3: POST `/api/reviews/:id/lingxing-pull`

**Files:**
- Modify: `routes/page-api.js`（紧挨 `GET /api/reviews/:id` 之后、现有 `POST /api/reviews/:id` 之前）

**Interfaces:**
- Consumes: `queryProductPerformanceAll`, `LINGXING_SID_50_US`, `mapPerformanceRow`, `METRIC_KEYS`；`weekDateList`, `assembleReviewPayload`, `datesToPull`, `countSkippedExisting`, `mappedHasMetric`, `computeDerivedMetrics`, `toYmd`
- Produces: 成功 `{ filled, skipped_existing, missing_in_lingxing, week, suggestion }`；`COMPLETED` 400 `已完成的复盘不能拉取`；无 ASIN 400；未配网关 400 `未配置领星网关`；网关失败 502 且带已成功 `filled`；不覆盖已有日报

Task 2 已有 `loadReviewBundle`。本任务只把顶部 require 补全为：

```javascript
const {
    assembleReviewPayload,
    toYmd,
    weekDateList,
    datesToPull,
    countSkippedExisting,
    mappedHasMetric,
    computeDerivedMetrics
} = require('../service/weekly-review');
```

不要再写一遍 `loadReviewBundle`。在 `GET /api/reviews/:id` 之后、现有 `POST /api/reviews/:id` 之前新增：

```javascript
    async function insertLingxingDailyRow(asin, dateStr, mapped) {
        const sessions = Number.isFinite(Number(mapped.sessions)) ? Math.trunc(Number(mapped.sessions)) : null;
        const orders = Number.isFinite(Number(mapped.orders)) ? Math.trunc(Number(mapped.orders)) : null;
        const impressions = Number.isFinite(Number(mapped.impressions)) ? Math.trunc(Number(mapped.impressions)) : null;
        const clicks = Number.isFinite(Number(mapped.clicks)) ? Math.trunc(Number(mapped.clicks)) : null;
        const ad_spend = Number.isFinite(Number(mapped.ad_spend)) ? Number(mapped.ad_spend) : null;
        const ad_sales = Number.isFinite(Number(mapped.ad_sales)) ? Number(mapped.ad_sales) : null;
        const total_sales = Number.isFinite(Number(mapped.total_sales)) ? Number(mapped.total_sales) : null;
        const ad_orders = Number.isFinite(Number(mapped.ad_orders)) ? Math.trunc(Number(mapped.ad_orders)) : null;
        const bsr_rank = Number.isFinite(Number(mapped.bsr_rank)) ? Math.trunc(Number(mapped.bsr_rank)) : null;
        const derived = computeDerivedMetrics({
            ad_spend, ad_sales, total_sales, impressions, clicks, orders
        });
        await runSql(
            `INSERT INTO daily_asin_metrics
             (asin, record_date, data_source, sessions, orders, impressions, clicks, ad_spend, ad_sales, total_sales, ad_orders, core_kw_rank, bsr_rank, acos, tacos, ctr, cvr)
             VALUES (?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
            [
                asin, dateStr,
                sessions, orders, impressions, clicks, ad_spend, ad_sales, total_sales, ad_orders,
                bsr_rank,
                derived.acos, derived.tacos, derived.ctr, derived.cvr
            ]
        );
    }

    app.post('/api/reviews/:id/lingxing-pull', async (req, res) => {
        const id = Number(req.params.id);
        let filled = 0;
        try {
            const todayYmd = toDateString(new Date());
            const bundle = await loadReviewBundle(id, todayYmd);
            if (!bundle) return res.status(404).json({ error: '复盘不存在' });
            if (bundle.review.status === 'COMPLETED') {
                return res.status(400).json({ error: '已完成的复盘不能拉取' });
            }
            const asin = String(bundle.review.asin || '').trim();
            if (!asin) return res.status(400).json({ error: 'ASIN 不能为空' });

            const need = datesToPull(bundle.week.days);
            const skipped_existing = countSkippedExisting(bundle.week.days);
            if (!need.length) {
                return res.json({
                    filled: 0,
                    skipped_existing,
                    missing_in_lingxing: 0,
                    week: bundle.week,
                    suggestion: bundle.suggestion
                });
            }

            let missing_in_lingxing = 0;
            for (const day of need) {
                const list = await queryProductPerformanceAll({
                    startDate: day,
                    endDate: day,
                    asins: [asin],
                    sids: LINGXING_SID_50_US
                });
                const item = list.find((row) => String(row.asin || '').trim().toUpperCase() === asin.toUpperCase());
                const mapped = item ? mapPerformanceRow(item) : null;
                if (!mapped || !mappedHasMetric(mapped)) {
                    missing_in_lingxing += 1;
                    continue;
                }
                await insertLingxingDailyRow(asin, day, mapped);
                filled += 1;
            }

            const next = await loadReviewBundle(id, todayYmd);
            res.json({
                filled,
                skipped_existing,
                missing_in_lingxing,
                week: next.week,
                suggestion: next.suggestion
            });
        } catch (e) {
            const status = e.status === 400 || e.status === 502 ? e.status : 500;
            res.status(status).json({ error: e.message || '领星拉取失败', filled });
        }
    });
```

不改后面的 `POST /api/reviews/:id`。

- [ ] **Step 1: 抽出 `loadReviewBundle`，GET 复用，新增 pull 路由与 INSERT（无 ON DUPLICATE KEY UPDATE）**
- [ ] **Step 2: Run** `node test/test-weekly-review.js` 以及 `node test/test-lingxing-metrics.js`

Expected: 两处都打印 `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/page-api.js
git commit -m "feat: 周复盘手动拉取领星补本周缺天日报"
```

---

### Task 4: 周复盘填写页

**Files:**
- Modify: `frontend/src/views/ReviewFormView.js`

**Interfaces:**
- Consumes: `GET /api/reviews/:id`、`POST /api/reviews/:id/lingxing-pull`；保存仍 `POST /api/reviews/:id`
- Produces: 本周表、对照、拉取按钮；PENDING 空字段套建议；COMPLETED 无按钮不套建议

把整个 `ReviewFormView.js` 换成下面实现（保留原保存逻辑与必填校验）：

```javascript
import { onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

function resolveReviewId(route) {
    return route.params.id ? String(route.params.id) : null;
}

function isEmptyField(v) {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function applySuggestion(form, suggestion) {
    if (!suggestion) return;
    const keys = ['actual_max_loss', 'actual_tacos', 'decision', 'summary'];
    for (const key of keys) {
        if (isEmptyField(form[key]) && suggestion[key] !== null && suggestion[key] !== undefined && suggestion[key] !== '') {
            form[key] = suggestion[key];
        }
    }
}

function statusLabel(status) {
    if (status === 'filled') return '已填';
    if (status === 'missing') return '缺填';
    if (status === 'upcoming') return '未到';
    return '-';
}

function fmtVal(v) {
    return v === null || v === undefined || v === '' ? '-' : v;
}

export default {
    name: 'ReviewFormView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const reviewId = ref(resolveReviewId(route));
        const review = ref(null);
        const sprint = ref(null);
        const week = ref(null);
        const error = ref('');
        const pullMsg = ref('');
        const saving = ref(false);
        const pulling = ref(false);
        const form = reactive({
            actual_max_loss: '', actual_tacos: '', decision: '', status: 'PENDING', summary: ''
        });

        function hydrateReview(data, { fillSuggestion }) {
            review.value = data.review;
            sprint.value = data.sprint || null;
            week.value = data.week || null;
            if (!review.value || !fillSuggestion) return;
            form.actual_max_loss = review.value.actual_max_loss != null ? review.value.actual_max_loss : '';
            form.actual_tacos = review.value.actual_tacos != null ? review.value.actual_tacos : '';
            form.decision = review.value.decision || '';
            form.status = review.value.status || 'PENDING';
            form.summary = review.value.summary || '';
            if (review.value.status !== 'COMPLETED') {
                applySuggestion(form, data.suggestion);
            }
        }

        async function loadReview(fillSuggestion) {
            if (!reviewId.value) {
                error.value = '无效的复盘 ID';
                return;
            }
            try {
                const { data } = await http.get('/api/reviews/' + reviewId.value);
                hydrateReview(data, { fillSuggestion: fillSuggestion !== false });
                error.value = data.error || '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        async function pullLingxing() {
            if (!reviewId.value) return;
            pulling.value = true;
            pullMsg.value = '';
            error.value = '';
            try {
                const { data } = await http.post('/api/reviews/' + reviewId.value + '/lingxing-pull');
                week.value = data.week || week.value;
                pullMsg.value = `已补 ${data.filled || 0} 天，跳过已录入 ${data.skipped_existing || 0} 天，领星无数据 ${data.missing_in_lingxing || 0} 天`;
                if (review.value && review.value.status !== 'COMPLETED') {
                    applySuggestion(form, data.suggestion);
                }
            } catch (e) {
                error.value = getApiError(e, '领星拉取失败');
                await loadReview(false);
            } finally {
                pulling.value = false;
            }
        }

        async function submitForm() {
            error.value = '';
            saving.value = true;
            try {
                await http.post('/api/reviews/' + reviewId.value, { ...form });
                router.push('/reviews?sprint_id=' + (review.value && review.value.sprint_id ? review.value.sprint_id : ''));
            } catch (e) {
                error.value = getApiError(e, '保存失败');
            } finally {
                saving.value = false;
            }
        }

        onMounted(() => loadReview(true));

        return {
            review, sprint, week, error, pullMsg, saving, pulling, form,
            submitForm, pullLingxing, statusLabel, fmtVal
        };
    },
    template: `<a v-if="review" :href="'/reviews?sprint_id=' + review.sprint_id" class="back-link">← 返回周复盘列表</a>
            <div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <h1>周复盘填写</h1>
                        <div v-if="review" class="page-desc">ASIN：<code>{{ review.asin }}</code> · 周起始日：{{ review.week_start_date }}</div>
                    </div>
                    <button v-if="review && review.status !== 'COMPLETED'" class="btn-secondary" type="button" :disabled="pulling || saving" @click="pullLingxing">{{ pulling ? '拉取中...' : '从领星拉取' }}</button>
                </div>
            </div>

            <div v-if="error" style="background:#fef0f0; border:1px solid #fde2e2; color:#f56c6c; padding:12px 16px; border-radius:8px; margin-bottom:16px;">
                {{ error }}
            </div>
            <div v-if="pullMsg" style="font-size:13px; color:#606266; margin-bottom:16px;">{{ pullMsg }}</div>

            <div v-if="week" class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">本周数据</div></div>
                <div class="module-body">
                    <div class="table-container" style="max-height:none;">
                        <table class="product-table">
                            <thead>
                                <tr>
                                    <th>日期</th>
                                    <th>状态</th>
                                    <th>订单</th>
                                    <th>广告花费</th>
                                    <th>总销售额</th>
                                    <th>TACOS</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="d in week.days" :key="d.date">
                                    <td>{{ d.date }}</td>
                                    <td>{{ statusLabel(d.status) }}</td>
                                    <td>{{ fmtVal(d.orders) }}</td>
                                    <td>{{ fmtVal(d.ad_spend) }}</td>
                                    <td>{{ fmtVal(d.total_sales) }}</td>
                                    <td>{{ fmtVal(d.tacos) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div v-if="week && sprint" class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">对照</div></div>
                <div class="module-body" style="font-size:13px; color:#303133; line-height:1.8;">
                    <div v-if="sprint.sprint_goal">冲刺目标：{{ sprint.sprint_goal }}</div>
                    <div>花费合计：{{ fmtVal(week.totals && week.totals.actual_max_loss) }} vs 7天最大亏损额度：{{ fmtVal(sprint.max_loss_7d) }}</div>
                    <div>本周 TACOS：{{ fmtVal(week.totals && week.totals.actual_tacos) }} vs 推广期允许：{{ fmtVal(sprint.promo_tacos_limit) }} / 稳定期目标：{{ fmtVal(sprint.stable_tacos_target) }}</div>
                    <div>日均单量：{{ fmtVal(week.totals && week.totals.avg_daily_orders) }} vs 目标日均单量：{{ fmtVal(sprint.target_daily_orders) }}</div>
                    <div v-if="week.totals && week.totals.ctr != null">本周 CTR(%)：{{ week.totals.ctr }} vs 目标：{{ fmtVal(sprint.ctr_7d) }}</div>
                    <div v-if="week.totals && week.totals.cvr != null">本周 CVR(%)：{{ week.totals.cvr }} vs 目标：{{ fmtVal(sprint.cvr_7d) }}</div>
                    <div v-if="week.totals && week.totals.cpc != null">本周 CPC：{{ week.totals.cpc }} vs 目标：{{ fmtVal(sprint.cpc) }}</div>
                </div>
            </div>

            <form v-if="review" @submit.prevent="submitForm" style="max-width:900px;">
                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">核对</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">本周实际最大亏损($) *</div>
                                <input v-model="form.actual_max_loss" class="search-input" style="width:100%;" type="number" step="0.01" required>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">当前实际TACOS(%) *</div>
                                <input v-model="form.actual_tacos" class="search-input" style="width:100%;" type="number" step="0.01" required>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">评估与决策</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">决策 *</div>
                                <select v-model="form.decision" class="filter-select" style="width:100%;" required>
                                    <option value="">请选择</option>
                                    <option value="CONTINUE">继续冲刺 (CONTINUE)</option>
                                    <option value="MAINTENANCE">转维护期 (MAINTENANCE)</option>
                                    <option value="STOPPED">停止 (STOPPED)</option>
                                </select>
                                <div style="font-size:12px; color:#909399; margin-top:4px;">选择 MAINTENANCE/STOPPED 会同步更新项目状态</div>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">复盘状态</div>
                                <select v-model="form.status" class="filter-select" style="width:100%;" required>
                                    <option value="PENDING">PENDING</option>
                                    <option value="COMPLETED">COMPLETED</option>
                                </select>
                            </div>
                        </div>
                        <div style="margin-top:12px;">
                            <div style="font-size:13px; color:#606266; margin-bottom:6px;">复盘结论记录 *</div>
                            <textarea v-model="form.summary" class="sop-remark" rows="6" required></textarea>
                        </div>
                    </div>
                </div>

                <div style="display:flex; gap:12px; align-items:center;">
                    <button type="submit" class="btn-primary" :disabled="saving || pulling">{{ saving ? '保存中...' : '保存' }}</button>
                    <a class="btn-secondary" :href="'/reviews?sprint_id=' + review.sprint_id">取消</a>
                </div>
            </form>`
};
```

`hydrateReview(..., { fillSuggestion: false })` 只更新本周表/对照，不动 form。拉取失败因此不会冲掉人手改的结论。

- [ ] **Step 1: 按上面改 `ReviewFormView.js`**
- [ ] **Step 2: Run** `node test/test-weekly-review.js`

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/ReviewFormView.js
git commit -m "feat: 周复盘页展示本周日报并支持领星补缺"
```

---

## 手工验收

1. 打开 PENDING 复盘：网络无领星请求；见 7 天表（已填/缺填/未到）和对照；空的亏损/TACOS/决策/结论被建议填上。
2. 先手改结论再点拉取：缺天写入日报；提示已补/跳过/无数据；已改结论仍在。
3. 打开每日填报对应日期：能看到补上的数。
4. 花费 ≥ 额度的数据：建议 `STOPPED`。TACOS 和单量达标且未超额度：`MAINTENANCE`。
5. COMPLETED：无拉取按钮，字段保持已保存值。
6. 保存 CONTINUE/MAINTENANCE/STOPPED 后项目状态与改造前一致。
