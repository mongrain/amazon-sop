# 每日填报 TACOS + 周复盘 GPT 优化方案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日填报表展示并可提交 TACOS（领星优先，否则花费÷销售额）；周复盘用按钮调 GPT 生成独立优化建议，已有内容不覆盖。

**Architecture:** 领星 TACOS 映射与花费补算放 `service/lingxing-metrics.js`。入库派生继续走 `computeDerivedMetrics`，有限 `tacos` 覆盖计算值。GPT 入参/跳过逻辑放 `service/weekly-review.js` 的 `generateOptimizePlan`，`chatFn` 可注入。浏览器只打本系统接口。

**Tech Stack:** Node + Express + Vue 3；现有 `chatCompletionText`；测试 `node test/*.js` + `assert`；不新增 npm 依赖。

## Global Constraints

- 不改决策规则（CONTINUE / MAINTENANCE / STOPPED）
- 不改周复盘领星补缺天范围、对照可视化、冲刺保存
- 不把 GPT / yanjun token 暴露给浏览器
- `COMPLETED` 不生成优化方案
- GPT 不拉广告活动、搜索词、关键词
- 已有 `optimization_plan` 不调模型、不覆盖
- `POST /api/reviews/:id/optimize-plan` 成功也不写库，用户点保存才入库
- 提交 TACOS：body 有限数字用表格值，否则花费÷总销售额
- yanjun / GPT 仅服务端；不新增来源枚举
- 提交信息用中文 `feat:` / `fix:`；不 `--no-verify`；不提交 `service/imagediff/` 与 `.superpowers/`

## File Structure

- Modify: `service/lingxing-metrics.js` — `METRIC_KEYS`/`PERF_FIELD_MAP` 增加 `tacos`；映射后 `toFormPercent`；空则花费÷销售额
- Modify: `test/test-lingxing-metrics.js`
- Modify: `service/weekly-review.js` — `computeDerivedMetrics` 覆盖；`generateOptimizePlan`
- Modify: `test/test-weekly-review.js`
- Modify: `server.js` — upload 优先 body.tacos
- Modify: `routes/page-api.js` — GET 日报带回 tacos；周补缺天传入 mapped.tacos；保存 `optimization_plan`；新 POST optimize-plan
- Modify: `frontend/src/views/MetricsManualView.js` — TACOS 列
- Modify: `database.js`、`init.sql` — `weekly_reviews.optimization_plan`
- Modify: `frontend/src/views/ReviewFormView.js` — 优化建议模块

开新分支 `feat/daily-tacos-weekly-optimize`（从含周复盘可视化的当前 HEAD），不要在 `main` 上直接改。

---

### Task 1: 领星 TACOS 映射与补算

**Files:**
- Modify: `service/lingxing-metrics.js`
- Test: `test/test-lingxing-metrics.js`

**Interfaces:**
- Consumes: 现有 `pickNumeric`、`toFormPercent`
- Produces:
  - `METRIC_KEYS` 在末尾增加 `'tacos'`（原 9 个键不变）
  - `PERF_FIELD_MAP.tacos` = `['tacos', 'ta_cos', 'tacos_rate', 'advertising_cost_of_sales']`
  - `fillTacosFallback(mapped)` → 新对象。若 `tacos` 已是有限数字则原样返回；否则 `ad_spend`/`total_sales` 有限且销售额 `> 0` 时写入 `Math.round(ad_spend / total_sales * 100 * 100) / 100`；否则不写
  - `mapPerformanceRow(row)` 在按 `METRIC_KEYS` 取值后：`mapped.tacos = toFormPercent(mapped.tacos)`，再 `return fillTacosFallback(mapped)`

- [ ] **Step 1: Write the failing test**

在 `test/test-lingxing-metrics.js` 现有 `toFormPercent(null)` 断言之后追加：

