# 每日填报回填 + 领星预填；冲刺查询回填 FBA/CTR/CVR

日期：2026-08-13  
状态：已确认设计，待实现

## 背景

每日数据填报目前只预填冲刺 ASIN，不带回当天已录入的数字；换日期也不会加载历史。运营需要改已填内容，并用 yanjun 网关内置领星把未填的冲刺行拉进表格，核对后再提交。

新建/编辑冲刺广告时，ASIN「查询」目前只回填产品库财务字段；FBA 仓库数量、7日日均 CTR、7日日均 CVR 仍手填。这三项也改为点「查询」时从领星带出（空字段才填）。

## 目标

1. 打开或更换填报日期时，自动加载该日已录入内容，允许修改后再次提交
2. 页面增加「从领星拉取」：只预填表格，不写库
3. 只拉当前冲刺（`ACTIVE` / `MAINTENANCE`）ASIN；该日库里已有记录的 ASIN 不拉、不覆盖
4. 金额用站点原币（请求领星 `currency_code=USD`，不转人民币）
5. 核心词排名、BSR 不拉，留空手填
6. 冲刺表单现有「查询」同时调 yanjun：回填空着的 FBA 仓库数量、7日日均 CTR(%)、7日日均 CVR(%)

## 非目标

- 不新建对外第三方写入接口
- 不接广告商品报告、关键词排名、BSR
- 不改周复盘、规则诊断、每日填报提交入库逻辑
- 不改冲刺保存字段与计算公式（所需曝光/点击/预算/库存天数仍走现有 watch）
- 不把 yanjun token 暴露给浏览器
- 不自动提交
- 查询不覆盖已有数字的 FBA / CTR / CVR

## 决策摘要

| 项 | 选择 |
|----|------|
| 每日填报领星入口 | 页面「从领星拉取」，服务端调 yanjun 产品表现 |
| ASIN 范围 | 仅冲刺 ACTIVE / MAINTENANCE |
| 已录入 | `daily_asin_metrics` 存在该 ASIN+日期则跳过 |
| 拉取落地 | 只填表，用户改完再点提交 |
| 金额 | `currency_code=USD` |
| 对外 API | 不做 |
| 冲刺领星入口 | 扩展现有 ASIN「查询」 |
| 冲刺回填 | 仅空字段：`fba_warehouse_qty`、`ctr_7d`、`cvr_7d` |

## 架构

```text
打开 / 换日期
  → GET /api/metrics/manual?date=YYYY-MM-DD
  → 冲刺 ASIN + 当天 daily_asin_metrics
  → 表格可改

点「从领星拉取」
  → POST /api/metrics/manual/lingxing-prefill  { date }
  → 跳过当天库里已有记录的 ASIN
  → 服务端调 yanjun：lingxing_query_product_performance_asin_lists
  → 只回填表格，不写库

点「提交」
  → 现有 POST /api/v1/metrics/upload（ASIN+日期覆盖）

冲刺 ASIN「查询」
  → 现有 GET /api/product/:asin（财务，行为不变）
  → 并行 GET /api/sprints/lingxing-lookup?asin=
  → 仅当 fba_warehouse_qty / ctr_7d / cvr_7d 为空时写入
  → 现有 watch 重算所需曝光/点击/预算/库存天数
```

yanjun 网关 URL 只放服务端环境变量 `YANJUN_MCP_URL`（含鉴权查询参数）。前端只打本系统登录接口。

## 页面

仍用 `/metrics/manual`，标题「每日数据填报」。

### 加载

- 默认日期为今天；`date` 输入变化即重新请求
- 表格行 = 冲刺 ASIN（有则带冲刺 id）左连该日指标
- 已录入字段回填为可编辑输入；未录入为空
- 换日期未提交的改动丢弃

### 从领星拉取

- 按钮放在日期/提交同一行
- 请求进行中禁用按钮
- 合并规则：
  1. 库中该日已有记录的 ASIN：不动
  2. 当前表格该行已有任意指标数字（含刚拉过未提交）：不动
  3. 其余冲刺行：写入领星映射到的字段；领星没有的列保持空
- 提示：`已预填 N 行，跳过已录入 M 行，领星无数据 K 行`
- 核心词排名、BSR 始终不写

### 提交

- 现有提交按钮与 `/api/v1/metrics/upload`
- 再提交同一 ASIN+日期 = 覆盖更新

## 字段映射

请求领星产品表现：`start_date = end_date = 填报日期`，`currency_code = USD`，`search_field = asin`，`search_value = 待预填 ASIN 列表`，按页取完。

| 表格字段 | 领星返回（按顺序取第一个有限数字） |
|---|---|
| sessions | sessions, session, visits, session_count |
| orders | order_num, orders, volume, order_count |
| impressions | impressions, ad_impressions |
| clicks | clicks, ad_clicks |
| ad_spend | ad_cost, ad_spend, spend |
| ad_sales | ad_sales, ad_sale_amount, ad_sales_amount |
| total_sales | sales_amount, sales, total_sales |
| ad_orders | ad_order_num, ad_orders, ad_order_count |
| core_kw_rank | 不映射 |
| bsr_rank | 不映射 |

对不上的列留空，不估算、不拿别的指标顶替。实现时以一次真实产品表现响应校准字段名，映射表可按实返回收。

## 接口

均需登录，不加入 `PUBLIC_ROUTES`。

### GET `/api/metrics/manual`

