# 数据采集模块合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Google Trends 与 ASIN 爬虫前后端合并为统一「数据采集」模块（单入口、单 API 前缀、单服务目录）。

**Architecture:** 新建 `service/data-collection/`：公共层放 `token-pool.js` / `searchapi.js`，ASIN 能力进 `asin/` 子目录，Trends 进 `trends.js`。Express 路由统一为 `/api/data-collection/*`。前端单页 `DataCollectionView` 三 Tab。旧路径与旧目录直接删除，无兼容层。

**Tech Stack:** Node.js / Express、Vue 3（现有 views 为 JS SFC 风格）、MySQL（表结构不变）、现有 SearchAPI 客户端。

**Spec:** `docs/superpowers/specs/2026-07-21-data-collection-merge-design.md`

## Global Constraints

- 不改 MySQL 表结构与字段
- 不改爬取、限速、缓存业务逻辑
- 不新增第三种采集能力
- 不做旧路径兼容（删除 `/api/asin-crawler/*`、`/api/google-trends`、`/asin-crawler`、`/google-trends`）
- Trends 缓存目录仍为 `data/google-trends/cache`（相对仓库根）
- 纯搬迁 + 入口合并；禁止顺手重构业务逻辑

## File Structure

| 路径 | 职责 |
|------|------|
| `service/data-collection/token-pool.js` | SearchAPI token 池（从 asin-crawler 迁入） |
| `service/data-collection/searchapi.js` | SearchAPI HTTP 客户端（迁入） |
| `service/data-collection/trends.js` | Google Trends 批量查询（原 google-trends.js） |
| `service/data-collection/asin/*` | ASIN 任务/缓存/导出/runner |
| `service/data-collection/index.js` | 对外 re-export（tokenPool、asin、trends） |
| `routes/page-api.js` | 注册 `/api/data-collection/*`，删除旧路由 |
| `server.js` | 从新路径 init runner |
| `frontend/src/views/DataCollectionView.js` | 三 Tab 合并页 |
| `frontend/src/router/index.js` | `/data-collection` |
| `frontend/src/components/AppSidebar.vue` | 单一「数据采集」入口 |

---

### Task 1: 迁入后端服务目录并修正 require

**Files:**
- Create: `service/data-collection/token-pool.js`（内容自 `service/asin-crawler/token-pool.js` 复制；`require('../../database')` 保持不变）
- Create: `service/data-collection/searchapi.js`（内容自 `service/asin-crawler/searchapi.js` 复制；无 database 依赖）
- Create: `service/data-collection/asin/flatten.js`（复制）
- Create: `service/data-collection/asin/column-labels.js`（复制）
- Create: `service/data-collection/asin/asin-cache.js`（复制后改 `require('../../../database')`）
- Create: `service/data-collection/asin/export.js`（复制后改 `require('../../../database')`，`./column-labels` 不变）
- Create: `service/data-collection/asin/job-runner.js`（复制后改 require，见下方）
- Create: `service/data-collection/asin/index.js`（复制后改 require，见下方）
- Create: `service/data-collection/trends.js`（自 `service/google-trends.js` 迁入并改 require）
- Create: `service/data-collection/index.js`
- Modify: `test/test-asin-crawler-flatten.js`、`test/test-asin-crawler-export.js`、`test/test-google-trends.js` 的 require 路径
- Do not delete old dirs yet（Task 2/3 切完引用后再删）

**Interfaces:**
- Produces:
  - `require('./service/data-collection/asin')` → `{ parseAsinInput, createJob, listJobs, getJob, listJobItems, getJobItemJson, cancelJob }`
  - `require('./service/data-collection/asin/job-runner')` → `{ initAsinCrawlerRunner, kickWorker, resumeStuckJobs }`（本 Task 保留原函数名，Task 2 可按需 alias）
  - `require('./service/data-collection/trends')` → `{ getGoogleTrends, getGoogleTrendsBatch, parseKeywords, BATCH_SIZE }`
  - `require('./service/data-collection/token-pool')` → 原 token-pool 全部导出

