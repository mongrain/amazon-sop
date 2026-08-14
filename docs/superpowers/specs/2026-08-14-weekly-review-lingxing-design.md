# 周复盘：领星补缺天 + 规则结论

日期：2026-08-14  
状态：已确认设计，待实现

## 背景

周复盘目前只人手填「本周实际最大亏损 / 当前实际 TACOS / 决策 / 结论文案」，打开页不看本周每日填报，也不对照冲刺目标与财务风控。每日填报已能从领星预填单日指标，但周复盘不会用这些数。

## 目标

1. 打开周复盘填写页时，只读展示该复盘所在自然周（周一到周日）的每日填报，并对照冲刺目标、财务风控
2. 页面「从领星拉取」：把本周已过、该 ASIN 尚无日报的天写入 `daily_asin_metrics`，已有天不覆盖
3. 用本周日报按规则预填空着的亏损、TACOS、建议决策、结论文案；人可改再保存
4. 每次复盘只用该条 `week_start_date` 对应的 7 天，不看更早历史
5. 不拉关键词、广告活动、搜索词等更细领星数据

## 非目标

- 不改每日填报提交 `POST /api/v1/metrics/upload` 的对外行为
- 不改冲刺保存、列表；不改复盘保存后按决策同步项目状态（CONTINUE/MAINTENANCE/STOPPED）
- 不调 GPT；不新增 `weekly_reviews` 列
- 不把 yanjun token 暴露给浏览器
- 不自动拉取；打开详情不调领星
- 不覆盖人已填的复盘字段；`COMPLETED` 不拉领星、不改结论
- 不新增来源枚举；领星写入 `data_source=MANUAL`

## 决策摘要

| 项 | 选择 |
|----|------|
| 周窗口 | 该条复盘 `week_start_date`（周一）到 +6 天（周日） |
| 领星入口 | 填写页按钮「从领星拉取」，手动点 |
| 补哪些天 | 本周且 `日期 < 今天`、该 ASIN 无日报的天 |
| 写入 | `daily_asin_metrics`，已有行不覆盖，`MANUAL` |
| 领星请求 | 按天 `start_date = end_date = 该日`（已过的天数据已齐，不用每日填报的 `previousCompleteDay` 偏移） |
| 本周实际最大亏损 | 本周 `ad_spend` 合计 |
| 本周 TACOS | 花费合计 / 总销售额合计 × 100 |
| 日均单量 | 订单合计 / 已填天数 |
| 决策 | 花费 ≥ 7天最大亏损额度 → STOPPED；否则 TACOS ≤ 稳定期目标 且 日均单量 ≥ 目标日均单量 → MAINTENANCE；否则 CONTINUE |
| 预填 | 仅空字段；`COMPLETED` 不预填、不拉 |
| 结论 | 固定模板，规则引擎 |

## 架构

```text
打开 GET /api/reviews/:id（只读）
  → 复盘 + 冲刺目标/财务风控 + 本周 7 天日报
  → 用已有日报算 suggestion
  → 前端只给空字段填建议；COMPLETED 不套建议
  → 不调领星

点「从领星拉取」
  → POST /api/reviews/:id/lingxing-pull
  → COMPLETED → 400
  → 本周已过且无日报的天，按天调 yanjun：lingxing_query_product_performance_asin_lists
  → 写入 daily_asin_metrics（MANUAL，不覆盖）
  → 返回更新后的本周数据 + 新 suggestion + 计数
  → 前端仍只填空字段

保存
  → 现有 POST /api/reviews/:id（人可改建议）
```

规则与领星只在服务端。复用 `service/lingxing-fetch.js` 的 `queryProductPerformanceAll` 与 `mapPerformanceRow`。新增纯函数模块（如 `service/weekly-review.js`）负责周日期、汇总、决策、结论文案，便于单测。写入日报的派生字段（acos/tacos/ctr/cvr）与现有 upload 同一套公式，可抽小组件复用，不改变 upload 接口。

## 组件

| 单元 | 职责 | 依赖 |
|------|------|------|
| `service/weekly-review.js` | 周 7 日列表、汇总、决策、模板结论、空字段判定 | 无 I/O |
| `GET /api/reviews/:id` | 拼复盘 + 冲刺 + 本周日报 + suggestion | weekly-review、DB |
| `POST /api/reviews/:id/lingxing-pull` | 补缺天写库后返回同上结构 | weekly-review、lingxing-fetch、DB |
| `ReviewFormView` | 本周表、对照、拉取按钮、空字段套建议 | 上述 API |
| 现有 `POST /api/reviews/:id` | 保存与项目状态同步，行为不变 | 无 |

列表页 `ReviewsView` 不改。

