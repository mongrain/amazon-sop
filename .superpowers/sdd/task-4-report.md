# Task 4 Report: SprintFormView 表单 UI 与派生逻辑

## Status: DONE

## Summary

Updated `frontend/src/views/SprintFormView.js` to support cycle end-date backfill, sprint goal fields (CTR/CVR/CPC/required impressions), budget cap derivation, ASIN finance query, text ranks, and removal of ACoS UI.

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/views/SprintFormView.js` | Form fields, watches, `queryAsin`, template sections |

## Changes

| Area | Behavior |
|------|----------|
| Form fields | Added `ctr_7d`, `cvr_7d`, `cpc`, `required_impressions`, `budget_cap`; removed `acos_limit` from form state/UI; save payload sets `acos_limit: null` |
| Ranks | `type="text"` + placeholder `请输入小类排名xx名, 大类排名xx名` |
| End date | `watch([start_date, target_cycle_days])` → `calcEndDate`; still editable |
| Derived | `required_impressions` / `budget_cap` via calc helpers; watchers + `recalcDerived()` after load |
| ASIN query | Button → `GET /api/product/:asin` → `calcFinanceDefaults`; `lastProfitUsd` + watch on `current_daily_orders` for `max_loss_7d` |
| Sections | 「冲刺目标」under 业务目标; 财务风控 has 预算上限, no ACoS |
| Import | Named ESM from `@/utils/sprint-form-calc.js` |

## Verification Evidence

```powershell
Select-String -Path frontend/src/views/SprintFormView.js -Pattern "ACOS上限|form\.acos_limit"
Select-String -Path frontend/src/views/SprintFormView.js -Pattern "queryAsin|required_impressions|budget_cap|请输入小类排名"
node --check frontend/src/views/SprintFormView.js
```

- First command: no matches (no ACoS UI / form binding) ✓
- Second command: matches for queryAsin, required_impressions, budget_cap, rank placeholder ✓
- `node --check`: pass ✓

## Commit

```
b0eab8b feat: 冲刺表单支持周期回填目标与财务查询
```

## Self-Review

- [x] New fields in form / load / template
- [x] ACoS UI removed; payload may send `acos_limit: null`
- [x] End date auto + editable
- [x] Impressions / budget_cap recalc on deps + after load
- [x] ASIN query + lastProfitUsd max_loss refresh
- [x] Named import from sprint-form-calc
- [x] Only SprintFormView.js committed

## Concerns

- **No browser E2E**: static checks only; ASIN query / live form not exercised in UI.
- **Watch during load**: field assignment may trigger intermediate recalcs before final `recalcDerived()`; final state still correct when deps are valid.
- **Manual edits overwritten**: changing CTR/CVR/orders/CPC/start/cycle will overwrite hand-edited impressions/budget/end_date (accepted by design).
- **List ACoS removal** is Task 5, not this task.

---

## Review Fix: null profit → 0 max_loss (2026-08-13)

### Problem

`Number(null) === 0` caused empty `profit_usd` from ASIN query to be treated as zero profit, yielding `max_loss_7d = 0` instead of leaving the field unset.

### Fix

| File | Change |
|------|--------|
| `frontend/src/utils/sprint-form-calc.js` | Added `toFiniteOrNull`; `calcFinanceDefaults` uses it for margin/profit/orders |
| `frontend/src/views/SprintFormView.js` | `queryAsin` sets `lastProfitUsd` via `toFiniteOrNull(c.profit_usd)` |
| `test/test-sprint-form-calc.js` | Cases: null margin → null TACOS fields; null profit → null max_loss; legitimate 0 profit → 0 max_loss |

### Verification

```powershell
node test/test-sprint-form-calc.js
```

Output: `ok` ✓

### Commit

```
e682459 fix: 冲刺查询忽略空利润避免亏损额度为0
```

---

## Final Review Fix: 编辑加载不覆盖派生字段 (2026-08-13)

### Problem

`loadForm` 末尾无条件调用 `recalcDerived()`，编辑已有冲刺时会用公式重算覆盖已保存的 `end_date` / `required_impressions` / `budget_cap`。加载期间字段赋值也会触发 watch 产生中间重算。

### Fix

| File | Change |
|------|--------|
| `frontend/src/views/SprintFormView.js` | 新增 `hydrating` 标志；加载赋值期间 watch 跳过；移除编辑加载后的 `recalcDerived()`；新建表单（无 `sprintId`）加载默认后仍调用一次 `recalcDerived()` |

### Verification

```powershell
node --check frontend/src/views/SprintFormView.js
```

Output: pass ✓

### Commit

```
fix: 编辑冲刺时加载不覆盖已保存派生字段
```