- [ ] **Step 1: 复制公共层与 asin 子模块文件到新目录**

在仓库根执行（PowerShell）：

```powershell
New-Item -ItemType Directory -Force -Path service/data-collection/asin | Out-Null
Copy-Item service/asin-crawler/token-pool.js service/data-collection/token-pool.js
Copy-Item service/asin-crawler/searchapi.js service/data-collection/searchapi.js
Copy-Item service/asin-crawler/flatten.js service/data-collection/asin/flatten.js
Copy-Item service/asin-crawler/column-labels.js service/data-collection/asin/column-labels.js
Copy-Item service/asin-crawler/asin-cache.js service/data-collection/asin/asin-cache.js
Copy-Item service/asin-crawler/export.js service/data-collection/asin/export.js
Copy-Item service/asin-crawler/job-runner.js service/data-collection/asin/job-runner.js
Copy-Item service/asin-crawler/index.js service/data-collection/asin/index.js
Copy-Item service/google-trends.js service/data-collection/trends.js
```

- [ ] **Step 2: 修正 `asin/` 内 database 与公共层 require**

`service/data-collection/asin/asin-cache.js` 顶部：

```js
const { queryOne, runSql } = require('../../../database');
```

`service/data-collection/asin/export.js` 顶部：

```js
const XLSX = require('xlsx');
const { queryAll } = require('../../../database');
const { buildColumnLabels } = require('./column-labels');
```

`service/data-collection/asin/index.js` 顶部：

```js
const { queryAll, queryOne, runSql } = require('../../../database');
const tokenPool = require('../token-pool');
const { kickWorker } = require('./job-runner');
```

`service/data-collection/asin/job-runner.js` 顶部：

```js
const tokenPool = require('../token-pool');
const { fetchAmazonProduct, isTokenExhaustedError, isRetryableError } = require('../searchapi');
const { flattenForCsv } = require('./flatten');
const asinCache = require('./asin-cache');
```

- [ ] **Step 3: 修正 `trends.js` 的 token/searchapi 与缓存根路径**

将文件顶部改为：

```js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const tokenPool = require('./token-pool');
const { fetchSearchApi, isTokenExhaustedError, isRetryableError } = require('./searchapi');

const CACHE_ROOT = path.join(__dirname, '../../data/google-trends/cache');
```

其余逻辑一字不改。`module.exports` 保持：

```js
module.exports = {
    getGoogleTrends,
    getGoogleTrendsBatch,
    parseKeywords,
    BATCH_SIZE
};
```

- [ ] **Step 4: 写 `service/data-collection/index.js`**

```js
module.exports = {
    tokenPool: require('./token-pool'),
    asin: require('./asin'),
    trends: require('./trends')
};
```

- [ ] **Step 5: 更新三个测试的 require 路径**

`test/test-asin-crawler-flatten.js`：

```js
const { flattenForCsv } = require('../service/data-collection/asin/flatten');
```

`test/test-asin-crawler-export.js`：

```js
const { buildExportFilename, buildWorkbook } = require('../service/data-collection/asin/export');
const { translateColumnHeader } = require('../service/data-collection/asin/column-labels');
```

`test/test-google-trends.js`：

```js
const { getGoogleTrendsBatch } = require('../service/data-collection/trends');
```

- [ ] **Step 6: 跑单测（不依赖 token 的 flatten/export；trends 若需网络可跳过或按现有习惯跑）**

```powershell
node test/test-asin-crawler-flatten.js
node test/test-asin-crawler-export.js
```

Expected: 两行均打印 `PASS`。

- [ ] **Step 7: Commit**

```powershell
git add service/data-collection test/test-asin-crawler-flatten.js test/test-asin-crawler-export.js test/test-google-trends.js
git commit -m "refactor: add data-collection service directory"
```

---

### Task 2: 切换 Express 路由与 server 启动入口

**Files:**
- Modify: `routes/page-api.js`（删除旧 google-trends / asin-crawler 块，注册新前缀）
- Modify: `server.js`（改 job-runner require 路径）
- Delete after切完: 暂不删旧 service（Task 4）

