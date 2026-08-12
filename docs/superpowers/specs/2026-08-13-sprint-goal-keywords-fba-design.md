# 冲刺表单：冲刺目标文本、关键词与 FBA 库存天数

日期：2026-08-13  
状态：已确认设计，待实现

## 背景

在已落地的冲刺目标指标（CTR/CVR/CPC/曝光）与财务风控之上，补充业务文案字段，并按 FBA 仓库数量推算库存可支撑天数；去掉竞品当前动作。

## 目标

1. 新增独立文本字段「冲刺目标」
2. 新增「冲刺关键词」textarea
3. CTR/CVR/CPC/所需曝光保留，并入「业务目标」区块（去掉单独小标题「冲刺目标」）
4. 移除「竞品当前动作」UI；保存时 `competitor_action = NULL`（列保留）
5. 新增「FBA仓库数量」；库存可支撑天数 = FBA仓库数量 ÷ 当前日均单量（可手改；编辑加载不覆盖已存天数）

## 非目标

- 不改财务查询、曝光/预算公式、日期回填
- 不删 DB 列 `competitor_action`
- 列表默认不新增冲刺目标/关键词/FBA 列

## 决策摘要

| 项 | 选择 |
|----|------|
| 冲刺目标 | 独立 text；原指标区块并入业务目标 |
| FBA 数量 | 表单手填字段 |
| 库存天数 | 自动算且可手改；hydrating 保护已存值 |
| 竞品动作 | 仅去 UI，保存写 NULL |

## 表单

### 业务目标
- 当前日均单量、目标日均单量
- 当前排名、目标排名（text + 既有 placeholder）
- 冲刺目标（text）
- 冲刺关键词（textarea）
- 7日日均CTR(%)、7日日均CVR(%)、CPC($)、所需曝光

### 市场与供应链
- FBA仓库数量
- 库存可支撑天数（派生，可手改）
- 页面是否达标
- 无竞品当前动作

## 计算

```
inventory_days = fba_warehouse_qty / current_daily_orders
```

- 仅当两者有效且 `current_daily_orders > 0` 时自动写入
- 依赖变化一律重算（可手改后被覆盖，与曝光/预算策略一致）
- `loadForm` 编辑态：`hydrating` 期间不触发覆盖

## 数据与接口

### `sprint_projects` 新列
- `sprint_goal VARCHAR(500) NULL`
- `sprint_keywords TEXT NULL`
- `fba_warehouse_qty DECIMAL(12,2) NULL`（或 INT，实现取 DECIMAL 兼容小数箱数）

### API
- `saveSprint` 读写上述字段；`competitor_action` 固定 NULL

### 文件
- `database.js` / `init.sql`
- `routes/page-api.js`
- `frontend/src/views/SprintFormView.js`
- `frontend/src/utils/sprint-form-calc.js`（增加 `calcInventoryDays`）+ 单测

## 验收

1. 业务目标含冲刺目标文本、关键词、原四指标，无单独「冲刺目标」小标题
2. 填 FBA 数量与当前日均单量后库存天数自动算，可手改
3. 编辑重开不因 hydrating 冲掉已存库存天数（仅当用户再改依赖时重算）
4. 无竞品当前动作入口；保存后该列为空
5. 财务/曝光/预算原逻辑不受影响