Query：`date` 可选，`YYYY-MM-DD`，缺省今天。非法日期 400。

响应：

```json
{
  "current_date": "2026-08-12",
  "rows": [
    {
      "id": 12,
      "asin": "B0XXXXXXXX",
      "sessions": 100,
      "orders": 3,
      "impressions": null,
      "clicks": null,
      "ad_spend": 12.5,
      "ad_sales": 80,
      "total_sales": 120,
      "ad_orders": 2,
      "core_kw_rank": null,
      "bsr_rank": null
    }
  ]
}
```

`id` 为冲刺项目 id；指标缺省为 `null`。无冲刺时 `rows` 为空数组（前端仍可手动加行）。

兼容：不再返回仅含 `id/asin` 的 `prefill`；前端改为使用 `rows`。

### POST `/api/metrics/manual/lingxing-prefill`

Body：`{ "date": "YYYY-MM-DD" }`，必填且合法。

服务端：

1. 列出冲刺 ASIN
2. 查出该日已有 `daily_asin_metrics` 的 ASIN，记入 `skipped_existing`
3. 剩余 ASIN 调 yanjun 产品表现
4. 领星未返回的记入 `missing_in_lingxing`
5. 不写 `daily_asin_metrics`

未配置 `YANJUN_MCP_URL`：400，`未配置领星网关`。  
网关失败/超时：502，表格由前端保持原样。

成功响应：

```json
{
  "date": "2026-08-12",
  "rows": [{ "asin": "B0XXXXXXXX", "sessions": 100, "orders": 3 }],
  "filled": 1,
  "skipped_existing": 2,
  "missing_in_lingxing": 0
}
```

`rows` 只含本次可预填的 ASIN；字段只包含映射到的数字，不含 core_kw_rank / bsr_rank。

### 提交

不改 `POST /api/v1/metrics/upload`。

## 冲刺表单查询

新建与编辑都可用「查询」。财务回填仍走 `GET /api/product/:asin`，失败时不清空已有财务值（现有行为）。

领星三项与产品库查询互相独立：一边失败不影响另一边。

### 空字段才填

前端判定「空」：`undefined` / `null` / `''` / 仅空白。已有数字（含 `0`）不覆盖。

| 表单字段 | 来源 | 写入后 |
|---|---|---|
| `fba_warehouse_qty` | 领星该 ASIN 的 FBA 可售/在库数量合计 | 触发库存可支撑天数重算 |
| `ctr_7d` | 近 7 日产品表现 CTR，写成百分数（与输入框一致，`0.3` = 0.3%） | 触发所需曝光/点击重算 |
| `cvr_7d` | 近 7 日产品表现 CVR，同样写成百分数 | 同上 |

不拉 CPC、所需曝光、日均单量、排名。

### 领星取数

- **单日窗口**：开始日 = 结束日 = 昨天；`currency_code=USD`；`search_field=asin`。
- **CTR/CVR**：产品表现返回的 ctr/cvr，写入表单百分数，与领星后台展示一致（`0.3` = 0.3%）。实现时对照一次真实响应决定是否 ×100，禁止猜。对不上则该字段不写。
- **FBA**：优先 Listing（按 ASIN）的 FBA 可售数量（如 `afn_fulfillable_quantity`）多仓/多店铺相加；Listing 没有再查 FBA 库存/补货建议。对不上则不写。

实现时以一次真实响应校准字段名。

### GET `/api/sprints/lingxing-lookup`

Query：`asin` 必填。需登录。

```json
{
  "asin": "B0XXXXXXXX",
  "fba_warehouse_qty": 120,
  "ctr_7d": 0.42,
  "cvr_7d": 8.5
}
```

缺的项为 `null`。未配网关 400；网关失败 502。不写 `sprint_projects`。

## 配置

`.env.example` 增加：

```
# yanjun MCP 网关（每日填报预填、冲刺查询 FBA/CTR/CVR）。填完整 URL，含鉴权参数
YANJUN_MCP_URL=
```

实现用最小 MCP 客户端（initialize + tools/call）调用领星工具，不引入领星官方 SDK，不在 sop-system 再配领星 AppId。每日填报用 `lingxing_query_product_performance_asin_lists`；冲刺查询另用 Listing/FBA 库存取数量。

## 错误与空态

| 情况 | 行为 |
|------|------|
| 未配网关 | 按钮可点，提示未配置，表格不动 |
| 网关失败 | 提示原因，表格不动 |
| 当天冲刺都已录入 | `filled=0`，提示都已填过，未拉取 |
| 部分字段对不上 | 该列空，其它列照填 |
| 拉取中 | 按钮禁用 |
| 冲刺查询领星失败 | 财务仍可回填；FBA/CTR/CVR 保持原值并提示领星失败 |
| 冲刺三项已有数 | 不覆盖；产品库财务仍按现有规则回填 |

## 测试要点

- 有已录入记录：打开/换日期能看到原值，改后提交覆盖
- 无记录：冲刺 ASIN 空行
- 领星预填：跳过已有记录；只改空行；不写库直到提交
- 前端已有数字的行，第二次拉取不覆盖
- 未配 `YANJUN_MCP_URL` 返回 400
- 提交路径与诊断触发与改造前一致
- 新建冲刺：查询后空的 FBA/CTR/CVR 被填上；所需曝光随 CTR/CVR 重算
- 编辑冲刺：已有 FBA/CTR/CVR 不被覆盖
- 产品库查无与领星失败互不影响