**Interfaces:**
- Consumes: Task 1 导出的 asin / trends / token-pool / job-runner
- Produces: 下表全部 HTTP 端点

| Method | Path |
|--------|------|
| GET/POST | `/api/data-collection/tokens` |
| POST | `/api/data-collection/tokens/:id/disable` |
| POST | `/api/data-collection/tokens/:id/reset` |
| POST | `/api/data-collection/asin/jobs` |
| GET | `/api/data-collection/asin/jobs` |
| GET | `/api/data-collection/asin/jobs/:id` |
| GET | `/api/data-collection/asin/jobs/:id/items` |
| GET | `/api/data-collection/asin/items/:id/json` |
| GET | `/api/data-collection/asin/jobs/:id/export.xlsx` |
| GET | `/api/data-collection/asin/jobs/:id/export.json` |
| POST | `/api/data-collection/asin/jobs/:id/cancel` |
| POST | `/api/data-collection/trends` |

- [ ] **Step 1: 改 `server.js` 的 runner 引入**

将：

```js
const {
    initAsinCrawlerRunner,
    resumeStuckJobs
} = require('./service/asin-crawler/job-runner');
```

改为：

```js
const {
    initAsinCrawlerRunner,
    resumeStuckJobs
} = require('./service/data-collection/asin/job-runner');
```

`initAsinCrawlerRunner({ queryOne, queryAll, runSql })` 与 `resumeStuckJobs()` 调用处不变。日志前缀可仍为 `[asin-crawler]`（允许，避免无意义 diff）。

- [ ] **Step 2: 在 `routes/page-api.js` 删除旧路由块**

删除：

1. `const { getGoogleTrendsBatch } = require('../service/google-trends');` 及其 `app.post('/api/google-trends', ...)`
2. 整段 `const asinCrawler = require('../service/asin-crawler');` 起至所有 `/api/asin-crawler/...` 路由（含 cancel）

- [ ] **Step 3: 注册新路由（放在原 asin 路由相近位置，`registerProtectedPageApi` 内）**

```js
const dataCollection = require('../service/data-collection');
const { exportJobToXlsx, exportJobToJson } = require('../service/data-collection/asin/export');
const tokenPool = dataCollection.tokenPool;
const asinCrawler = dataCollection.asin;
const { getGoogleTrendsBatch } = dataCollection.trends;

app.get('/api/data-collection/tokens', async (req, res) => {
    try {
        const tokens = await tokenPool.listTokens();
        const active_count = await tokenPool.countActiveTokens();
        res.json({ tokens, active_count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/data-collection/tokens', async (req, res) => {
    try {
        const body = req.body || {};
        const tokensText = body.tokens != null ? body.tokens : body.token;
        const added = await tokenPool.addTokens({
            tokensText,
            label: body.label
        });
        res.json({
            tokens: added,
            added_count: added.length,
            token: added.length === 1 ? added[0] : undefined
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/data-collection/tokens/:id/disable', async (req, res) => {
    try {
        const ok = await tokenPool.disableToken(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Token 不存在' });
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/data-collection/tokens/:id/reset', async (req, res) => {
    try {
        const ok = await tokenPool.resetToken(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Token 不存在' });
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/data-collection/asin/jobs', async (req, res) => {
    try {
        const { job, warnings } = await asinCrawler.createJob({
            asinsText: req.body.asins,
            amazonDomain: req.body.amazon_domain,
            createdBy: req.currentUser?.id
        });
        res.json({ job, warnings });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.get('/api/data-collection/asin/jobs', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit || 20), 100);
        const offset = Number(req.query.offset || 0);
        const jobs = await asinCrawler.listJobs({ limit, offset });
        res.json({ jobs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/data-collection/asin/jobs/:id', async (req, res) => {
    try {
        const job = await asinCrawler.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        res.json({ job });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/data-collection/asin/jobs/:id/items', async (req, res) => {
    try {
        const items = await asinCrawler.listJobItems(req.params.id);
        res.json({ items });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/data-collection/asin/items/:id/json', async (req, res) => {
    try {
        const item = await asinCrawler.getJobItemJson(req.params.id);
        if (!item) return res.status(404).json({ error: '记录不存在' });
        res.json({ item });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.get('/api/data-collection/asin/jobs/:id/export.xlsx', async (req, res) => {
    try {
        const job = await asinCrawler.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        const { buffer, filename } = await exportJobToXlsx(job.id);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/data-collection/asin/jobs/:id/export.json', async (req, res) => {
    try {
        const job = await asinCrawler.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        const { buffer, filename } = await exportJobToJson(job.id);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/data-collection/asin/jobs/:id/cancel', async (req, res) => {
    try {
        const job = await asinCrawler.cancelJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        res.json({ job });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/data-collection/trends', async (req, res) => {
    try {
        const { keywords, interval, geo, force_refresh: forceRefresh } = req.body || {};
        const data = await getGoogleTrendsBatch(keywords, { interval, geo, forceRefresh: Boolean(forceRefresh) });
        res.json(data);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});
```

