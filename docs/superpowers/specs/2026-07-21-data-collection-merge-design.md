# 数据采集模块合并（Google Trends + ASIN 爬虫）

日期：2026-07-21  
状态：已批准  
项目：sop-system

---

## 1. 背景与目标

Google Trends 与 ASIN 爬虫均基于 SearchAPI，已共用 `token-pool` / `searchapi`，但前端入口、路由前缀与服务目录仍分离，维护成本高。

**目标：** 前后端合并为统一「数据采集」模块：一个侧边栏入口、一套 API 前缀、一个服务目录。

**非目标：**

- 不改 MySQL 表结构与字段
- 不改爬取、限速、缓存业务逻辑
- 不新增第三种采集能力
- 不做旧路径兼容层（按已确认决策直接替换）

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 合并范围 | 前后端一起合并 |
| 对外名称 | 数据采集 |
| 页面形态 | 单页三 Tab：Token / ASIN 爬虫 / Google Trends |
| 旧路径 | 直接删除，无跳转、无代理 |
| 架构 | 统一目录 + 按能力分子模块 |

---

## 3. 架构与目录

```
service/data-collection/
  ├── index.js              # 模块对外导出
  ├── token-pool.js         # 从 asin-crawler 迁入
  ├── searchapi.js          # 从 asin-crawler 迁入
  ├── trends.js             # 原 google-trends.js 迁入并改 require
  └── asin/
      ├── index.js          # 原 asin-crawler/index.js
      ├── job-runner.js
      ├── asin-cache.js
      ├── flatten.js
      ├── export.js
      └── column-labels.js
```

**前端：**

- 新页：`DataCollectionView`，路由 `/data-collection`
- 删除：`AsinCrawlerView`、`GoogleTrendsView` 及侧边栏旧入口
- 侧边栏仅保留：「数据采集」

**不变：**

- 表名：`searchapi_tokens`、`asin_crawl_jobs`、`asin_crawl_items`、`asin_crawl_cache` 等
- Trends 文件缓存目录：`data/google-trends/cache`

---

## 4. API 映射

旧路径全部删除。新前缀：`/api/data-collection`

| 能力 | 新路径 |
|------|--------|
| Token 列表 | `GET /api/data-collection/tokens` |
| Token 添加 | `POST /api/data-collection/tokens` |
| Token 禁用 | `POST /api/data-collection/tokens/:id/disable` |
| Token 重置 | `POST /api/data-collection/tokens/:id/reset` |
| ASIN 建任务 | `POST /api/data-collection/asin/jobs` |
| ASIN 任务列表 | `GET /api/data-collection/asin/jobs` |
| ASIN 任务详情 | `GET /api/data-collection/asin/jobs/:id` |
| ASIN 任务 items | `GET /api/data-collection/asin/jobs/:id/items` |
| ASIN item JSON | `GET /api/data-collection/asin/items/:id/json` |
| ASIN 导出 xlsx | `GET /api/data-collection/asin/jobs/:id/export.xlsx` |
| ASIN 导出 json | `GET /api/data-collection/asin/jobs/:id/export.json` |
| Google Trends | `POST /api/data-collection/trends` |

删除：

- `/api/asin-crawler/*`
- `/api/google-trends`
- 前端 `/asin-crawler`、`/google-trends`

---

## 5. 启动入口与测试

**`server.js`：** runner 从 `service/data-collection/asin/job-runner` 引入（可重命名为 `initDataCollectionRunner`，语义等价）。

**测试：**

- `test/test-google-trends.js` → require `service/data-collection/trends`
- `test/test-asin-crawler-*.js` → require 新 `asin/` 路径
- 行为断言不变

**前端：** Tab 逻辑复用现有两页；API 使用统一常量前缀；Token Tab 从原 ASIN 页抽出共用。

---

## 6. 迁移步骤

1. 新建 `service/data-collection/`，迁入公共层 + `asin/` + `trends.js`，改内部 require
2. 改 `routes/page-api.js`、`server.js`；删除旧 API
3. 新建 `DataCollectionView`，改 router / 侧边栏；删除旧两页
4. 更新测试 require；跑相关测试
5. 删除 `service/asin-crawler/`、`service/google-trends.js`
6. 历史 ASIN design/plan 文档保留不改；以本文为合并权威规格

---

## 7. 风险与验收

| 风险 | 对策 |
|------|------|
| require 漏改导致启动失败 | 全局搜 `asin-crawler` / `google-trends` 清零（代码引用） |
| 前端漏改 API 前缀 | 合并页内统一 `API_BASE` |
| 误改表名/缓存路径 | 明确不在范围内 |
| 混入逻辑变更 | 纯搬迁 + 入口合并 |

**验收：**

- 侧边栏只有「数据采集」
- Token / ASIN / Trends 三 Tab 功能与合并前一致
- 旧前端路由与旧 API 返回 404（可接受）

---

## 8. 影响文件（预期）

- 新建：`service/data-collection/**`、`frontend/src/views/DataCollectionView.js`
- 修改：`routes/page-api.js`、`server.js`、`frontend/src/router/index.js`、`frontend/src/components/AppSidebar.vue`、相关 test
- 删除：`service/asin-crawler/**`、`service/google-trends.js`、`AsinCrawlerView.js`、`GoogleTrendsView.js`