```javascript
assert.strictEqual(mapPerformanceRow({ tacos: 0.15 }).tacos, 15);
assert.strictEqual(mapPerformanceRow({ tacos: 15 }).tacos, 15);
assert.strictEqual(mapPerformanceRow({ ta_cos: 12 }).tacos, 12);
assert.strictEqual(mapPerformanceRow({ tacos_rate: 0.18 }).tacos, 18);
assert.strictEqual(mapPerformanceRow({ advertising_cost_of_sales: 0.2 }).tacos, 20);
assert.strictEqual(mapPerformanceRow({ ad_cost: 10, amount: 50 }).tacos, 20);
assert.strictEqual(mapPerformanceRow({ tacos: 12, ad_cost: 10, amount: 50 }).tacos, 12);
assert.strictEqual(mapPerformanceRow({ ad_cost: 10, amount: 0 }).tacos, null);
assert.strictEqual(mapPerformanceRow({ ad_cost: 10 }).tacos, null);

const { fillTacosFallback } = require('../service/lingxing-metrics');
assert.strictEqual(fillTacosFallback({ ad_spend: 10, total_sales: 80 }).tacos, 12.5);
assert.strictEqual(fillTacosFallback({ tacos: 9, ad_spend: 10, total_sales: 80 }).tacos, 9);
```

在现有 `const mapped = mapPerformanceRow({ asin: 'B0ABC', ... ad_cost: 12, ... sales_amount: 120.5 ...})` 块末尾追加：

```javascript
assert.strictEqual(mapped.tacos, 9.96);
```

在 `realMapped` 块末尾追加：

```javascript
assert.strictEqual(realMapped.tacos, 6.22);
```

（`609.29 / 9792.12 * 100` 四舍五入两位为 `6.22`）

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-lingxing-metrics.js`

Expected: FAIL（`mapped.tacos` 为 `undefined`，或 `fillTacosFallback` 未导出）

- [ ] **Step 3: Write minimal implementation**

`service/lingxing-metrics.js`：

1. `METRIC_KEYS` 末尾加 `'tacos'`
2. `PERF_FIELD_MAP` 增加：

```javascript
tacos: ['tacos', 'ta_cos', 'tacos_rate', 'advertising_cost_of_sales']
```

3. 新增并导出：

```javascript
function fillTacosFallback(mapped) {
    const next = { ...(mapped || {}) };
    const existing = Number(next.tacos);
    if (next.tacos !== '' && next.tacos !== null && next.tacos !== undefined && Number.isFinite(existing)) {
        return next;
    }
    const spend = Number(next.ad_spend);
    const sales = Number(next.total_sales);
    if (Number.isFinite(spend) && Number.isFinite(sales) && sales > 0) {
        next.tacos = Math.round(spend / sales * 100 * 100) / 100;
    }
    return next;
}
```

4. `mapPerformanceRow` 在循环赋值后、`return mapped` 前：

```javascript
    mapped.tacos = toFormPercent(mapped.tacos);
    return fillTacosFallback(mapped);
```

`module.exports` 增加 `fillTacosFallback`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-lingxing-metrics.js`

Expected: 打印 `ok`

再跑：`node test/test-weekly-review.js`

Expected: `ok`（`mappedHasMetric` 仍只关心有限数字，原用例不含 tacos）

- [ ] **Step 5: Commit**

```bash
git add service/lingxing-metrics.js test/test-lingxing-metrics.js
git commit -m "feat: 领星日报映射TACOS并在缺失时按花费销售额补算"
```

---

### Task 2: 入库优先表格 TACOS

**Files:**
- Modify: `service/weekly-review.js` — `computeDerivedMetrics`
- Modify: `test/test-weekly-review.js`
- Modify: `server.js` — `POST /api/v1/metrics/upload`
- Modify: `routes/page-api.js` — `GET /api/metrics/manual` SELECT/返回；`insertLingxingDailyRow` 把 `mapped.tacos` 传入派生

**Interfaces:**
- Consumes: Task 1 的 `mapPerformanceRow`（已含 tacos）
- Produces:
  - `computeDerivedMetrics(row)` → `{ acos, tacos, ctr, cvr }`。`row.tacos` 为有限数字时用它；否则 `ad_spend / total_sales * 100`（销售额 `<=0` 或缺花费则为 `null`）。acos/ctr/cvr 公式不变
  - upload：某行 body `tacos` 有限则入库该值；对外仍 `{ status, processed }`
  - GET `/api/metrics/manual` 每行增加 `tacos`
  - 周复盘补缺天：`computeDerivedMetrics({ ..., tacos: mapped.tacos })`

- [ ] **Step 1: Write the failing test**