- [ ] **Step 4: 冒烟检查模块可加载**

```powershell
node -e "require('./service/data-collection'); require('./service/data-collection/asin/job-runner'); console.log('ok')"
```

Expected: 打印 `ok`，无异常。

- [ ] **Step 5: Commit**

```powershell
git add routes/page-api.js server.js
git commit -m "refactor: point API and runner to data-collection"
```

---

### Task 3: 前端合并为「数据采集」单页

**Files:**
- Create: `frontend/src/views/DataCollectionView.js`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/components/AppSidebar.vue`
- Delete (本 Task 末或 Task 4)：`frontend/src/views/AsinCrawlerView.js`、`frontend/src/views/GoogleTrendsView.js`

**Interfaces:**
- Consumes: Task 2 全部新 API
- Produces: 路由 `name: 'data-collection'`，`meta.active: 'data_collection'`

- [ ] **Step 1: 新建 `DataCollectionView.js` 骨架**

以现有两页为源合并。关键约定：

```js
const API_BASE = '/api/data-collection';
const activeTab = ref('tokens'); // 'tokens' | 'asin' | 'trends'
```

页面 header：

```html
<div class="page-header">
  <h1>数据采集</h1>
  <p class="page-desc">SearchAPI · Token · ASIN 爬虫 · Google Trends</p>
</div>
```

Tab 切换 UI（与项目现有按钮风格一致即可，例如三个 button，active 加边框/背景）：

- Token
- ASIN 爬虫
- Google Trends

- [ ] **Step 2: 迁入 Token + ASIN 逻辑**

从 `AsinCrawlerView.js` 复制 setup 中 token/job 相关状态与方法；将所有：

- `'/api/asin-crawler/tokens...'` → `` `${API_BASE}/tokens...` ``
- `'/api/asin-crawler/jobs...'` → `` `${API_BASE}/asin/jobs...` ``
- `'/api/asin-crawler/items...'` → `` `${API_BASE}/asin/items...` ``

模板中：Token 管理区块放在 `v-if="activeTab === 'tokens'"`；原 ASIN 任务区块放在 `v-if="activeTab === 'asin'"`（Token 区块不再出现在 ASIN Tab）。

`onMounted`：仅当 `activeTab === 'asin'` 或需要展示 activeTokenCount 时加载；建议：

- 进入页面默认 `tokens`：`loadTokens()`
- 切到 `asin`：`loadData()`（tokens+jobs）并按需轮询
- 离开 asin Tab：`stopPolling()`

- [ ] **Step 3: 迁入 Google Trends 逻辑**

从 `GoogleTrendsView.js` 复制 sparkline/趋势分析辅助函数与 setup；将：

```js
await http.post('/api/google-trends', { ... })
```

改为：

```js
await http.post(`${API_BASE}/trends`, { ... })
```

模板放在 `v-if="activeTab === 'trends'"`。Trends Tab 不依赖 token 列表 UI（后端仍共用 token 池）。

- [ ] **Step 4: 改 router**

`frontend/src/router/index.js`：

删除：

```js
import GoogleTrendsView from '@/views/GoogleTrendsView.js';
import AsinCrawlerView from '@/views/AsinCrawlerView.js';
```

及对应两条 route。

新增：

```js
import DataCollectionView from '@/views/DataCollectionView.js';
```

```js
{ path: 'data-collection', name: 'data-collection', component: DataCollectionView, meta: { active: 'data_collection', title: '数据采集' } },
```

放置位置：原 google-trends / asin-crawler 附近（选品分析之后）。

- [ ] **Step 5: 改侧边栏**

`AppSidebar.vue` 将两行：

```html
<router-link to="/google-trends" ...>Google Trends</router-link>
<router-link to="/asin-crawler" ...>ASIN 爬虫</router-link>
```

替换为：

```html
<router-link to="/data-collection" :class="{ active: active === 'data_collection' }">数据采集</router-link>
```

- [ ] **Step 6: 删除旧前端页**

```powershell
Remove-Item frontend/src/views/AsinCrawlerView.js
Remove-Item frontend/src/views/GoogleTrendsView.js
```

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/views/DataCollectionView.js frontend/src/router/index.js frontend/src/components/AppSidebar.vue
git add -u frontend/src/views/AsinCrawlerView.js frontend/src/views/GoogleTrendsView.js
git commit -m "feat: merge ASIN crawler and Google Trends into data-collection page"
```

