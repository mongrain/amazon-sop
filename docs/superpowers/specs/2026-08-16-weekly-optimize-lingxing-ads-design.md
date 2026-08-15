# 周复盘结论：领星冲刺广告可执行优化

日期：2026-08-16  
状态：已确认设计，待实现

## 背景

现有「生成优化方案」只把本周日报汇总交给 GPT，结论只能写「控花费 / 冲曝光」。冲刺广告在领星里有固定命名，yanjun 能查活动、关键词、搜索词及环比。复盘页同时有「复盘结论」和「优化建议」两块，生成后还不入库。

## 目标

1. 页面只保留「复盘结论」；结论内容就是针对该 ASIN 冲刺广告的可执行优化
2. 点「生成优化方案」用 yanjun 拉本周 **已启用、名称含 `{ASIN}-冲刺`** 的活动及其关键词/搜索词（含环比），裁样后调 GPT，覆盖结论并立刻入库
3. 结论要点名真实活动/词：换打法、变差词处理、高转化加码

## 非目标

- 不改决策规则（CONTINUE / MAINTENANCE / STOPPED）
- 不改周复盘领星补缺天、对照可视化、每日填报 TACOS、冲刺保存
- 不在领星里暂停、改价、上传广告（只出文字）
- 不把 yanjun / GPT token 暴露给浏览器
- `COMPLETED` 不生成
- 不打开页自动生成，不在「从领星拉取」日报后自动生成
- 不复用整店 `diagnose_yesterday_ads`

## 决策摘要

| 项 | 选择 |
|----|------|
| 页面 | 删独立「优化建议」模块；结论 = 优化正文 |
| 触发 | 按钮「生成优化方案」 |
| 覆盖 | 有字再生成也覆盖 |
| 入库 | 生成成功立刻写 `summary` 与 `optimization_plan`（同一段） |
| 广告范围 | 已启用 + 名称包含 `{ASIN}-冲刺` |
| 报表 | 活动 + 关键词 + 搜索词，含环比 |
| GPT | 先裁「高花费 / 环比变差 / 高转化」再生成 |

## 架构

```text
点「生成优化方案」
  → POST /api/reviews/:id/optimize-plan
  → COMPLETED / 未配网关或 GPT / 找不到广告店 → 400，不写库
  → yanjun：
       ad_auth_shops → 50宴君北美 US profile_id
       活动报告（本周、asin、enabled）→ 名称含 `{ASIN}-冲刺`
       这些 campaign_id 的关键词报告（with_ring）
       这些 campaign_id + asin 的搜索词报告（with_ring）
  → 裁样 → chatCompletionText
  → UPDATE summary + optimization_plan
  → 前端覆盖结论框，提示「已生成并保存」
```

yanjun 仍走现有 `callYanjunTool`；浏览器只打本系统接口。

## 报表

### 窗口

复盘 `week_start_date` 周一到 +6 天周日。若窗口含今天，结束日用昨天。

`report_date` 格式：`YYYY-MM-DD - YYYY-MM-DD`。

### 店铺

`lingxing_ad_auth_shops` 解析与现有 `LINGXING_SID_50_US`（`17438`）对应的北美 US `profile_id`。找不到 → 400，结论不动。

### 活动

`lingxing_ad_campaign_report`：

- `report_date`、`profile_ids`
- `asin` = 该复盘 ASIN
- `state` = enabled（或返回后再滤启用）
- 名称（campaign name）包含 `{ASIN}-冲刺`，ASIN 不区分大小写
- 匹配活动按花费降序最多 8 条，记下 `campaign_id`

### 关键词 / 搜索词

- `lingxing_ad_campaign_keyword_report`：上述 `campaign_id`，`with_ring = 1`，按花费降序，一页约 50
- `lingxing_ad_campaign_search_term_report`：同一批活动 + `asin`，`with_ring = true`，按花费降序，一页约 50

关键词接口无 ASIN 字段时，只用 `campaign_id` 限定（活动已按 ASIN 与命名滤过）。

