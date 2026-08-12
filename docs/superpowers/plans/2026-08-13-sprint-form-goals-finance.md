# 冲刺广告表单周期回填与财务风控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冲刺广告表单支持周期回填结束日期、文本排名、冲刺目标派生计算、ASIN 查询回填财务风控，并移除 ACoS、列表改展示预算上限。

**Architecture:** DB 扩展 `sprint_projects` 新列并把排名改为 VARCHAR；`saveSprint` 读写新字段、acos 写 NULL。前端 `SprintFormView` 做日期/曝光/预算派生计算与 ASIN「查询」调用既有 `GET /api/product/:asin`。纯计算抽到 `frontend/src/utils/sprint-form-calc.js` 便于单测。列表去掉 ACoS、加预算上限。

**Tech Stack:** Vue 3 Options API 视图、Express `routes/page-api.js`、MySQL `database.js` / `init.sql`、Node `assert` 单测（若项目已有 `test/` 风格则沿用）

**Spec:** `docs/superpowers/specs/2026-08-13-sprint-form-goals-finance-design.md`

## Global Constraints

- 结束日期 = 开始日期 + 目标周期天数 − 1（含当天）；可手改
- 排名 text，placeholder：`请输入小类排名xx名, 大类排名xx名`
- 所需曝光 = 目标日均单量 ÷ ((CTR/100)×(CVR/100))；CTR/CVR 按百分数录入
- 预算上限 = 所需曝光 × CPC；依赖变化一律自动重算
- 推广期 TACOS = 毛利率×100；稳定期 = ×0.6；亏损额度 = profit_usd × 当前日均单量 × 7
- ASIN「查询」按钮触发；复用 `GET /api/product/:asin`；查无不清空已有财务手填
- 不删 DB 列 `acos_limit`；新保存写 NULL；表单与列表无 ACoS
- 不改周复盘、每日填报、产品经济核算公式
- 仅在用户明确要求时 git commit（commit 步骤可选）

