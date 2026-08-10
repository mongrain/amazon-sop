# 数据采集切换 ScraperAPI 设计

日期：2026-08-10  
状态：已批准  
项目：sop-system

## 1. 背景与目标

「数据采集」模块（ASIN 爬虫 + Google Trends）当前全部依赖 SearchAPI.io（`service/data-collection/searchapi.js` + MySQL `searchapi_tokens`）。需改为 ScraperAPI：

- **ASIN**：使用 ScraperAPI Structured Amazon Product API 获取 JSON  
- **Google Trends**：通过 ScraperAPI 通用接口抓取 Trends 页面 HTML，再自研解析为现有前端可用的时序结构  
- **密钥**：继续使用现有 Token 池 UI，支持多 Key 轮换  

### 目标

- 运行时不再请求 `searchapi.io`  
- 对外 API 路径、任务模型、缓存与导出流程尽量不变  
- Token 池轮换 / 失效标记 / 重试语义保留，适配 ScraperAPI 错误形态  

### 非目标

- 不做 SearchAPI / ScraperAPI 双供应商开关  
- 不重做数据采集三 Tab 页面布局  
- 不变更 `asin_crawl_jobs` / `asin_crawl_items` / `asin_crawl_cache` 表结构  
- 本次不强制物理重命名 `searchapi_tokens` 表（避免无必要迁移）  
- 不处理未接入的遗留 `service/proxy-pool.js`（除非后续单独清理）

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 范围 | ASIN + Google Trends 全部切换 |
| ASIN 接入 | ScraperAPI `GET /structured/amazon/product` |
| Trends 接入 | ScraperAPI 抓 HTML + 自研解析 |
| 密钥管理 | 继续 Token 池多 Key 轮换 |
| 架构 | 替换供应商适配层，保留任务/缓存/导出骨架 |
| 表名 | 暂留 `searchapi_tokens`，UI/文案改为 ScraperAPI |

## 3. 架构

```
DataCollectionView / page-api
        │
        ├─ Token 池 (token-pool.js → searchapi_tokens)
        │
        ├─ ASIN job-runner
        │      └─ scraperapi.fetchAmazonProduct
        │             └─ /structured/amazon/product
        │
        └─ trends.getGoogleTrendsBatch
               └─ scraperapi.fetchGoogleTrendsHtml → parseTrendsHtml
                      └─ api.scraperapi.com?url=<trends>&...
```

### 文件职责（计划）

| 文件 | 职责 |
|------|------|
| `service/data-collection/scraperapi.js` | **新建**：HTTP 客户端、ASIN SDE、Trends URL 抓取、错误分类 |
| `service/data-collection/trends-parse.js` | **新建**：从 Trends HTML 解析 interest-over-time |
| `service/data-collection/amazon-map.js` | **新建（可选内联）**：SDE JSON → `{ product: ... }` 兼容映射 |
| `service/data-collection/searchapi.js` | **删除或改为薄 re-export 过渡后删除** |
| `service/data-collection/trends.js` | 改用 scraperapi；批大小默认 1；文案与 source 字段更新 |
| `service/data-collection/asin/job-runner.js` | require 改为 scraperapi；错误文案更新 |
| `service/data-collection/token-pool.js` | 逻辑可不变；注释/日志文案更新 |
| `frontend/.../DataCollectionView.js` | SearchAPI → ScraperAPI 文案 |
| `.env.example` | `SCRAPERAPI_*` 环境变量说明 |

## 4. ASIN：Structured Product

### 请求

```
GET https://api.scraperapi.com/structured/amazon/product
  ?api_key=<token>
  &asin=<ASIN>
  &tld=<tld>          # 由 amazon.com → com 等映射
  &country_code=<opt> # 可选，默认由 geo/站点推导或省略
```

超时：`SCRAPERAPI_TIMEOUT_MS`（默认 60000），兼容读取旧名 `SEARCHAPI_TIMEOUT_MS`。

### 响应映射

ScraperAPI 顶层字段（`name`, `feature_bullets`, `images`, `brand`, `product_information`, …）与现有 SearchAPI 的 `data.product.*` 不完全一致。

**约定：** `fetchAmazonProduct` 仍返回：

```js
{
  product: {
    // 映射后的兼容字段，供 flatten/export 使用
    ...
  },
  provider: 'scraperapi',
  raw: <原始 SDE JSON>   // 可选，便于排查；若体积过大可只存映射后 product
}
```

最小映射（实现时以实测字段为准，可增量补全）：

| ScraperAPI | 兼容目标（示意） |
|------------|------------------|
| `name` | `product.title` / `product.name` |
| `feature_bullets` | `product.feature_bullets` |
| `images` | `product.images` / `product.main_image` |
| `brand` | `product.brand` |
| `product_information` | `product.product_information` |
| `product_category` | `product.categories` 或字符串字段 |