## 页面

仍用 `/reviews/:id`，标题「周复盘填写」。

### 本周数据（只读）

周一到周日每天一行：日期、状态、订单、广告花费、总销售额、TACOS。

状态：

- `已填`：该 ASIN 该日有 `daily_asin_metrics` 行
- `缺填`：该日 `<` 今天且无行
- `未到`：该日 `≥` 今天

### 对照（只读）

有数才显示对比，缺目标则只显示实际并注明缺项：

- 花费合计 vs 7天最大亏损额度
- 本周 TACOS vs 推广期允许 TACOS、稳定期目标 TACOS
- 日均单量 vs 目标日均单量
- 本周 CTR(%) / CVR(%) / CPC vs 冲刺 `ctr_7d` / `cvr_7d` / `cpc`（能算才比）

冲刺目标文案（`sprint_goal`）只展示，不参与决策数字。

### 从领星拉取

- 按钮放在标题旁；请求中禁用
- `COMPLETED` 不显示按钮
- 提示：`已补 N 天，跳过已录入 M 天，领星无数据 K 天`
- 成功后刷新本周表与对照；只给仍空着的核对/决策/结论填建议

### 核对与决策

现有「本周实际最大亏损 / 当前实际 TACOS / 决策 / 复盘状态 / 复盘结论」可编辑、可保存。空的定义：`null` / `undefined` / `''` / 仅空白；`0` 不算空，不覆盖。

## 计算

窗口：`week_start` … `week_start + 6`。只用这 7 天、该复盘对应冲刺 ASIN 的日报。

### 汇总

- 已填天数 = 这 7 天中有日报行的天数
- 订单合计 / 花费合计 / 总销售额合计 / 点击合计 / 曝光合计：只加有限数字；`null` 当 0 加总
- 本周实际最大亏损 = 花费合计（有限数字；0 天日报则为 `null`）
- 本周 TACOS(%) = 花费合计 / 总销售额合计 × 100；销售额合计 ≤ 0 则为 `null`
- 日均单量 = 订单合计 / 已填天数；已填天数 = 0 则为 `null`
- 本周 CTR(%) = 点击合计 / 曝光合计 × 100；曝光合计 ≤ 0 则为 `null`（用合计相除，不平均每日 ctr）
- 本周 CVR(%) = 订单合计 / 点击合计 × 100；点击合计 ≤ 0 则为 `null`
- 本周 CPC = 花费合计 / 点击合计；点击合计 ≤ 0 则为 `null`

日报里的 `tacos`/`ctr`/`cvr` 列仅用于行展示；周汇总不依赖它们。

### 决策（先 STOPPED，再 MAINTENANCE，否则 CONTINUE）

1. `max_loss_7d` 为有限数字 且 本周实际最大亏损为有限数字 且 花费合计 ≥ `max_loss_7d` → `STOPPED`
2. 否则：`stable_tacos_target`、本周 TACOS、`target_daily_orders`、日均单量 均为有限数字，且 本周 TACOS ≤ 稳定期目标，且 日均单量 ≥ 目标日均单量 → `MAINTENANCE`
3. 否则 → `CONTINUE`

额度或目标缺省：跳过对应分支（不做 STOPPED / 不做 MAINTENANCE）。  
0 天日报：亏损/TACOS 为 `null`，决策 `CONTINUE`，结论写「本周暂无日报」。

### 结论文案模板

固定中文段落，能算才写该行，不调 GPT。示例结构：

```
本周区间：YYYY-MM-DD ~ YYYY-MM-DD，已填 N/7 天。
花费合计 $X（7天最大亏损额度 $Y）：未超线 / 已超线 / 额度未设。
本周 TACOS Z%（推广期允许 A%，稳定期目标 B%）。
日均单量 C（目标 D）：未达标 / 已达标 / 目标未设。
本周 CTR x%（目标 x%）；CVR y%（目标 y%）；CPC $z（目标 $z）。（缺则省略）
建议：CONTINUE / MAINTENANCE / STOPPED。原因：<与决策分支对应的一句>。
```

原因一句：

- STOPPED：`本周广告花费已达或超过 7 天最大亏损额度`
- MAINTENANCE：`本周 TACOS 不高于稳定期目标且日均单量达到目标`
- CONTINUE：`未触发停止或转维护条件`（0 天日报时改为 `本周暂无日报`）

## 接口

均需登录，不加入 `PUBLIC_ROUTES`。

### GET `/api/reviews/:id`

现有复盘不存在仍 404。扩展响应，保持 `review` 字段兼容列表/保存。

