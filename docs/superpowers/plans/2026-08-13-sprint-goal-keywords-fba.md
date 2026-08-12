# 冲刺目标文本、关键词与 FBA 库存天数 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冲刺表单增加冲刺目标文本与关键词、FBA 仓库数量并派生库存天数；CTR 等指标并入业务目标；移除竞品当前动作。

**Architecture:** 扩展 `sprint-form-calc` 增加 `calcInventoryDays`；DB 增列；`saveSprint` 读写新字段且 `competitor_action` 写 NULL；`SprintFormView` 调整布局与 watch（hydrating 保护编辑加载）。

**Tech Stack:** Vue 3、Express page-api、MySQL database.js/init.sql、既有 Node 单测

**Spec:** `docs/superpowers/specs/2026-08-13-sprint-goal-keywords-fba-design.md`

## Global Constraints

- 冲刺目标：独立 text；冲刺关键词：textarea
- CTR/CVR/CPC/曝光保留，并入业务目标，去掉单独「冲刺目标」小标题
- 库存天数 = FBA仓库数量 ÷ 当前日均单量；可手改；编辑 load 不覆盖（hydrating）
- 移除竞品当前动作 UI；保存 `competitor_action = NULL`
- 不改财务/曝光/预算/日期公式；列表默认不加新列
- 仅在用户明确要求时 git commit（commit 可选）

## File Structure

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/sprint-form-calc.js` | `calcInventoryDays` |
| `test/test-sprint-form-calc.js` | 单测 |
| `database.js` / `init.sql` | 新列 |
| `routes/page-api.js` | saveSprint |
| `frontend/src/views/SprintFormView.js` | UI + 派生 |

---

### Task 1: calcInventoryDays + 单测

**Files:**
- Modify: `frontend/src/utils/sprint-form-calc.js`
- Modify: `test/test-sprint-form-calc.js`

- [ ] **Step 1: 失败测试**

```js
const { calcInventoryDays } = require('../frontend/src/utils/sprint-form-calc.js');
assert.strictEqual(calcInventoryDays(140, 10), 14);
assert.strictEqual(calcInventoryDays(100, 0), null);
assert.strictEqual(calcInventoryDays(null, 10), null);
```

- [ ] **Step 2: 实现**

```js
function calcInventoryDays(fbaQty, currentDailyOrders) {
  const qty = toFiniteOrNull(fbaQty);
  const orders = toFiniteOrNull(currentDailyOrders);
  if (qty == null || orders == null || orders <= 0 || qty < 0) return null;
  return Math.round((qty / orders) * 100) / 100;
}
```

导出并跑 `node test/test-sprint-form-calc.js` 期望 `ok`。

- [ ] **Step 3: Commit（可选）** `feat: 库存天数派生计算`

---

### Task 2: DB 新列

**Files:** `database.js`, `init.sql`

- [ ] 在 `sprint_projects` 增加：
  - `sprint_goal VARCHAR(500) DEFAULT NULL`
  - `sprint_keywords TEXT`
  - `fba_warehouse_qty DECIMAL(12,2) DEFAULT NULL`
- [ ] CREATE + 逐列 ADD COLUMN try/catch
- [ ] Commit（可选）`feat: sprint 增加目标关键词与FBA数量字段`

---

### Task 3: saveSprint

**Files:** `routes/page-api.js`

- [ ] 读写 `sprint_goal`（trim 字符串或 null）、`sprint_keywords`、`fba_warehouse_qty`（numOrNull）
- [ ] `competitor_action` 固定 `null`（不再读 body）
- [ ] UPDATE/INSERT 占位符与 values 数量对齐
- [ ] Commit（可选）`feat: 冲刺保存支持目标关键词与FBA数量`

---

### Task 4: SprintFormView UI

**Files:** `frontend/src/views/SprintFormView.js`

- [ ] form 增：`sprint_goal`、`sprint_keywords`、`fba_warehouse_qty`；去掉 `competitor_action` 绑定
- [ ] load/save 同步新字段；payload `competitor_action` 可省略（后端写 NULL）
- [ ] 业务目标：去掉「冲刺目标」小标题；加入冲刺目标 input、冲刺关键词 textarea；保留四指标
- [ ] 市场与供应链：FBA仓库数量；库存天数；去掉竞品动作
- [ ] watch：`fba_warehouse_qty` + `current_daily_orders` → `calcInventoryDays`（尊重 hydrating）
- [ ] Commit（可选）`feat: 冲刺表单目标关键词与FBA库存天数`

---

## Spec Coverage

| Spec | Task |
|------|------|
| calcInventoryDays | 1 |
| DB 列 | 2 |
| API | 3 |
| 表单布局与移除竞品 | 4 |
| hydrating 保护库存天数 | 4 |