`job-runner` 仍将整包 JSON 写入 `raw_json`，`flattenForCsv` 继续通用扁平化——**不要求列集合与 SearchAPI 时代完全一致**，但核心标题/卖点/图片应尽量有值。

### 域名 → tld

现有 `amazonDomain`（如 `amazon.com`）映射为 ScraperAPI `tld`（如 `com`）。无法识别时默认 `com`。

## 5. Google Trends：HTML + 解析

### 请求

拼装公开 Trends 查询 URL（示例，实现以实测为准）：

```
https://trends.google.com/trends/api/widgetdata/multiline?...
```

或先拉 explore 页再取 widget；优先路径：

1. 使用 ScraperAPI 通用入口：  
   `GET https://api.scraperapi.com?api_key=...&url=<encoded Trends URL>&render=true`  
   （`render` / `premium` 等参数以联调结果为准，写入 env 可配置）  
2. `trends-parse.js` 从 HTML 或嵌入 JSON（常见为 `trends.google.com` 返回的 `)]}'` JSON / `widgets` 数据）提取 timeseries  
3. 映射为现有结构：

```js
{
  date, time, formattedTime, searches, value, formattedValue, empty: false
}
```

### 批处理

- 默认 **每次 1 个关键词**（`GOOGLE_TRENDS_BATCH_SIZE` 默认改为 `1`）  
- 多关键词循环 + 现有限速 / 文件缓存保留  
- 缓存命中逻辑不变；`source` 字段改为 `scraperapi`

### 失败与降级

- 解析失败：抛明确错误（「Trends HTML 未解析到时序数据」）  
- 若存在过期缓存：沿用现有「失败返回过期缓存」行为  
- Token 耗尽：`markTokenExhausted` 后换下一 Key

## 6. Token 池与错误分类

复用 `token-pool.js`：

| 场景 | 行为 |
|------|------|
| HTTP 401/403 | 视为 Key 无效/耗尽 → `markTokenExhausted` |
| body 含 `credit` / `quota` / `limit` / `concurrency` 等 | 耗尽或记失败（实现时对照 ScraperAPI 文档细化） |
| 5xx / 超时 / 网络错误 | `isRetryableError` → `recordTokenFailure` 后重试 |
| 业务解析失败（非供应商侧） | 不标记 token 耗尽，直接失败或走缓存降级 |

UI / 用户可见文案：

- 「SearchAPI Token」→「ScraperAPI Key」  
- 页面副标题 `SearchAPI · Token · ...` → `ScraperAPI · Token · ...`  
- API 错误信息中的 SearchAPI 字样同步替换  

## 7. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SCRAPERAPI_TIMEOUT_MS` | 60000 | 兼容 `SEARCHAPI_TIMEOUT_MS` |
| `SCRAPERAPI_REQUEST_INTERVAL_MS` | 500 | ASIN 限速；兼容旧名 |
| `SCRAPERAPI_MAX_ASINS_PER_JOB` | 100 | 兼容旧名 |
| `SCRAPERAPI_RENDER` | `true` | Trends 抓取是否 render（联调可改） |
| `GOOGLE_TRENDS_*` | 保留 | geo/hl/tz/cache；`BATCH_SIZE` 默认 1 |

`.env.example` 注释改为 ScraperAPI 说明。

## 8. 迁移与兼容

1. 代码切换后，旧 SearchAPI token 若仍填在池中，只要是合法 ScraperAPI Key 即可继续用；非法 Key 会在调用时被标记耗尽。  
2. 不自动清空 `searchapi_tokens`。  
3. 历史 ASIN `raw_json`（SearchAPI 形态）保留只读；新任务写入 ScraperAPI 映射后结构。  
4. Trends 文件缓存 key 可继续按 keyword/interval/geo；切换供应商后不强制清缓存（可选启动时忽略旧 `source=searchapi` 缓存，默认：**不强制清除**，靠 TTL）。

## 9. 测试建议

- 单元：`amazon-map` 字段映射；`trends-parse` 用固定 HTML fixture  
- 集成（可选 live）：真实 Key 拉一个 ASIN、一个 Trends 关键词  
- 回归：`test-asin-crawler-flatten.js` / `export` 仍通过；`require('./service/data-collection')` 可加载  
- 确认仓库无残留 `searchapi.io` 运行时 URL

## 10. 实现顺序（概要）

1. 实现 `scraperapi.js` + Amazon 映射 + 错误分类  
2. 接线 `job-runner`，去掉 SearchAPI ASIN 路径  
3. 实现 `trends-parse` + 改 `trends.js`（批大小 1）  
4. 更新前端文案与 `.env.example`  
5. 删除 `searchapi.js`（或确认无引用后删除）  
6. 自检与文档状态更新为已批准/已实现