```json
{
  "review": { "id": 1, "sprint_id": 12, "asin": "B0XX", "week_start_date": "2026-08-10", "status": "PENDING" },
  "sprint": {
    "sprint_goal": "...",
    "target_daily_orders": 5,
    "ctr_7d": 0.4,
    "cvr_7d": 8,
    "cpc": 0.8,
    "promo_tacos_limit": 25,
    "stable_tacos_target": 15,
    "max_loss_7d": 70,
    "profit_margin": 25,
    "budget_cap": 200
  },
  "week": {
    "start": "2026-08-10",
    "end": "2026-08-16",
    "today": "2026-08-14",
    "days": [
      { "date": "2026-08-10", "status": "filled", "orders": 3, "ad_spend": 12, "total_sales": 100, "tacos": 12 }
    ]
  },
  "suggestion": {
    "actual_max_loss": 80,
    "actual_tacos": 15.2,
    "decision": "CONTINUE",
    "summary": "..."
  }
}
```

`week.days` 恒为 7 条。`status`：`filled` / `missing` / `upcoming`。未填天指标为 `null`。  
`COMPLETED` 仍返回 `week` 与 `suggestion`（供只读对照），前端不套到表单、不显示拉取按钮。  
`today` 用服务端现有 `toDateString(new Date())`。

### POST `/api/reviews/:id/lingxing-pull`

无 body。

1. 复盘不存在 404；无 ASIN 400
2. `COMPLETED` 400，`已完成的复盘不能拉取`
3. 未配置 `YANJUN_MCP_URL`：400，`未配置领星网关`
4. 列出本周 7 天：`date >= today` 不拉；已有日报计入 `skipped_existing`；其余为待拉
5. 待拉为空：不调领星，返回当前 week + suggestion，`filled=0`
6. 每个待拉日单独 `queryProductPerformanceAll({ startDate: day, endDate: day, asins: [asin] })`，`currency_code=USD`（现有 fetch 已带）
7. 映射到与每日填报相同的指标列（含 bsr；不写 `core_kw_rank`）
8. 有映射数字则 INSERT（派生 acos/tacos/ctr/cvr 与 upload 一致）；领星无该 ASIN 或全空计入 `missing_in_lingxing`
9. 某天失败：已写入的天保留；该请求返回错误状态（网关失败 502）及 `filled`（已成功天数），前端提示错误，不套建议

成功：

```json
{
  "filled": 2,
  "skipped_existing": 3,
  "missing_in_lingxing": 1,
  "week": {},
  "suggestion": {}
}
```

`week` / `suggestion` 形状与 GET 相同。

### 保存

不改 `POST /api/reviews/:id`。

## 错误与空态

| 情况 | 行为 |
|------|------|
| 打开详情 | 不调领星 |
| 未配网关 | 按钮可点，提示未配置，库与表单不动 |
| 网关失败 | 已补天数保留；提示原因；不套建议 |
| 某天领星无数据 | 不写该天；计入 missing |
| `COMPLETED` 拉取 | 400，不写库 |
| 0 天日报 | 本周表全缺填/未到；建议决策 CONTINUE，结论「本周暂无日报」 |
| 拉取中 | 按钮禁用 |
| 表单已有值 | 拉取成功也不覆盖 |

## 测试要点

- 纯函数：7 日窗口、已填/缺填/未到、花费合计、TACOS、日均单量、三条决策、空字段不覆盖
- GET：返回该周 7 天与冲刺对照；不写库、不调领星
- 拉取：只补已过缺天；已有行不变；写入后每日填报该日能读到
- 前端：空字段被建议填上；已填字段不变；COMPLETED 无按钮
- 花费 ≥ 额度 → STOPPED；TACOS+单量达标且未超额度 → MAINTENANCE
- 保存与项目状态同步与改造前一致

## 验收标准

1. 打开复盘不调领星；只展示该周 7 天已有日报和对照
2. 点拉取后只补「本周已过且无日报」的天，已填天不变；每日填报页能看到补上的数
3. 空着的亏损 / TACOS / 决策 / 结论被建议填上；人改过的不被覆盖
4. 花费 ≥ 额度 → `STOPPED`；TACOS 和单量都达标 → `MAINTENANCE`；否则 `CONTINUE`
5. `COMPLETED` 无拉取按钮，结论不变
6. 不拉关键词、广告活动、搜索词；不改每日填报提交、冲刺保存、复盘保存决策同步项目状态

## 风险

- 今日未过完，周五打开本周复盘时最多补周一到周四；周末两天为「未到」
- 领星按天串行最多数次调用，页面需等待；失败时部分天可能已写入
- 每日填报预填用 `previousCompleteDay`，周复盘补已过天用「当天=当天」，两边日期对齐以 `record_date` 为准
