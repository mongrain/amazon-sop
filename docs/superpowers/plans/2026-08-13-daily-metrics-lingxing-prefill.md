# 每日填报回填 + 领星预填 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日填报按日期回填已录入并可改；「从领星拉取」只预填未录入冲刺行；冲刺 ASIN「查询」空字段回填 FBA / 7日 CTR / 7日 CVR。

**Architecture:** 纯函数映射与合并放 `service/lingxing-metrics.js`；yanjun MCP 最小客户端放 `service/yanjun-mcp.js`（injectable fetch）。页面 API 调这两层，不写库直到用户提交。前端只打本系统登录接口。

**Tech Stack:** Node + Express + Vue 3；测试用现有 `node test/*.js` + `assert`；不新增 npm 依赖。

## Global Constraints

- 不新建对外第三方写入接口；不加入 `PUBLIC_ROUTES`
- 金额请求 `currency_code=USD`
- 核心词排名、BSR 不拉
- 已有 `daily_asin_metrics` 记录的 ASIN 不拉、不覆盖
- 领星预填只填表不写库
- 冲刺查询只填空的 `fba_warehouse_qty` / `ctr_7d` / `cvr_7d`（`0` 视为已填）
- yanjun URL 仅服务端 `YANJUN_MCP_URL`，不进前端
- 不改 `/api/v1/metrics/upload`、周复盘、诊断公式
- 不引入领星官方 SDK

## File Structure

- Create: `service/lingxing-metrics.js` — 字段映射、跳过已录入、7日窗口、空字段判定、百分数转换
- Create: `service/yanjun-mcp.js` — initialize + tools/call
- Create: `test/test-lingxing-metrics.js`
- Create: `test/test-yanjun-mcp.js`
- Modify: `routes/page-api.js` — GET `/api/metrics/manual`、POST `/api/metrics/manual/lingxing-prefill`、GET `/api/sprints/lingxing-lookup`
- Modify: `frontend/src/views/MetricsManualView.js`
- Modify: `frontend/src/views/SprintFormView.js`
- Modify: `.env.example`

---

### Task 1: 映射与合并纯函数

**Files:**
- Create: `service/lingxing-metrics.js`
- Test: `test/test-lingxing-metrics.js`

**Interfaces:**
- Produces:
  - `METRIC_KEYS` = `['sessions','orders','impressions','clicks','ad_spend','ad_sales','total_sales','ad_orders']`
  - `pickNumeric(row, keys)` → `number|null`
  - `mapPerformanceRow(row)` → `{ asin, ...metrics }` 不含 rank
  - `asinsToPrefill(sprintAsins, existingAsins)` → 未录入 ASIN（大小写不敏感）
  - `rowHasAnyMetric(row)` → boolean
  - `mergePrefillIntoRows(rows, prefillRows)` → 新 rows；已有任意指标的行不覆盖
  - `last7CompleteDays(todayYmd)` → `{ start_date, end_date }` 昨天往前 7 天
  - `isEmptyField(v)` → 空 / 空白为 true；`0` 为 false
  - `fillEmptySprintFields(form, lookup)` → 只填空的三字段
  - `toFormPercent(raw)` → 表单百分数；`null` 若无效。规则：绝对值 `> 1` 视为已是百分数；`<= 1` 视为比率 ×100（实现时若真实领星响应相反再改测试）
  - `sumFbaQty(items)` → 对 `afn_fulfillable_quantity` / `fulfillable_quantity` / `quantity` 求和

- [ ] **Step 1–4:** 写 `test/test-lingxing-metrics.js`（先红后绿），覆盖：映射优先字段、跳过已录入、merge 不覆盖已有数字、7日窗口、空字段、`0` 不覆盖、百分数。
- [ ] **Step 5:** `node test/test-lingxing-metrics.js` 期望打印 `ok`
- [ ] **Step 6:** Commit `feat: 领星预填字段映射与合并`

---

### Task 2: yanjun MCP 客户端

**Files:**
- Create: `service/yanjun-mcp.js`
- Test: `test/test-yanjun-mcp.js`

**Interfaces:**
- Consumes: `YANJUN_MCP_URL`
- Produces: `callYanjunTool(toolName, args, { fetchImpl, url } = {})` → 解析 `result.content` JSON 或 `result.structuredContent`
- 未配 URL：throw `{ status: 400, message: '未配置领星网关' }`
- 协议：POST JSON-RPC `initialize`（记下 `mcp-session-id`）→ `notifications/initialized` → `tools/call`；Accept `application/json, text/event-stream`；SSE 时解析 `data:` 行

- [ ] **Step 1–4:** mock fetch 测未配置 / initialize+call / 502
- [ ] **Step 5:** Commit `feat: yanjun MCP 最小客户端`

---

### Task 3: 每日填报 API + 前端

**Files:**
- Modify: `routes/page-api.js`（`GET /api/metrics/manual` 起）
- Modify: `frontend/src/views/MetricsManualView.js`
- Modify: `.env.example`

**Interfaces:**
- `GET /api/metrics/manual?date=` → `{ current_date, rows }`，rows 含冲刺 id/asin + 该日指标，无 `prefill`
- `POST /api/metrics/manual/lingxing-prefill` `{ date }` → 跳过已有 metrics；调 `lingxing_query_product_performance_asin_lists`；`currency_code=USD`；不写库
- 前端：换日期重新加载；「从领星拉取」合并空行；按钮禁用

- [ ] **Step 1:** 实现 API 与页面
- [ ] **Step 2:** `node test/test-lingxing-metrics.js` 仍 ok
- [ ] **Step 3:** Commit `feat: 每日填报回填已录入并支持领星预填`

---

### Task 4: 冲刺查询 FBA/CTR/CVR

**Files:**
- Modify: `routes/page-api.js`
- Modify: `frontend/src/views/SprintFormView.js`

**Interfaces:**
- `GET /api/sprints/lingxing-lookup?asin=` → `{ asin, fba_warehouse_qty, ctr_7d, cvr_7d }` 缺项 `null`
- CTR/CVR：产品表现 `last7CompleteDays` + `toFormPercent`
- FBA：Listing 按 ASIN 的可售数量求和，没有再试 `lingxing_query_fba_valid_list`
- 前端 `queryAsin`：`Promise.allSettled` 产品库 + 领星；只填空三字段；一边失败不影响另一边

- [ ] **Step 1:** 实现 lookup + 查询并行
- [ ] **Step 2:** `node test/test-lingxing-metrics.js` 仍 ok
- [ ] **Step 3:** Commit `feat: 冲刺查询回填空的FBA与七日CTR/CVR`
