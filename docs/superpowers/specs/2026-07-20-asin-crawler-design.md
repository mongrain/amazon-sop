# ASIN 爬虫（SearchAPI）

日期：2026-07-20  
状态：已确认设计，待实现

## 背景

需要新增 ASIN 爬虫功能，底层调用 SearchAPI.io 的 Amazon Product API（`https://www.searchapi.io/api/v1/search?engine=amazon_product&asin=...`）。用户会提供一批 API token，这些 token 会失效/过期，需要 token 池管理与自动轮换。爬取结果支持导出 CSV。

## 目标

1. 前端页面：粘贴 ASIN 列表（每行一个）→ 创建异步爬取任务 → 轮询进度 → 下载 CSV
2. 前端 Token 管理：增删、查看可用/失效状态、禁用、重置
3. Token 自动轮换：失效时标记并切换下一个 token 继续爬取
4. CSV 全量扁平化导出：能解析到的字段都进 CSV，复杂嵌套转 JSON 字符串
5. 数据持久化到 MySQL，与现有 SOP 系统统一

## 非目标

- 不支持上传 txt/csv 文件导入 ASIN（仅文本框粘贴）
- 不提供 CLI 脚本入口（V1 仅 Web）
- 不支持 token 自动恢复（失效后需手动重置或添加新 token）
- V1 不做失败任务的「一键重跑」（补充 token 后需新建任务）
- 不引入 Redis / 独立 Worker 进程

## 决策摘要

| 项 | 选择 |
|----|------|
| 使用方式 | 后端 API + 前端页面 |
| ASIN 输入 | 文本框粘贴，每行一个 |
| CSV 字段 | 全量扁平化 |
| Token 管理 | 前端页面维护，持久化 MySQL |
| 任务执行 | 异步任务 + 前端轮询进度 |
| 持久化 | MySQL（tokens / jobs / items） |
| 架构 | 方案 1：进程内队列（参考 `operating-days-queue.js`） |

## 整体架构

```
前端 AsinCrawlerView
  ├─ Token 管理（增删 / 查看可用·失效）
  ├─ 粘贴 ASIN → 创建任务
  ├─ 轮询任务进度
  └─ 下载 CSV
        │
        ▼
Express API (/api/asin-crawler/*)
        │
        ▼
service/asin-crawler/
  ├─ token-pool.js     # 取用、标记失效、轮换
  ├─ searchapi.js      # 调 SearchAPI amazon_product
  ├─ job-runner.js     # 进程内队列，限速串行爬取
  └─ csv-export.js     # 全量扁平化导出
        │
        ▼
MySQL
  ├─ searchapi_tokens
  ├─ asin_crawl_jobs
  └─ asin_crawl_items
```

**数据流**：提交 ASIN 列表 → 写入 job + items（pending）→ runner 取可用 token 调 API → 成功写 raw_json + flat_json；token 失效则标记并换下一个 → 全部完成后可导出 CSV。

## 数据库表结构

### `searchapi_tokens`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | 主键 |
| token | VARCHAR(255) NOT NULL | API Key |
| label | VARCHAR(100) NULL | 可选备注 |
| status | ENUM('active','exhausted','disabled') | 状态 |
| last_used_at | DATETIME NULL | 最后使用时间 |
| fail_count | INT DEFAULT 0 | 连续失败次数 |
| last_error | VARCHAR(500) NULL | 最近错误信息 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

索引：`status`, `last_used_at`

### `asin_crawl_jobs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | 主键 |
| status | ENUM('pending','running','completed','failed','cancelled') | 任务状态 |
| amazon_domain | VARCHAR(50) DEFAULT 'amazon.com' | Amazon 站点 |
| total_count | INT DEFAULT 0 | 总 ASIN 数 |
| success_count | INT DEFAULT 0 | 成功数 |
| fail_count | INT DEFAULT 0 | 失败数 |
| created_by | INT NULL | 创建用户 ID（FK users.id） |
| error_message | VARCHAR(1000) NULL | 任务级错误 |
| created_at | DATETIME | 创建时间 |
| started_at | DATETIME NULL | 开始时间 |
| finished_at | DATETIME NULL | 完成时间 |