---

### Task 4: 删除旧后端并全量引用清扫

**Files:**
- Delete: `service/asin-crawler/` 整个目录
- Delete: `service/google-trends.js`
- Verify: 全仓库代码引用无残留

- [ ] **Step 1: 全局搜索残留引用**

```powershell
rg "asin-crawler|google-trends|GoogleTrendsView|AsinCrawlerView|/api/google-trends" --glob "!docs/**" --glob "!data/**"
```

Expected: 无业务代码命中（`docs/superpowers/**` 历史文档与 `data/google-trends/cache` 路径字符串可保留）。

若 `trends.js` 内缓存路径含 `google-trends` 属预期，忽略。

- [ ] **Step 2: 删除旧服务**

```powershell
Remove-Item -Recurse -Force service/asin-crawler
Remove-Item service/google-trends.js
```

- [ ] **Step 3: 再跑单测 + 模块加载**

```powershell
node test/test-asin-crawler-flatten.js
node test/test-asin-crawler-export.js
node -e "require('./service/data-collection'); console.log('ok')"
```

Expected: PASS / ok。

- [ ] **Step 4: Commit**

```powershell
git add -u service/asin-crawler service/google-trends.js
git commit -m "chore: remove legacy asin-crawler and google-trends paths"
```

---

### Task 5: 手工验收清单

- [ ] **Step 1: 启动应用，打开 `/data-collection`**

- 侧边栏仅「数据采集」，无 Google Trends / ASIN 爬虫分项
- 三 Tab 可切换

- [ ] **Step 2: Token Tab**

- 列表可见、可添加/禁用/重置（与合并前一致）

- [ ] **Step 3: ASIN Tab**

- 创建任务、轮询进度、导出 xlsx/json、预览 JSON、取消任务

- [ ] **Step 4: Trends Tab**

- 输入关键词查询，结果与合并前一致（缓存路径仍命中 `data/google-trends/cache`）

- [ ] **Step 5: 旧 URL**

- `/asin-crawler`、`/google-trends` 前端 404 或落入未匹配路由（可接受）
- `/api/asin-crawler/tokens`、`/api/google-trends` 返回 404（可接受）

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| 统一目录 + asin/trends 分子模块 | Task 1 |
| API `/api/data-collection/*` 映射（含 cancel） | Task 2 |
| server runner 切换 | Task 2 |
| 前端单页三 Tab + 侧边栏 | Task 3 |
| 删除旧路径/旧目录 | Task 2–4 |
| 表结构/缓存路径/业务逻辑不变 | Global Constraints + Task 1 Step 3 |
| 测试 require 更新 | Task 1 |
| 验收 | Task 5 |

## Placeholder scan

无 TBD/TODO；步骤含具体路径与代码块。