在 `test/test-weekly-review.js` 现有 `computeDerivedMetrics` 断言后追加：

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-weekly-review.js`

Expected: FAIL（覆盖值仍被重算成 `10`，`tacos: 12` 断言失败）

- [ ] **Step 3: Write minimal implementation**

`computeDerivedMetrics` 改为：

```javascript
function computeDerivedMetrics(row) {
    const ad_spend = numOrNull(row && row.ad_spend);
    const ad_sales = numOrNull(row && row.ad_sales);
    const total_sales = numOrNull(row && row.total_sales);
    const impressions = numOrNull(row && row.impressions);
    const clicks = numOrNull(row && row.clicks);
    const orders = numOrNull(row && row.orders);
    const acos = ad_sales && ad_sales > 0 && ad_spend !== null ? ad_spend / ad_sales * 100 : null;
    const tacosOverride = numOrNull(row && row.tacos);
    const tacosComputed = total_sales && total_sales > 0 && ad_spend !== null ? ad_spend / total_sales * 100 : null;
    const tacos = tacosOverride !== null ? tacosOverride : tacosComputed;
    const ctr = impressions && impressions > 0 && clicks !== null ? clicks / impressions : null;
    const cvr = clicks && clicks > 0 && orders !== null ? orders / clicks : null;
    return { acos, tacos, ctr, cvr };
}
```

`server.js` 顶部增加：

```javascript
const { computeDerivedMetrics } = require('./service/weekly-review');
```

在 `POST /api/v1/metrics/upload` 循环里，删掉本地 `acos`/`tacos`/`ctr`/`cvr` 三元运算，改为（`ad_spend` 等变量仍按现有 Number 解析）：

```javascript
            const tacosInput = row.tacos !== undefined && row.tacos !== null && row.tacos !== ''
                && Number.isFinite(Number(row.tacos))
                ? Number(row.tacos)
                : null;
            const derived = computeDerivedMetrics({
                ad_spend: ad_spend !== null && Number.isFinite(ad_spend) ? ad_spend : null,
                ad_sales: ad_sales !== null && Number.isFinite(ad_sales) ? ad_sales : null,
                total_sales: total_sales !== null && Number.isFinite(total_sales) ? total_sales : null,
                impressions: impressions !== null && Number.isFinite(impressions) ? impressions : null,
                clicks: clicks !== null && Number.isFinite(clicks) ? clicks : null,
                orders: orders !== null && Number.isFinite(orders) ? orders : null,
                tacos: tacosInput
            });
            const acos = derived.acos;
            const tacos = derived.tacos;
            const ctr = derived.ctr;
            const cvr = derived.cvr;
```

INSERT 绑定仍用后面的 `Number.isFinite` 清洗，响应仍 `res.json({ status: 'ok', processed: asins.length })`。

`routes/page-api.js`：

1. GET `/api/metrics/manual` 的 SELECT 增加 `tacos`：

```sql
SELECT asin, sessions, orders, impressions, clicks, ad_spend, ad_sales, total_sales, ad_orders, core_kw_rank, bsr_rank, tacos
```

返回对象增加 `tacos: metricOrNull(saved.tacos)`。

2. `insertLingxingDailyRow`：

```javascript
        const derived = computeDerivedMetrics({
            ad_spend, ad_sales, total_sales, impressions, clicks, orders,
            tacos: mapped.tacos
        });
```

其余 INSERT 字段、`MANUAL`、1062 跳过不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-weekly-review.js`

Expected: `ok`

再跑：`node test/test-lingxing-metrics.js`

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add service/weekly-review.js test/test-weekly-review.js server.js routes/page-api.js
git commit -m "feat: 日报入库优先使用表格TACOS"
```

---

### Task 3: 每日填报 TACOS 列

**Files:**
- Modify: `frontend/src/views/MetricsManualView.js`

**Interfaces:**
- Consumes: GET 行上的 `tacos`；领星预填行上的 `tacos`（Task 1）
- Produces: 表格可编辑 TACOS；提交 payload 含有限 `tacos`（小数，不截断）

无独立前端测试文件。本任务以对照 Task 1 的 `fillTacosFallback` 规则手写同款函数，并用现有 `node test/test-lingxing-metrics.js` 回归。

- [ ] **Step 1: 加上列与提交字段（先写行为，再自检空态）**

`METRIC_KEYS` 在 `total_sales` 后插入 `'tacos'`：

```javascript
const METRIC_KEYS = ['sessions', 'orders', 'impressions', 'clicks', 'ad_spend', 'ad_sales', 'total_sales', 'tacos', 'ad_orders', 'core_kw_rank', 'bsr_rank'];
const PULL_KEYS = ['sessions', 'orders', 'impressions', 'clicks', 'ad_spend', 'ad_sales', 'total_sales', 'tacos', 'ad_orders', 'bsr_rank'];
```

`emptyRow` 增加 `tacos: ''`（放在 `total_sales` 后）。

在 `parseNum` 后增加：

```javascript
function isEmptyMetric(v) {
    return v === undefined || v === null || String(v).trim() === '';
}