索引：`status`, `created_at`

### `asin_crawl_items`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | 主键 |
| job_id | INT NOT NULL | FK asin_crawl_jobs.id ON DELETE CASCADE |
| asin | VARCHAR(10) NOT NULL | ASIN |
| status | ENUM('pending','processing','success','failed') | 单条状态 |
| raw_json | JSON NULL | SearchAPI 完整响应 |
| flat_json | JSON NULL | 扁平化字段（供 CSV 导出） |
| error_message | VARCHAR(500) NULL | 失败原因 |
| token_id | INT NULL | 使用的 token ID |
| created_at | DATETIME | 创建时间 |
| finished_at | DATETIME NULL | 完成时间 |

索引：`job_id`, `(job_id, status)`, `asin`

## Token 策略

1. **取用**：优先选 `status='active'` 且 `last_used_at` 最久未用的 token（轮询）
2. **失效判定**：HTTP 401/403，或响应 body 含 quota/credits exhausted 关键词 → 标记 `exhausted`
3. **临时失败**：网络超时等 → `fail_count++`，连续 3 次才标记 `exhausted`
4. **自动切换**：当前 token 失效后立即换下一个 active token 重试同一 ASIN（最多遍历所有 active token 各一次）
5. **全部失效**：job 标记 `failed`，error_message 提示补充 token；pending items 保留
6. **手动管理**：前端可添加 token、禁用（`disabled`）、重置为 `active`（清空 fail_count 和 last_error）

## API 接口

### Token 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/asin-crawler/tokens` | 列表（脱敏 token、status、fail_count、last_used_at、label） |
| POST | `/api/asin-crawler/tokens` | 添加 `{ token, label? }` |
| POST | `/api/asin-crawler/tokens/:id/disable` | 手动禁用 |
| POST | `/api/asin-crawler/tokens/:id/reset` | 重置为 active，清空 fail_count |

Token 脱敏规则：保留前 4 位 + `****` + 后 4 位，不足 8 位则全 `****`。

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/asin-crawler/jobs` | 创建 `{ asins: string, amazon_domain? }` |
| GET | `/api/asin-crawler/jobs` | 历史任务列表（分页，默认最近 20 条） |
| GET | `/api/asin-crawler/jobs/:id` | 任务详情 + 进度 |
| GET | `/api/asin-crawler/jobs/:id/items` | 单条结果列表 |
| GET | `/api/asin-crawler/jobs/:id/export.csv` | 下载 CSV |
| POST | `/api/asin-crawler/jobs/:id/cancel` | 取消未完成任务 |

创建任务后返回 `{ job }`，后台 runner 自动 `kickWorker()`。

### 输入校验

- ASIN：10 位字母数字，自动去重、转大写；无效行跳过并在响应中返回 `warnings`
- 单次任务上限：500 个 ASIN（`SEARCHAPI_MAX_ASINS_PER_JOB` 可配置）
- 至少 1 个 `active` token 才允许创建任务

## 前端页面

路由 `/asin-crawler`，侧边栏新增「ASIN 爬虫」入口（`meta.active = 'asin_crawler'`）。

### Token 管理区

- 表格：备注、脱敏 token、状态、失败次数、最后使用时间
- 操作：添加 token（弹窗/表单）、禁用、重置
- 顶部提示当前可用 token 数量

### 爬取任务区

- 文本框粘贴 ASIN（每行一个）
- 站点选择（默认 `amazon.com`）
- 「开始爬取」按钮
- 当前任务进度条 + 成功/失败/待处理计数
- 历史任务列表（状态、创建时间、操作：查看详情 / 下载 CSV / 取消）
- 失败项可展开查看 error_message

轮询：参考 `AiOfficeView`，每 3–4 秒拉取任务状态；任务进入终态（completed/failed/cancelled）后停止轮询。

## CSV 扁平化规则

对 SearchAPI 返回 JSON 递归扁平化：

1. **标量**（string/number/boolean/null）→ 列名用 `.` 连接路径，如 `product.title`、`product.buybox.price.value`
2. **数组**
   - 元素全是标量 → `|` 拼接，如 `product.feature_bullets`
   - 元素含对象 → 整段 JSON 字符串一列，如 `product.variants`
3. **对象** → 继续递归，不单独占列
4. **顶层元数据**一并导出：`search_metadata.*`、`search_parameters.*`
5. **导出策略**
   - 所有 success items 合并为宽表
   - 列名取并集，缺值留空
   - 额外列 `_crawl_asin`（请求 ASIN）
   - UTF-8 + BOM，Excel 友好
6. **预计算**：爬取成功时写入 `flat_json`，导出时直接读取

## 错误处理

| 场景 | 处理 |
|------|------|
| ASIN 格式无效 | 创建时校验，跳过并 warnings |
| 单 ASIN 无 product | item `failed`，继续下一个 |
| Token 401/403/quota | token `exhausted`，换 token 重试 |
| 网络超时 | 重试 2 次（间隔 3s），仍失败 item `failed` |
| 全部 token 失效 | job `failed`，提示补充 token |
| 请求限速 | 全局间隔默认 2s（`SEARCHAPI_REQUEST_INTERVAL_MS`） |
| 服务重启 | `processing` items → `pending`；`running` jobs → `pending`；启动后 `kickWorker()` |

## Service 模块

### `service/asin-crawler/token-pool.js`

- `listTokens()`, `addToken()`, `disableToken()`, `resetToken()`
- `acquireToken()` — 取 active 且最久未用
- `markTokenExhausted(id, error)`, `recordTokenFailure(id, error)`
- `countActiveTokens()`

### `service/asin-crawler/searchapi.js`

- `fetchAmazonProduct({ asin, amazonDomain, apiKey })`
- 使用 axios GET `https://www.searchapi.io/api/v1/search`
- 参数：`engine=amazon_product`, `asin`, `amazon_domain`, `api_key`
- 超时：`SEARCHAPI_TIMEOUT_MS`（默认 60000）

