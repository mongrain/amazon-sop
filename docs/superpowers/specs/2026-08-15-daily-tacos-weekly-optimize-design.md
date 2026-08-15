# 每日填报 TACOS + 周复盘 GPT 优化方案

日期：2026-08-15  
状态：已确认设计，待实现

## 背景

每日填报提交时已用「广告花费 ÷ 总销售额 × 100」计算 `tacos` 入库，但表格不展示、也不能从领星带回。周复盘已有对照卡片和规则决策，没有针对该条冲刺广告的可执行优化建议。

## 目标

1. 每日填报表增加 TACOS(%) 列：领星有数用领星，没有则花费÷总销售额；提交以表格值为准
2. 周复盘增加独立「优化建议」：按钮调 GPT 生成，已有内容不覆盖，写入新列 `optimization_plan`
3. GPT 只使用本周日报 + 冲刺目标/财务风控，不拉广告活动、搜索词

## 非目标

- 不改决策规则（CONTINUE / MAINTENANCE / STOPPED）
- 不改周复盘领星补缺天、对照可视化
- 不改冲刺保存、每日填报其它列的提交语义（除可选 `tacos`）
- 不把 GPT / yanjun token 暴露给浏览器
- `COMPLETED` 不生成优化方案

## 决策摘要

| 项 | 选择 |
|----|------|
| 每日 TACOS 来源 | 领星优先，否则花费÷总销售额 |
| 提交入库 | 表格里的 TACOS；空则仍重算 |
| 优化方案生成 | 按钮「生成优化方案」 |
| 覆盖 | 已有文本不调 GPT、不覆盖 |
| 存储 | `weekly_reviews.optimization_plan` |
| GPT | 现有 `chatCompletionText`；不拉广告明细 |

## 架构

```text
每日填报
  GET /api/metrics/manual 带回 tacos
  从领星拉取 → map tacos，空则花费÷销售额
  改花费/销售额且 TACOS 仍空 → 前端补算
  POST /api/v1/metrics/upload：body.tacos 有限则用，否则重算

周复盘
  GET /api/reviews/:id 的 review 含 optimization_plan
  点「生成优化方案」
    → POST /api/reviews/:id/optimize-plan
    → 已有内容：不调模型，返回现有
    → 否则 chatCompletionText(本周数据 + 冲刺)
    → 前端只填空框
  保存 POST /api/reviews/:id 增加 optimization_plan
```

## 每日填报

### 表格

在总销售额后增加 TACOS(%) 列，可编辑。

`METRIC_KEYS` / 回填包含 `tacos`。`PULL_KEYS` 含 `tacos`（领星预填可写入）。

### 领星映射

`PERF_FIELD_MAP.tacos`：`tacos`, `ta_cos`, `tacos_rate`, `advertising_cost_of_sales`。

取出后走 `toFormPercent`（绝对值 `>1` 视为百分数；`≤1` 视为比率 ×100）。对不上则为 `null`。

预填合并后，对仍空的 TACOS：若该行 `ad_spend`、`total_sales` 有限且销售额 > 0，写入 `ad_spend/total_sales*100`（两位小数）。

前端：花费或总销售额变化时，若 TACOS 为空，同样补算；已有数字（含 0）不覆盖。

### 提交

`POST /api/v1/metrics/upload`：某行 `tacos` 为有限数字则入库该值；否则 `ad_spend/total_sales*100`（销售额 ≤0 则为 null）。对外仍返回 `{ status, processed }`。

`GET /api/metrics/manual` 的 row 增加 `tacos`。

周复盘补缺天 `insertLingxingDailyRow`：映射到 tacos 则用映射值（已是百分数则直接存；与 upload 同一套派生：有 mapped.tacos 用它，否则 `computeDerivedMetrics` 的 tacos）。`computeDerivedMetrics` 可增加可选覆盖，避免两套公式分叉。

## 周复盘优化建议

### 数据

`weekly_reviews.optimization_plan TEXT`（`database.js` ALTER + `init.sql`）。

GET 的 `review` 带出该列。保存：`optimization_plan` 允许空字符串。

### 页面

核对/决策之后、保存之前：模块「优化建议」，`textarea` 绑定 `form.optimization_plan`。

PENDING：按钮「生成优化方案」，请求中禁用。`COMPLETED` 无按钮。

空的定义与现有一致：`null` / `''` / 空白；`0` 不算空（文本场景几乎用不到）。

### POST `/api/reviews/:id/optimize-plan`

需登录。无 body。

1. 复盘不存在 404
2. `COMPLETED` 400 `已完成的复盘不能生成优化方案`
3. 已有非空 `optimization_plan`：200 `{ optimization_plan, skipped: true }`，不调 GPT
4. 未配 `GPT_API_URL` 或调用失败：400/502，不写库
5. 成功：不在此接口写库；返回 `{ optimization_plan, skipped: false }`，前端填空框；用户点保存才入库

### GPT 入参

JSON 或纯文本块，含：

- ASIN、sprint_goal、target_daily_orders、ctr_7d、cvr_7d、cpc
- promo_tacos_limit、stable_tacos_target、max_loss_7d、budget_cap
- 本周 7 天：date、status、orders、ad_spend、total_sales、tacos
- 本周汇总：花费、TACOS、日均单量、CTR、CVR、CPC
- 规则建议决策（suggestion.decision）

系统提示要点：针对该 ASIN 冲刺广告给可执行优化（预算、出价、是否控花费、是否冲曝光/单量），分条中文；不要改写 CONTINUE/MAINTENANCE/STOPPED；不要编造未提供的搜索词或活动名。

复用 `chatCompletionText`。

## 错误与空态

| 情况 | 行为 |
|------|------|
| 领星无 tacos | 用花费÷销售额；两者缺则列空 |
| 提交无 tacos | 服务端重算 |
| GPT 未配置/失败 | 提示错误，优化框不动 |
| 已有优化建议再点生成 | 不调模型，提示已有内容 |
| COMPLETED | 无生成按钮 |

## 测试要点

- `toFormPercent` / tacos 映射：0.15 → 15；15 → 15
- 无 tacos 有花费销售额 → 补算
- upload：body.tacos=12 入库 12；无 tacos 则重算
- 优化：空 plan 才调 GPT 的分支可用假 chat 注入测；已有 plan 不调用

## 验收标准

1. 填报表有 TACOS 列；领星有则填上，没有则能算出
2. 提交后再打开，TACOS 还在
3. 点生成得到分条建议，已填不覆盖；保存后再打开还在
4. 决策规则、对照卡片、领星补缺天行为不变

## 风险

- 领星 TACOS 与花费÷销售额可能不一致，以表格最终值为准
- GPT 可能较慢，按钮需禁用并提示生成中
- 优化方案不引用真实广告活动名，避免幻觉