## File Structure

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/sprint-form-calc.js` | 纯函数：结束日期、所需曝光、预算、财务默认值 |
| `test/test-sprint-form-calc.js` | 公式单测 |
| `database.js` | ALTER 排名类型 + 新列 |
| `init.sql` | 同步建表定义 |
| `routes/page-api.js` | `saveSprint` 读写新字段 |
| `frontend/src/views/SprintFormView.js` | 表单 UI + 查询 + 派生绑定 |
| `frontend/src/views/SprintsView.js` | 列表列调整 |

---

### Task 1: 派生计算纯函数 + 单测

**Files:**
- Create: `frontend/src/utils/sprint-form-calc.js`
- Create: `test/test-sprint-form-calc.js`

**Interfaces:**
- Produces:
  - `calcEndDate(startDateStr, cycleDays) -> 'YYYY-MM-DD' | ''`
  - `calcRequiredImpressions(targetDailyOrders, ctrPct, cvrPct) -> number | null`
  - `calcBudgetCap(requiredImpressions, cpc) -> number | null`
  - `calcFinanceDefaults({ profitMarginRatio, profitUsd, currentDailyOrders }) -> { profit_margin_pct, promo_tacos_limit, stable_tacos_target, max_loss_7d }`
  - `round(n, digits=2)` helper as needed

- [ ] **Step 1: 写失败单测**

创建 `test/test-sprint-form-calc.js`：

```js
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
console.log('ok');
```

- [ ] **Step 2: 跑测确认失败**

```powershell
node test/test-sprint-form-calc.js
```

Expected: `Cannot find module` 或类似失败。

- [ ] **Step 3: 实现 `frontend/src/utils/sprint-form-calc.js`**

用 CommonJS `module.exports`（与 `test/` 一致；若前端 Vite 仅 ESM，则同时 `export` 命名导出，或文件用：

```js
function calcEndDate(startDateStr, cycleDays) {
    const days = Number(cycleDays);
    if (!startDateStr || !Number.isFinite(days) || days <= 0) return '';
    const d = new Date(startDateStr + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Math.trunc(days) - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function calcRequiredImpressions(targetDailyOrders, ctrPct, cvrPct) {
    const orders = Number(targetDailyOrders);
    const ctr = Number(ctrPct) / 100;
    const cvr = Number(cvrPct) / 100;
    if (![orders, ctr, cvr].every(Number.isFinite) || orders < 0 || ctr <= 0 || cvr <= 0) return null;
    return Math.round((orders / (ctr * cvr)) * 100) / 100;
}

function calcBudgetCap(requiredImpressions, cpc) {
    const imp = Number(requiredImpressions);
    const p = Number(cpc);
    if (![imp, p].every(Number.isFinite) || imp < 0 || p < 0) return null;
    return Math.round(imp * p * 100) / 100;
}

function calcFinanceDefaults({ profitMarginRatio, profitUsd, currentDailyOrders }) {
    const ratio = Number(profitMarginRatio);
    const marginPct = Number.isFinite(ratio) ? Math.round(ratio * 10000) / 100 : null;
    const profit = Number(profitUsd);
    const orders = Number(currentDailyOrders);
    let maxLoss = null;
    if (Number.isFinite(profit) && Number.isFinite(orders) && orders > 0) {
        maxLoss = Math.round(profit * orders * 7 * 100) / 100;
    }
    return {
        profit_margin_pct: marginPct,
        promo_tacos_limit: marginPct,
        stable_tacos_target: marginPct == null ? null : Math.round(marginPct * 0.6 * 100) / 100,
        max_loss_7d: maxLoss
    };
}

module.exports = { calcEndDate, calcRequiredImpressions, calcBudgetCap, calcFinanceDefaults };
```

若 Vite 打包需 ESM：在文件末尾加  
`export { calcEndDate, calcRequiredImpressions, calcBudgetCap, calcFinanceDefaults };`  
且 `SprintFormView` 用命名 import；Node 单测继续 `require`（若双模式失败，把工具放到 `frontend/src/utils/sprint-form-calc.cjs` 或把测试改为动态 import——优先 **单文件 CJS + 前端通过 `createRequire` 不现实**；推荐：工具写成 ESM `export`，测试用：

```js
import { createRequire } from 'module';
```

更简单：把工具放 `service/sprint-form-calc.js`（CJS），前端复制？**NO** — 放 `frontend/src/utils/sprint-form-calc.js` 用：

```js
export function calcEndDate(...) { ... }
// ...
```

测试：

```js
// test/test-sprint-form-calc.mjs 或 package type
```

检查仓库测试惯例：若现有 `test/*.js` 用 `require`，则工具用：

```js
function calcEndDate(...) {}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcEndDate, calcRequiredImpressions, calcBudgetCap, calcFinanceDefaults };
}
export { calcEndDate, calcRequiredImpressions, calcBudgetCap, calcFinanceDefaults };
```

（Vite 支持该混合模式时采用；否则纯 ESM + `node --experimental-vm-modules` / `.mjs` 测试。）

- [ ] **Step 4: 跑测通过**

```powershell
node test/test-sprint-form-calc.js
```

Expected: 打印 `ok`，exit 0。

- [ ] **Step 5: Commit（可选）**

```bash
git add frontend/src/utils/sprint-form-calc.js test/test-sprint-form-calc.js
git commit -m "feat: 冲刺表单派生计算工具与单测"
```

---

### Task 2: DB 迁移（database.js + init.sql）

**Files:**
- Modify: `database.js`（`sprint_projects` CREATE 与 ALTER 段）
- Modify: `init.sql`（`sprint_projects` 定义）

**Interfaces:**
- Consumes: 无
- Produces: 列 `ctr_7d` `cvr_7d` `cpc` `required_impressions` `budget_cap`；`current_rank`/`target_rank` 为 VARCHAR(255)

- [ ] **Step 1: 更新 `init.sql` 中 `sprint_projects`**

将 `current_rank`/`target_rank` 改为 `VARCHAR(255) DEFAULT NULL`，并在 `acos_limit` 附近增加：

```sql
ctr_7d DECIMAL(10,4) DEFAULT NULL COMMENT '7日日均CTR(%)',
cvr_7d DECIMAL(10,4) DEFAULT NULL COMMENT '7日日均CVR(%)',
cpc DECIMAL(10,4) DEFAULT NULL COMMENT 'CPC($)',
required_impressions DECIMAL(14,2) DEFAULT NULL COMMENT '所需曝光',
budget_cap DECIMAL(12,2) DEFAULT NULL COMMENT '预算上限($)',
```

- [ ] **Step 2: 更新 `database.js` CREATE 块** 与上述一致。

- [ ] **Step 3: 追加安全 ALTER**（在现有 sprint ALTER try/catch 后新开一块）：

```js
try {
    await p.query(
        `ALTER TABLE sprint_projects
         MODIFY COLUMN current_rank VARCHAR(255) DEFAULT NULL,
         MODIFY COLUMN target_rank VARCHAR(255) DEFAULT NULL,
         ADD COLUMN ctr_7d DECIMAL(10,4) DEFAULT NULL COMMENT '7日日均CTR(%)',
         ADD COLUMN cvr_7d DECIMAL(10,4) DEFAULT NULL COMMENT '7日日均CVR(%)',
         ADD COLUMN cpc DECIMAL(10,4) DEFAULT NULL COMMENT 'CPC($)',
         ADD COLUMN required_impressions DECIMAL(14,2) DEFAULT NULL COMMENT '所需曝光',
         ADD COLUMN budget_cap DECIMAL(12,2) DEFAULT NULL COMMENT '预算上限($)'`
    );
} catch (e) {
    if (!isSafeMigrationError(e)) {}
}
```

若 `ADD COLUMN` 部分列已存在导致整体失败：改为逐列 `ADD COLUMN` 各自 try/catch（推荐逐列，更稳）。

- [ ] **Step 4: 验收**

```powershell
Select-String -Path database.js,init.sql -Pattern "budget_cap|ctr_7d|required_impressions"
```

Expected: 两文件均有匹配。

- [ ] **Step 5: Commit（可选）**

```bash
git add database.js init.sql
git commit -m "feat: sprint_projects 增加冲刺目标与预算字段"
```

---

### Task 3: 后端 `saveSprint` 读写新字段

**Files:**
- Modify: `routes/page-api.js`（`saveSprint` 及附近 `intOrNull` 对排名的用法）

**Interfaces:**
- Consumes: Task 2 新列
- Produces: 保存/更新含新字段；`current_rank`/`target_rank` 字符串；`acos_limit` → NULL

- [ ] **Step 1: 改 `saveSprint` values**

- 排名：`String(body.current_rank || '').trim() || null`（不再 `intOrNull`）
- 追加：`numOrNull(body.ctr_7d)`、`cvr_7d`、`cpc`、`required_impressions`、`budget_cap`
- `acos_limit`：固定 `null`（仍写列，满足「不删列」）

UPDATE/INSERT 列清单同步加上新字段。

- [ ] **Step 2: 验收**

```powershell
Select-String -Path routes/page-api.js -Pattern "budget_cap|ctr_7d|required_impressions"
Select-String -Path routes/page-api.js -Pattern "intOrNull\(body\.current_rank\)"
```

Expected: 第一条有匹配；第二条无匹配。

- [ ] **Step 3: Commit（可选）**

```bash
git add routes/page-api.js
git commit -m "feat: 冲刺保存接口支持目标与预算字段"
```

---

### Task 4: `SprintFormView` 表单 UI 与派生逻辑

**Files:**
- Modify: `frontend/src/views/SprintFormView.js`

**Interfaces:**
- Consumes: `sprint-form-calc` 导出；`GET /api/product/:asin` 返回 `{ economics: { computed: { profit_margin, profit_usd } } }`
- Produces: 完整表单交互

- [ ] **Step 1: 扩展 form 字段与 load**

form 增加：`ctr_7d`、`cvr_7d`、`cpc`、`required_impressions`、`budget_cap`；去掉对 `acos_limit` 的 UI 绑定（load/save payload 可不带或带 null）。

- [ ] **Step 2: 绑定自动计算**

用 `watch`（需从 vue 引入）监听：
- `[() => form.start_date, () => form.target_cycle_days]` → `form.end_date = calcEndDate(...)`
- `[target_daily_orders, ctr_7d, cvr_7d]` → `required_impressions`
- `[required_impressions, cpc]` → `budget_cap`

或在各 `@change`/`@input` 上调用同一 `recalcAll()`（推荐单一 `recalcDerived()`，在相关字段 `@input` 调用，避免 load 时循环；**load 完成后调一次**）。

- [ ] **Step 3: ASIN 查询**

```js
async function queryAsin() {
  const asin = String(form.asin || '').trim();
  if (!asin) { error.value = '请先填写 ASIN'; return; }
  querying.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/api/product/' + encodeURIComponent(asin));
    const c = data.economics && data.economics.computed;
    if (!c) throw new Error('无产品经济数据');
    const d = calcFinanceDefaults({
      profitMarginRatio: c.profit_margin,
      profitUsd: c.profit_usd,
      currentDailyOrders: form.current_daily_orders
    });
    if (d.profit_margin_pct != null) form.profit_margin = d.profit_margin_pct;
    if (d.promo_tacos_limit != null) form.promo_tacos_limit = d.promo_tacos_limit;
    if (d.stable_tacos_target != null) form.stable_tacos_target = d.stable_tacos_target;
    if (d.max_loss_7d != null) form.max_loss_7d = d.max_loss_7d;
  } catch (e) {
    error.value = getApiError(e, '查询失败');
  } finally {
    querying.value = false;
  }
}
```

ASIN 行：input + `<button type="button" class="btn-sm" @click="queryAsin">查询</button>`。

当 `current_daily_orders` 变化且已有缓存的 `lastProfitUsd`（查询时存 ref）时可重算 `max_loss_7d`——推荐查询时把 `profit_usd` 存 `lastProfitUsd`，watch 单量变化时若有值则更新亏损额度。

- [ ] **Step 4: 模板按 spec 改区块**

- 排名：`type="text"` + placeholder  
- 冲刺目标四字段  
- 财务：去掉 ACOS，加预算上限  
- 结束日期仍可编辑

- [ ] **Step 5: 静态验收**

```powershell
Select-String -Path frontend/src/views/SprintFormView.js -Pattern "acos_limit|ACOS"
Select-String -Path frontend/src/views/SprintFormView.js -Pattern "queryAsin|required_impressions|budget_cap|请输入小类排名"
```

Expected: 无 ACOS 表单项（payload 写 null 可保留字段名）；第二条均有匹配。

- [ ] **Step 6: Commit（可选）**

```bash
git add frontend/src/views/SprintFormView.js
git commit -m "feat: 冲刺表单支持周期回填目标与财务查询"
```

---

### Task 5: 列表去掉 ACoS、展示预算上限

**Files:**
- Modify: `frontend/src/views/SprintsView.js`

- [ ] **Step 1: 表头/单元格**

- `ACOS上限` → `预算上限`
- `sp.acos_limit` → `sp.budget_cap`

- [ ] **Step 2: 验收**

```powershell
Select-String -Path frontend/src/views/SprintsView.js -Pattern "acos_limit|ACOS"
Select-String -Path frontend/src/views/SprintsView.js -Pattern "budget_cap|预算上限"
```

Expected: 第一条无匹配；第二条有匹配。

- [ ] **Step 3: Commit（可选）**

```bash
git add frontend/src/views/SprintsView.js
git commit -m "feat: 冲刺列表用预算上限替换 ACoS 列"
```

---

## Spec Coverage

| Spec 项 | Task |
|---------|------|
| 结束日期回填公式 | Task 1 + 4 |
| 文本排名 + placeholder | Task 2–4 |
| 冲刺目标四字段与曝光公式 | Task 1 + 4 |
| 预算上限 | Task 1 + 4–5 |
| ASIN 查询回填 TACOS/亏损/利润率 | Task 4 |
| 移除 ACoS 表单/列表 | Task 3–5 |
| DB 新列 + 排名 VARCHAR | Task 2 |
| 保存 API | Task 3 |

## Self-review notes

- 无 TBD；CTR 百分数口径与单测 `0.5`/`10` → 20000 一致
- `max_loss` 在查询时若单量为空为 null；单量后补需 `lastProfitUsd` 联动（Task 4 已写）