### `service/asin-crawler/flatten.js`

- `flattenForCsv(obj)` → 扁平 key-value 对象

### `service/asin-crawler/csv-export.js`

- `exportJobToCsv(jobId)` → CSV 字符串（含 BOM）

### `service/asin-crawler/job-runner.js`

- 参考 `operating-days-queue.js`：`kickWorker()`, `runWorkerLoop()`, `claimNextItem()`
- 限速：`IntervalRateLimiter(SEARCHAPI_REQUEST_INTERVAL_MS)`
- 启动恢复：`resumeStuckJobs()` 在 server 启动时调用

### `service/asin-crawler/index.js`

- 对外导出 service 函数，供 routes 调用

## 环境变量（`.env.example` 补充）

```
SEARCHAPI_REQUEST_INTERVAL_MS=2000
SEARCHAPI_TIMEOUT_MS=60000
SEARCHAPI_MAX_ASINS_PER_JOB=500
```

## 文件清单

| 文件 | 操作 |
|------|------|
| `init.sql` | 新增 3 张表 |
| `service/asin-crawler/token-pool.js` | 新增 |
| `service/asin-crawler/searchapi.js` | 新增 |
| `service/asin-crawler/flatten.js` | 新增 |
| `service/asin-crawler/csv-export.js` | 新增 |
| `service/asin-crawler/job-runner.js` | 新增 |
| `service/asin-crawler/index.js` | 新增 |
| `routes/page-api.js` | 注册 API 路由 |
| `server.js` | 启动时 init runner + resume |
| `frontend/src/views/AsinCrawlerView.js` | 新增 |
| `frontend/src/router/index.js` | 新增路由 |
| `frontend/src/components/AppSidebar.vue` | 新增导航 |
| `.env.example` | 补充配置项 |

## 测试计划

1. Token CRUD：添加、列表脱敏、禁用、重置
2. 创建任务：有效 ASIN、无效 ASIN 警告、无 token 拒绝
3. 单 ASIN 爬取成功：raw_json / flat_json 写入，job 进度更新
4. Token 失效轮换：模拟 401，验证 exhausted + 切换
5. CSV 导出：列并集、BOM、嵌套 JSON 字符串
6. 服务重启恢复：processing 重置后继续
