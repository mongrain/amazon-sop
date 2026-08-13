# 每日填报：回填已录入 + 领星预填

日期：2026-08-13  
状态：已确认设计，待实现

## 背景

每日数据填报目前只预填冲刺 ASIN，不带回当天已录入的数字；换日期也不会加载历史。运营需要改已填内容，并用 yanjun 网关内置领星把未填的冲刺行拉进表格，核对后再提交。

## 目标

1. 打开或更换填报日期时，自动加载该日已录入内容，允许修改后再次提交
2. 页面增加「从领星拉取」：只预填表格，不写库
3. 只拉当前冲刺（`ACTIVE` / `MAINTENANCE`）ASIN；该日库里已有记录的 ASIN 不拉、不覆盖
4. 金额用站点原币（请求领星 `currency_code=USD`，不转人民币）
5. 核心词排名、BSR 不拉，留空手填

## 非目标

- 不新建对外第三方写入接口
- 不接广告商品报告、关键词排名、BSR
- 不改冲刺、周复盘、规则诊断、提交入库逻辑
- 不把 yanjun token 暴露给浏览器
- 不自动提交

## 决策摘要

| 项 | 选择 |
|----|------|
| 领星入口 | 页面按钮，服务端调 yanjun MCP 产品表现 |
| ASIN 范围 | 仅冲刺 ACTIVE / MAINTENANCE |
| 已录入 | `daily_asin_metrics` 存在该 ASIN+日期则跳过 |
| 拉取落地 | 只填表，用户改完再点提交 |
| 金额 | `currency_code=USD` |
| 对外 API | 不做 |

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

## 配置

`.env.example` 增加：

```
# yanjun MCP 网关（每日填报从领星预填）。填完整 URL，含鉴权参数
YANJUN_MCP_URL=
```

实现用最小 MCP 客户端调用 `lingxing_query_product_performance_asin_lists`（initialize + tools/call），不引入领星官方 SDK，不在 sop-system 再配领星 AppId。

## 错误与空态

| 情况 | 行为 |
|------|------|
| 未配网关 | 按钮可点，提示未配置，表格不动 |
| 网关失败 | 提示原因，表格不动 |
| 当天冲刺都已录入 | `filled=0`，提示都已填过，未拉取 |
| 部分字段对不上 | 该列空，其它列照填 |
| 拉取中 | 按钮禁用 |

## 测试要点

- 有已录入记录：打开/换日期能看到原值，改后提交覆盖
- 无记录：冲刺 ASIN 空行
- 领星预填：跳过已有记录；只改空行；不写库直到提交
- 前端已有数字的行，第二次拉取不覆盖
- 未配 `YANJUN_MCP_URL` 返回 400
- 提交路径与诊断触发与改造前一致