字段用现有 `pickNumeric` 风格别名取值（`spends`/`spend`、`sales`、`orders`、`acos`、`cvr`、`ctr`、`campaign_name`/`name`、`keyword_text`/`query` 及环比字段）。实现时按实返回补别名，不把整页原始 JSON 塞进 GPT。

## 裁样

去重后交给 GPT：

| 桶 | 规则 | 上限 |
|----|------|------|
| 高花费 | 花费最高 | 活动 5 / 词 8 / 搜索词 8 |
| 环比变差 | ACOS 升、CVR 降、订单掉，或花费升销售额掉 | 词 8 / 搜索词 8 |
| 高转化可加码 | 有订单且 ACOS 相对低或 CVR 相对高 | 词 5 / 搜索词 5 |

每条只留：名称或搜索词、活动名、匹配方式、花费、销售额、订单、ACOS、CVR、CTR、环比（有则带）。

无匹配活动：三类皆空，仍调 GPT，结论写明未找到「`{ASIN}-冲刺`」已启用广告，不编名字。

## GPT

替换 `OPTIMIZE_SYSTEM_PROMPT`：

- 只根据 JSON 写下一周可执行动作
- 必须点名 JSON 里出现的活动名 / 投放词 / 搜索词
- 覆盖：换打法（自动↔手动、广泛↔精确）、变差词降出价或暂停/否定、高转化词加预算或出价
- 中文分条，每条以 `-` 开头，带一句依据
- 不要改写 CONTINUE / MAINTENANCE / STOPPED
- 不要编造未出现的名字；缺数据写依据不足

用户 JSON 含：ASIN、sprint_goal、目标/风控、本周日报汇总、规则建议决策、裁切后的 `campaigns` / `keywords` / `search_terms`。

仍用 `chatCompletionText`。`generateOptimizePlan` 改为可注入 `chatFn` 与广告包；去掉「已有文本则 skip、不调模型」。

## 页面与保存

- 删除独立「优化建议」模块与 `form.optimization_plan` 展示
- 「复盘结论记录」必填；PENDING 显示「生成优化方案」，生成中禁用
- 生成成功覆盖 `form.summary`，提示「已生成并保存」
- `POST /api/reviews/:id/optimize-plan` **写库**：只 UPDATE `summary`、`optimization_plan`、`updated_at`；不改决策、亏损、TACOS、status、项目状态
- `POST /api/reviews/:id` 仍要求结论非空；保存时 `optimization_plan` 与 `summary` 同步为同一段（避免两列分叉）
- `COMPLETED`：无按钮；接口 400 `已完成的复盘不能生成优化方案`

## 错误

| 情况 | 行为 |
|------|------|
| 复盘不存在 | 404 |
| COMPLETED | 400，不调领星/GPT，不写库 |
| 未配 `YANJUN_MCP_URL` / `GPT_API_URL` | 400，结论不动 |
| 广告店解析失败 | 400，结论不动 |
| 领星报表失败 | 502，结论不动 |
| 无匹配冲刺广告 | 仍 GPT，空列表，结论入库 |
| GPT 失败或空 | 502，结论不动 |

## 测试要点

- 名称过滤：`B0XX-冲刺` 命中；`B0XX-维护`、未启用冲刺名不命中
- 裁样上限与去重
- 无匹配活动：仍调 GPT，广告数组为空
- 有字再生成：覆盖并写库（假 chat + 假写库）
- COMPLETED：不调领星、不调 GPT

## 验收标准

1. 页面只有一块结论；生成后立刻能再打开看到同一段文字
2. 有匹配冲刺广告时，结论能点名活动或词，而不是空泛「控花费」
3. 无匹配广告时结论说明找不到，不编造
4. 决策规则、补缺天、对照卡片、每日 TACOS 不变

## 风险

- 广告报表比产品表现慢，窗口用到昨天
- 领星环比字段名需按实返回映射
- `profile_id` 与 sid `17438` 的对应依赖授权列表，列表结构变化会 400
- 生成比现在慢，按钮需禁用并提示生成中