function fillTacosIfEmpty(row) {
    if (!isEmptyMetric(row && row.tacos)) return row;
    const spend = parseNum(row && row.ad_spend);
    const sales = parseNum(row && row.total_sales);
    if (spend === null || sales === null || sales <= 0) return row;
    return { ...row, tacos: Math.round(spend / sales * 100 * 100) / 100 };
}

function onSpendOrSalesInput(row) {
    if (!isEmptyMetric(row.tacos)) return;
    const spend = parseNum(row.ad_spend);
    const sales = parseNum(row.total_sales);
    if (spend === null || sales === null || sales <= 0) return;
    row.tacos = Math.round(spend / sales * 100 * 100) / 100;
}
```

`pullLingxing` 成功后：

```javascript
                rows.value = mergePrefill(rows.value, data.rows || [], forceOverwrite.value).map(fillTacosIfEmpty);
```

`submitMetrics` 里金额字段判断改为含 tacos：

```javascript
                    if (['ad_spend', 'ad_sales', 'total_sales', 'tacos'].includes(k)) {
```

`setup` 的 `return` 增加 `onSpendOrSalesInput`。

表头：总销售额 `<th>` 后增加：

```html
                            <th style="min-width:100px" title="tacos">TACOS(%)</th>
```

表体对应：

```html
                            <td><input v-model="row.total_sales" class="search-input" style="width:110px" @input="onSpendOrSalesInput(row)"></td>
                            <td><input v-model="row.tacos" class="search-input" style="width:100px"></td>
```

广告花费输入同样 `@input="onSpendOrSalesInput(row)"`。

说明文字补上 ` / TACOS(%)`。

规则：TACOS 已有数字（含 `0`）不覆盖；空才补算。

- [ ] **Step 2: 回归**

Run: `node test/test-lingxing-metrics.js`

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/MetricsManualView.js
git commit -m "feat: 每日填报表增加可编辑TACOS列"
```

---

### Task 4: GPT 优化方案纯函数

**Files:**
- Modify: `service/weekly-review.js`
- Test: `test/test-weekly-review.js`

**Interfaces:**
- Consumes: 现有 `isEmptyField`、`week.days`/`week.totals`、`pickSprint` 字段、`suggestion.decision`
- Produces:
  - `OPTIMIZE_SYSTEM_PROMPT` 字符串常量
  - `buildOptimizeUserContent({ review, sprint, week, suggestion })` → JSON 字符串
  - `generateOptimizePlan({ review, sprint, week, suggestion, chatFn })` → `Promise<{ optimization_plan: string, skipped: boolean }>`
    - `review.optimization_plan` 非空（`!isEmptyField`）：不调用 `chatFn`，返回 `{ optimization_plan: trim 后原文, skipped: true }`
    - 否则 `await chatFn(OPTIMIZE_SYSTEM_PROMPT, userContent)`；trim 后为空则 `throw` 带 `status: 502` 的 `Error('GPT 返回内容为空')`
    - 成功 `{ optimization_plan, skipped: false }`
  - **不写数据库**

JSON 至少含：`asin`、`sprint_goal`、`target_daily_orders`、`ctr_7d`、`cvr_7d`、`cpc`、`promo_tacos_limit`、`stable_tacos_target`、`max_loss_7d`、`budget_cap`、`days`（`date,status,orders,ad_spend,total_sales,tacos`）、`totals`（`ad_spend_sum, actual_tacos, avg_daily_orders, ctr, cvr, cpc`）、`suggested_decision`。

- [ ] **Step 1: Write the failing test**

在 `test/test-weekly-review.js` 的 `require` 增加 `generateOptimizePlan`、`buildOptimizeUserContent`、`OPTIMIZE_SYSTEM_PROMPT`。文件末尾 `console.log('ok')` 前追加：

```javascript
assert.ok(OPTIMIZE_SYSTEM_PROMPT.includes('不要改写'));
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
    suggestion: { decision: 'CONTINUE' }
});
assert.ok(userContent.includes('B0XX'));
assert.ok(userContent.includes('冲量'));
assert.ok(userContent.includes('CONTINUE'));
assert.ok(userContent.includes('suggested_decision'));

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
        chatFn
    });
    assert.strictEqual(generated.skipped, false);
    assert.strictEqual(generated.optimization_plan, '- 控花费\n- 冲单量');
    assert.strictEqual(chatCalls, 1);

    chatCalls = 0;
    const skipped = await generateOptimizePlan({
        review: { asin: 'B0XX', optimization_plan: '已有方案' },
        sprint: {},
        week: optWeek,
        suggestion: { decision: 'CONTINUE' },
        chatFn
    });
    assert.strictEqual(skipped.skipped, true);
    assert.strictEqual(skipped.optimization_plan, '已有方案');
    assert.strictEqual(chatCalls, 0);

    chatCalls = 0;
    let emptyErr = null;
    try {
        await generateOptimizePlan({
            review: { asin: 'B0XX', optimization_plan: '   ' },
            sprint: {},
            week: optWeek,
            suggestion: { decision: 'CONTINUE' },
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
```

删掉原来的同步 `console.log('ok')`，只保留 IIFE 里那一次（文件后半段变成异步收尾）。若不想改整个文件收尾方式：把上述 `await` 测试写成单独文件 `test/test-optimize-plan.js` 更干净——**本任务采用单独测试文件** `test/test-optimize-plan.js`，`test-weekly-review.js` 保持同步。

创建 `test/test-optimize-plan.js`，内容即上面从 `require` 开始的异步脚本（自行 `require` `generateOptimizePlan`、`buildOptimizeUserContent`、`OPTIMIZE_SYSTEM_PROMPT`、`buildWeekDays`）。

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-optimize-plan.js`

Expected: FAIL，未导出 `generateOptimizePlan`

- [ ] **Step 3: Write minimal implementation**

在 `service/weekly-review.js` 的 `applySuggestion` 之后、`module.exports` 之前加入：

```javascript
const OPTIMIZE_SYSTEM_PROMPT = [
    '你是亚马逊广告优化助手。根据提供的冲刺目标和本周日报，给出针对该 ASIN 冲刺广告的可执行优化建议。',
    '要求：',
    '- 使用中文分条（每条一行，以 - 开头）',
    '- 围绕预算、出价、是否控花费、是否冲曝光或单量',
    '- 不要改写或否定规则建议决策（CONTINUE / MAINTENANCE / STOPPED）',
    '- 不要编造未提供的搜索词、广告活动名或关键词',
    '- 只依据给定数据；缺数据就写明依据不足，给保守动作'
].join('\n');

function buildOptimizeUserContent({ review, sprint, week, suggestion }) {
    const src = sprint || {};
    const totals = (week && week.totals) || {};
    const days = ((week && week.days) || []).map((d) => ({
        date: d.date,
        status: d.status,
        orders: d.orders,
        ad_spend: d.ad_spend,
        total_sales: d.total_sales,
        tacos: d.tacos
    }));
    return JSON.stringify({
        asin: review && review.asin,
        sprint_goal: src.sprint_goal,
        target_daily_orders: src.target_daily_orders,
        ctr_7d: src.ctr_7d,
        cvr_7d: src.cvr_7d,
        cpc: src.cpc,
        promo_tacos_limit: src.promo_tacos_limit,
        stable_tacos_target: src.stable_tacos_target,
        max_loss_7d: src.max_loss_7d,
        budget_cap: src.budget_cap,
        days,
        totals: {
            ad_spend_sum: totals.ad_spend_sum,
            actual_tacos: totals.actual_tacos,
            avg_daily_orders: totals.avg_daily_orders,
            ctr: totals.ctr,
            cvr: totals.cvr,
            cpc: totals.cpc
        },
        suggested_decision: suggestion && suggestion.decision
    }, null, 2);
}

async function generateOptimizePlan({ review, sprint, week, suggestion, chatFn }) {
    const existing = review && review.optimization_plan;
    if (!isEmptyField(existing)) {
        return { optimization_plan: String(existing).trim(), skipped: true };
    }
    const text = await chatFn(OPTIMIZE_SYSTEM_PROMPT, buildOptimizeUserContent({
        review, sprint, week, suggestion
    }));
    const plan = String(text || '').trim();
    if (!plan) {
        const err = new Error('GPT 返回内容为空');
        err.status = 502;
        throw err;
    }
    return { optimization_plan: plan, skipped: false };
}
```

`module.exports` 增加 `OPTIMIZE_SYSTEM_PROMPT`、`buildOptimizeUserContent`、`generateOptimizePlan`。

不要 require `gpt.js`。不要拉领星广告报表。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-optimize-plan.js`

Expected: `ok`

再跑：`node test/test-weekly-review.js`

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add service/weekly-review.js test/test-optimize-plan.js
git commit -m "feat: 周复盘GPT优化方案生成逻辑"
```

---

### Task 5: optimization_plan 列与保存

**Files:**
- Modify: `database.js` — `weekly_reviews` CREATE 增加列；`ALTER` 兼容旧库
- Modify: `init.sql` — `weekly_reviews` 在 `summary TEXT` 后加 `optimization_plan TEXT`
- Modify: `routes/page-api.js` — `POST /api/reviews/:id`

**Interfaces:**
- Produces: GET 已 `SELECT wr.*`，新列会随 `review` 返回
- 保存：`optimization_plan` 允许空字符串，不校验必填；其它校验不变

- [ ] **Step 1: Schema**

`init.sql` 的 `weekly_reviews`：

```sql
    summary TEXT,
    optimization_plan TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
```

`database.js` 的 `CREATE TABLE IF NOT EXISTS weekly_reviews` 同样加 `optimization_plan TEXT`（`summary TEXT` 后）。

在该 CREATE 的 `catch` 之后增加：

```javascript
    try {
        await p.query(
            `ALTER TABLE weekly_reviews ADD COLUMN optimization_plan TEXT AFTER summary`
        );
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }
```

- [ ] **Step 2: Save**

`POST /api/reviews/:id` 在 `summary` 校验后：

```javascript
            const optimization_plan = req.body.optimization_plan == null
                ? ''
                : String(req.body.optimization_plan);

            await runSql(
                `UPDATE weekly_reviews SET
                 actual_max_loss = ?, actual_tacos = ?, decision = ?, status = ?, summary = ?, optimization_plan = ?, updated_at = NOW()
                 WHERE id = ?`,
                [actual_max_loss, actual_tacos, decision, status, summary, optimization_plan, id]
            );
```

`summary` 仍必填；决策同步项目状态逻辑不动。

- [ ] **Step 3: 回归**

Run: `node test/test-weekly-review.js`

Expected: `ok`

Run: `node test/test-optimize-plan.js`

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add database.js init.sql routes/page-api.js
git commit -m "feat: 周复盘新增optimization_plan列并支持保存"
```

---

### Task 6: 生成接口与周复盘页

**Files:**
- Modify: `routes/page-api.js` — `POST /api/reviews/:id/optimize-plan`
- Modify: `frontend/src/views/ReviewFormView.js`

**Interfaces:**
- Consumes: Task 4 `generateOptimizePlan`；Task 5 列；现有 `loadReviewBundle`
- Produces:
  - `POST /api/reviews/:id/optimize-plan` 需登录、无 body
    - 无复盘 404 `{ error: '复盘不存在' }`
    - `COMPLETED` 400 `{ error: '已完成的复盘不能生成优化方案' }`
    - `process.env.GPT_API_URL` 去空白后为空：400 `{ error: '未配置 GPT_API_URL' }`（不要用 gpt.js 里的 localhost 默认值来判定已配置）
    - 已有非空 plan：200 `{ optimization_plan, skipped: true }`，不调 GPT
    - 调用失败或空内容：502，不写库
    - 成功：200 `{ optimization_plan, skipped: false }`，**不 UPDATE**
  - 页面：核对/决策之后、保存按钮之前，「优化建议」textarea；PENDING 显示「生成优化方案」；请求中禁用；COMPLETED 无按钮；只填空框

- [ ] **Step 1: Route**

`page-api.js` 增加 `generateOptimizePlan` 的 require。

在 `POST /api/reviews/:id/lingxing-pull` 与 `POST /api/reviews/:id` 之间（或保存接口之后）增加：

```javascript
    app.post('/api/reviews/:id/optimize-plan', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const bundle = await loadReviewBundle(id, toDateString(new Date()));
            if (!bundle) return res.status(404).json({ error: '复盘不存在' });
            if (bundle.review.status === 'COMPLETED') {
                return res.status(400).json({ error: '已完成的复盘不能生成优化方案' });
            }
            if (!String(process.env.GPT_API_URL || '').trim()) {
                return res.status(400).json({ error: '未配置 GPT_API_URL' });
            }
            const { chatCompletionText } = require('../gpt');
            const result = await generateOptimizePlan({
                review: bundle.review,
                sprint: bundle.sprint,
                week: bundle.week,
                suggestion: bundle.suggestion,
                chatFn: chatCompletionText
            });
            res.json(result);
        } catch (e) {
            const status = e.status === 400 ? 400 : 502;
            res.status(status).json({ error: e.message || '生成优化方案失败' });
        }
    });
```

不要把该路径加入 `auth.js` 的 `PUBLIC_ROUTES`。不要在此 `runSql` UPDATE。

- [ ] **Step 2: ReviewFormView**

`form` 增加 `optimization_plan: ''`。

`hydrateReview` 在 `form.summary = ...` 后：

```javascript
            form.optimization_plan = review.value.optimization_plan || '';
```

不要把 `optimization_plan` 放进 `applySuggestion`。

`setup` 增加 `generating = ref(false)`、`optimizeMsg = ref('')`。

```javascript
        async function generateOptimizePlan() {
            if (!reviewId.value) return;
            if (generating.value) return;
            if (review.value && review.value.status === 'COMPLETED') return;
            if (!isEmptyField(form.optimization_plan)) {
                optimizeMsg.value = '已有优化建议，未覆盖';
                return;
            }
            generating.value = true;
            optimizeMsg.value = '生成中...';
            error.value = '';
            try {
                const { data } = await http.post('/api/reviews/' + reviewId.value + '/optimize-plan');
                if (isEmptyField(form.optimization_plan) && data && data.optimization_plan) {
                    form.optimization_plan = data.optimization_plan;
                }
                optimizeMsg.value = data && data.skipped ? '已有优化建议，未重新生成' : '已生成，请核对后保存';
            } catch (e) {
                error.value = getApiError(e, '生成优化方案失败');
                optimizeMsg.value = '';
            } finally {
                generating.value = false;
            }
        }
```

`return` 增加 `generating, optimizeMsg, generateOptimizePlan`。

`submitForm` 已 `{ ...form }`，无需改 payload。保存按钮 `:disabled="saving || pulling || generating"`。领星按钮同样加上 `generating`。

在「评估与决策」模块和保存按钮之间插入：

```html
                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">优化建议</div></div>
                    <div class="module-body">
                        <button
                            v-if="review.status !== 'COMPLETED'"
                            class="btn-secondary"
                            type="button"
                            :disabled="generating || saving || pulling"
                            @click="generateOptimizePlan"
                        >{{ generating ? '生成中...' : '生成优化方案' }}</button>
                        <div v-if="optimizeMsg" style="font-size:13px; color:#606266; margin:8px 0;">{{ optimizeMsg }}</div>
                        <textarea v-model="form.optimization_plan" class="sop-remark" rows="8" style="margin-top:8px;"></textarea>
                    </div>
                </div>
```

打开页、领星拉取成功都不要自动调该接口。

- [ ] **Step 3: 回归**

Run:

```bash
node test/test-lingxing-metrics.js
node test/test-weekly-review.js
node test/test-optimize-plan.js
node test/test-review-visual.js
```

Expected: 全部打印 `ok`

- [ ] **Step 4: Commit**

```bash
git add routes/page-api.js frontend/src/views/ReviewFormView.js
git commit -m "feat: 周复盘填写页可生成并保存优化建议"
```

---

## 验收对照

| 规格 | 任务 |
|------|------|
| 领星 TACOS 映射 + toFormPercent | Task 1 |
| 无 tacos 用花费÷销售额 | Task 1、3 |
| 提交以表格为准，空则重算 | Task 2、3 |
| GET manual 带回 tacos | Task 2 |
| 周补缺天同一套派生 | Task 2 |
| 不覆盖已填 TACOS（含 0） | Task 1 `fillTacosFallback`、Task 3 |
| `optimization_plan` 新列 + 保存 | Task 5 |
| 按钮生成、已有不覆盖、COMPLETED 无按钮 | Task 4、6 |
| 生成接口不写库 | Task 6 |
| 不拉广告明细、不改决策 | Task 4 入参仅日报+冲刺；无决策函数改动 |
