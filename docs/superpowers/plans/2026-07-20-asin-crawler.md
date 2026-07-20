# ASIN 爬虫（SearchAPI）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 ASIN 爬虫：前端粘贴 ASIN、SearchAPI token 池管理、异步爬取、全量扁平化 CSV 导出。

**Architecture:** 进程内 worker（参考 `operating-days-queue.js`）消费 MySQL 中的 job/items；`token-pool.js` 负责 token 轮换；`flatten.js` + `csv-export.js` 负责 CSV；Express API + Vue 页面。

**Tech Stack:** Node.js Express, MySQL (Sequelize raw SQL), axios, Vue 3

**Spec:** `docs/superpowers/specs/2026-07-20-asin-crawler-design.md`

## Global Constraints

- V1 仅 Web，不支持文件上传 ASIN、不支持 CLI
- Token 前端维护，持久化 MySQL；失效需手动重置或新增
- V1 不做失败任务一键重跑
- 不引入 Redis / 独立 Worker / 新 npm 依赖
- ASIN：10 位字母数字；单次任务上限 `SEARCHAPI_MAX_ASINS_PER_JOB=500`
- 请求间隔默认 `SEARCHAPI_REQUEST_INTERVAL_MS=2000`；超时 `SEARCHAPI_TIMEOUT_MS=60000`
- 回复用户用中文；未经用户要求不 git commit

---

## File Map

| 文件 | 职责 |
|------|------|
| `init.sql` | 3 张新表 DDL |
| `database.js` | initDb 内 migration 创建 3 表 |
| `service/asin-crawler/flatten.js` | JSON 递归扁平化 |
| `service/asin-crawler/token-pool.js` | token CRUD + acquire/mark |
| `service/asin-crawler/searchapi.js` | SearchAPI HTTP 客户端 |
| `service/asin-crawler/csv-export.js` | job → CSV 字符串 |
| `service/asin-crawler/job-runner.js` | 异步 worker + resume |
| `service/asin-crawler/index.js` | jobs service + 对外导出 |
| `routes/page-api.js` | REST API |
| `server.js` | init runner + resume |
| `frontend/src/views/AsinCrawlerView.js` | 页面 |
| `frontend/src/router/index.js` | 路由 |
| `frontend/src/components/AppSidebar.vue` | 导航 |
| `.env.example` | 环境变量 |
| `test/test-asin-crawler-flatten.js` | 扁平化单测 |
| `test/test-asin-crawler-csv.js` | CSV 导出单测 |

---

### Task 1: 数据库表

**Files:**
- Modify: `init.sql`（末尾 seed 之前追加 DDL）
- Modify: `database.js`（`initDb` 内追加 migration，参考现有 `CREATE TABLE IF NOT EXISTS` 块）

**Produces:** 表 `searchapi_tokens`、`asin_crawl_jobs`、`asin_crawl_items`

- [ ] **Step 1: 在 `init.sql` 追加 DDL**

在 `-- 初始化数据：12个模块` 注释块之前插入：

```sql
-- SearchAPI Token 池
CREATE TABLE IF NOT EXISTS searchapi_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    label VARCHAR(100) DEFAULT NULL,
    status ENUM('active','exhausted','disabled') NOT NULL DEFAULT 'active',
    last_used_at DATETIME DEFAULT NULL,
    fail_count INT NOT NULL DEFAULT 0,
    last_error VARCHAR(500) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_last_used (last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ASIN 爬取任务
CREATE TABLE IF NOT EXISTS asin_crawl_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    amazon_domain VARCHAR(50) NOT NULL DEFAULT 'amazon.com',
    total_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    fail_count INT NOT NULL DEFAULT 0,
    created_by INT DEFAULT NULL,
    error_message VARCHAR(1000) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME DEFAULT NULL,
    finished_at DATETIME DEFAULT NULL,
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ASIN 爬取明细
CREATE TABLE IF NOT EXISTS asin_crawl_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    asin VARCHAR(10) NOT NULL,
    status ENUM('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
    raw_json JSON DEFAULT NULL,
    flat_json JSON DEFAULT NULL,
    error_message VARCHAR(500) DEFAULT NULL,
    token_id INT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME DEFAULT NULL,
    INDEX idx_job (job_id),
    INDEX idx_job_status (job_id, status),
    INDEX idx_asin (asin),
    FOREIGN KEY (job_id) REFERENCES asin_crawl_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (token_id) REFERENCES searchapi_tokens(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: 在 `database.js` 的 `initDb` 末尾（AI Office seed 之前）追加相同 3 段 `CREATE TABLE IF NOT EXISTS`**

- [ ] **Step 3: 验证**

Run: `node -e "require('./database').initDb().then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `ok`（或表已存在时同样成功）

---

### Task 2: flatten.js

**Files:**
- Create: `service/asin-crawler/flatten.js`
- Create: `test/test-asin-crawler-flatten.js`

**Produces:**
- `flattenForCsv(obj: object): Record<string, string|number|boolean|null>`

- [ ] **Step 1: 写失败测试**

`test/test-asin-crawler-flatten.js`:

```javascript
const assert = require('assert');
const { flattenForCsv } = require('../service/asin-crawler/flatten');

const sample = {
    search_metadata: { status: 'Success', total_time_taken: 4.3 },
    product: {
        asin: 'B0CGCMS31N',
        title: 'Test Product',
        rating: 4.5,
        feature_bullets: ['bullet one', 'bullet two'],
        attributes: [{ name: 'Brand', value: 'OtterBox' }],
        buybox: { price: { value: 23.56, currency: 'USD' } }
    }
};

const flat = flattenForCsv(sample);

assert.strictEqual(flat['product.asin'], 'B0CGCMS31N');
assert.strictEqual(flat['product.title'], 'Test Product');
assert.strictEqual(flat['product.rating'], 4.5);
assert.strictEqual(flat['product.buybox.price.value'], 23.56);
assert.strictEqual(flat['product.feature_bullets'], 'bullet one|bullet two');
assert.ok(typeof flat['product.attributes'] === 'string');
assert.ok(flat['product.attributes'].includes('OtterBox'));
assert.strictEqual(flat['search_metadata.status'], 'Success');

console.log('test-asin-crawler-flatten: PASS');
```

- [ ] **Step 2: 运行确认失败**

Run: `node test/test-asin-crawler-flatten.js`
Expected: `Cannot find module '../service/asin-crawler/flatten'`

- [ ] **Step 3: 实现 `service/asin-crawler/flatten.js`**

```javascript
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function flattenForCsv(obj) {
    const out = {};

    function walk(value, prefix) {
        if (isScalar(value)) {
            out[prefix] = value;
            return;
        }
        if (Array.isArray(value)) {
            if (!value.length) {
                out[prefix] = '';
                return;
            }
            if (value.every(isScalar)) {
                out[prefix] = value.map(v => (v == null ? '' : String(v))).join('|');
                return;
            }
            out[prefix] = JSON.stringify(value);
            return;
        }
        if (isPlainObject(value)) {
            const keys = Object.keys(value);
            if (!keys.length) {
                out[prefix] = '';
                return;
            }
            for (const key of keys) {
                const next = prefix ? `${prefix}.${key}` : key;
                walk(value[key], next);
            }
        }
    }

    if (isPlainObject(obj)) {
        for (const key of Object.keys(obj)) {
            walk(obj[key], key);
        }
    }
    return out;
}

module.exports = { flattenForCsv };
```

- [ ] **Step 4: 运行确认通过**

Run: `node test/test-asin-crawler-flatten.js`
Expected: `test-asin-crawler-flatten: PASS`

---

### Task 3: token-pool.js

**Files:**
- Create: `service/asin-crawler/token-pool.js`

**Consumes:** `database.js` 的 `queryAll`, `queryOne`, `runSql`

**Produces:**
- `maskToken(token: string): string`
- `listTokens(): Promise<object[]>`
- `addToken({ token, label }): Promise<object>`
- `disableToken(id): Promise<boolean>`
- `resetToken(id): Promise<boolean>`
- `countActiveTokens(): Promise<number>`
- `acquireToken(): Promise<{ id, token }|null>`
- `markTokenExhausted(id, error): Promise<void>`
- `recordTokenFailure(id, error): Promise<void>`
- `touchTokenUsed(id): Promise<void>`

- [ ] **Step 1: 实现 token-pool.js**

```javascript
const { queryAll, queryOne, runSql } = require('../../database');

function maskToken(token) {
    const text = String(token || '').trim();
    if (text.length <= 8) return '****';
    return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function mapTokenRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        token_masked: maskToken(row.token),
        label: row.label || '',
        status: row.status,
        fail_count: row.fail_count,
        last_used_at: row.last_used_at,
        last_error: row.last_error,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function listTokens() {
    const rows = await queryAll(
        'SELECT * FROM searchapi_tokens ORDER BY id DESC'
    );
    return rows.map(mapTokenRow);
}

async function addToken({ token, label }) {
    const text = String(token || '').trim();
    if (!text) throw new Error('token 不能为空');
    const result = await runSql(
        `INSERT INTO searchapi_tokens (token, label, status) VALUES (?, ?, 'active')`,
        [text, label ? String(label).trim() : null]
    );
    const row = await queryOne('SELECT * FROM searchapi_tokens WHERE id = ?', [result.insertId]);
    return mapTokenRow(row);
}

async function disableToken(id) {
    const result = await runSql(
        `UPDATE searchapi_tokens SET status = 'disabled', updated_at = NOW() WHERE id = ?`,
        [Number(id)]
    );
    return Boolean(result.affectedRows);
}

async function resetToken(id) {
    const result = await runSql(
        `UPDATE searchapi_tokens
         SET status = 'active', fail_count = 0, last_error = NULL, updated_at = NOW()
         WHERE id = ?`,
        [Number(id)]
    );
    return Boolean(result.affectedRows);
}

async function countActiveTokens() {
    const row = await queryOne(
        `SELECT COUNT(*) AS cnt FROM searchapi_tokens WHERE status = 'active'`
    );
    return Number(row?.cnt || 0);
}

async function acquireToken() {
    const row = await queryOne(
        `SELECT id, token FROM searchapi_tokens
         WHERE status = 'active'
         ORDER BY (last_used_at IS NULL) DESC, last_used_at ASC, id ASC
         LIMIT 1`
    );
    return row ? { id: row.id, token: row.token } : null;
}

async function touchTokenUsed(id) {
    await runSql(
        `UPDATE searchapi_tokens SET last_used_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [Number(id)]
    );
}

async function markTokenExhausted(id, error) {
    const message = String(error || '').slice(0, 500);
    await runSql(
        `UPDATE searchapi_tokens
         SET status = 'exhausted', last_error = ?, updated_at = NOW()
         WHERE id = ?`,
        [message, Number(id)]
    );
}

async function recordTokenFailure(id, error) {
    const message = String(error || '').slice(0, 500);
    await runSql(
        `UPDATE searchapi_tokens
         SET fail_count = fail_count + 1,
             last_error = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [message, Number(id)]
    );
    const row = await queryOne('SELECT fail_count FROM searchapi_tokens WHERE id = ?', [Number(id)]);
    if (Number(row?.fail_count || 0) >= 3) {
        await markTokenExhausted(id, message);
    }
}

module.exports = {
    maskToken,
    listTokens,
    addToken,
    disableToken,
    resetToken,
    countActiveTokens,
    acquireToken,
    markTokenExhausted,
    recordTokenFailure,
    touchTokenUsed
};
```

- [ ] **Step 2: 手动冒烟（需 DB）**

启动服务后 POST `/api/asin-crawler/tokens` 或在 node REPL 调用 `addToken` / `listTokens`（Task 6 路由就绪后验证）

---

### Task 4: searchapi.js

**Files:**
- Create: `service/asin-crawler/searchapi.js`

**Produces:**
- `fetchAmazonProduct({ asin, amazonDomain, apiKey }): Promise<object>`
- `isTokenExhaustedError(error): boolean`
- `isRetryableError(error): boolean`

- [ ] **Step 1: 实现 searchapi.js**

```javascript
const axios = require('axios');

const SEARCHAPI_URL = 'https://www.searchapi.io/api/v1/search';
const TIMEOUT_MS = Number(process.env.SEARCHAPI_TIMEOUT_MS || 60000);
const EXHAUSTED_KEYWORDS = ['quota', 'credit', 'exhausted', 'insufficient', 'limit reached'];

function isTokenExhaustedError(error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) return true;
    const bodyText = JSON.stringify(error?.response?.data || '').toLowerCase();
    return EXHAUSTED_KEYWORDS.some(k => bodyText.includes(k));
}

function isRetryableError(error) {
    if (isTokenExhaustedError(error)) return false;
    const status = error?.response?.status;
    if (status && status >= 500) return true;
    const code = error?.code;
    return ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(code);
}

async function fetchAmazonProduct({ asin, amazonDomain = 'amazon.com', apiKey }) {
    const response = await axios.get(SEARCHAPI_URL, {
        params: {
            engine: 'amazon_product',
            asin: String(asin || '').trim().toUpperCase(),
            amazon_domain: amazonDomain || 'amazon.com',
            api_key: apiKey
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true
    });

    if (response.status >= 400) {
        const err = new Error(`SearchAPI HTTP ${response.status}`);
        err.response = response;
        throw err;
    }

    const data = response.data || {};
    if (!data.product) {
        const err = new Error('SearchAPI 未返回 product 数据');
        err.response = response;
        throw err;
    }
    return data;
}

module.exports = {
    fetchAmazonProduct,
    isTokenExhaustedError,
    isRetryableError
};
```

---

### Task 5: csv-export.js

**Files:**
- Create: `service/asin-crawler/csv-export.js`
- Create: `test/test-asin-crawler-csv.js`

**Consumes:** `flattenForCsv`, `queryAll`

**Produces:** `exportJobToCsv(jobId): Promise<string>`

- [ ] **Step 1: 写 CSV 测试（mock queryAll 或纯函数测试 escapeCsv）**

先实现并测试 `escapeCsvField` + `rowsToCsv` 纯函数；`exportJobToCsv` 依赖 DB 在集成时验证。

`test/test-asin-crawler-csv.js`:

```javascript
const assert = require('assert');
const { escapeCsvField, rowsToCsv } = require('../service/asin-crawler/csv-export');

assert.strictEqual(escapeCsvField('a,b'), '"a,b"');
assert.strictEqual(escapeCsvField('plain'), 'plain');
const csv = rowsToCsv(['_crawl_asin', 'product.title'], [
    { _crawl_asin: 'B0TEST1234', 'product.title': 'Hello, World' }
]);
assert.ok(csv.startsWith('\uFEFF'));
assert.ok(csv.includes('Hello, World'));

console.log('test-asin-crawler-csv: PASS');
```

- [ ] **Step 2: 实现 csv-export.js**

```javascript
const { queryAll } = require('../../database');

function escapeCsvField(value) {
    if (value == null) return '';
    const text = String(value);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function rowsToCsv(columns, rows) {
    const header = columns.map(escapeCsvField).join(',');
    const lines = rows.map(row => columns.map(col => escapeCsvField(row[col])).join(','));
    return `\uFEFF${[header, ...lines].join('\n')}`;
}

async function exportJobToCsv(jobId) {
    const items = await queryAll(
        `SELECT asin, flat_json FROM asin_crawl_items
         WHERE job_id = ? AND status = 'success' AND flat_json IS NOT NULL
         ORDER BY id ASC`,
        [Number(jobId)]
    );
    if (!items.length) {
        return rowsToCsv(['_crawl_asin'], []);
    }

    const rows = items.map(item => {
        const flat = typeof item.flat_json === 'string'
            ? JSON.parse(item.flat_json)
            : (item.flat_json || {});
        return { _crawl_asin: item.asin, ...flat };
    });

    const columnSet = new Set(['_crawl_asin']);
    for (const row of rows) {
        Object.keys(row).forEach(k => columnSet.add(k));
    }
    const columns = [...columnSet].sort((a, b) => {
        if (a === '_crawl_asin') return -1;
        if (b === '_crawl_asin') return 1;
        return a.localeCompare(b);
    });
    return rowsToCsv(columns, rows);
}

module.exports = { escapeCsvField, rowsToCsv, exportJobToCsv };
```

- [ ] **Step 3: 运行测试**

Run: `node test/test-asin-crawler-csv.js`
Expected: `test-asin-crawler-csv: PASS`

---

### Task 6: job-runner.js

**Files:**
- Create: `service/asin-crawler/job-runner.js`

**Consumes:** token-pool, searchapi, flattenForCsv, db ctx

**Produces:**
- `initAsinCrawlerRunner(ctx)`
- `kickWorker()`
- `resumeStuckJobs(): Promise<void>`

- [ ] **Step 1: 实现 job-runner.js（核心逻辑）**

要点：
- `IntervalRateLimiter` 复制自 `operating-days-queue.js`
- `claimNextItem()`：`SELECT ... WHERE status='pending' ORDER BY id LIMIT 1` + optimistic `UPDATE ... WHERE status='pending'`
- `executeItem(item, job)`：
  1. 若 job 为 pending，更新为 running + started_at
  2. loop：acquireToken → fetchAmazonProduct → success 写 raw_json/flat_json
  3. token exhausted → markTokenExhausted，continue loop
  4. retryable → recordTokenFailure + sleep 3s，最多 2 次网络重试
  5. 无 token → item failed + job failed
- `finalizeJobIfDone(jobId)`：无 pending/processing 时更新 job status（全 failed → failed，否则 completed）
- `resumeStuckJobs()`：`processing` items → `pending`；`running` jobs → `pending`；然后 kickWorker

- [ ] **Step 2: 在 `server.js` initDb 回调中追加**

```javascript
const { initAsinCrawlerRunner, resumeStuckJobs } = require('./service/asin-crawler/job-runner');

initAsinCrawlerRunner({ queryOne, queryAll, runSql });
resumeStuckJobs().catch(err => console.error('[asin-crawler] resume failed', err));
```

---

### Task 7: service/index.js（jobs 业务）

**Files:**
- Create: `service/asin-crawler/index.js`

**Produces:**
- `parseAsinInput(text): { asins: string[], warnings: string[] }`
- `createJob({ asinsText, amazonDomain, createdBy }): Promise<{ job, warnings }>`
- `listJobs({ limit, offset })`
- `getJob(id)`
- `listJobItems(jobId)`
- `cancelJob(jobId)`

- [ ] **Step 1: 实现 parseAsinInput**

```javascript
const ASIN_RE = /^[A-Z0-9]{10}$/;
const MAX_ASINS = Number(process.env.SEARCHAPI_MAX_ASINS_PER_JOB || 500);

function parseAsinInput(text) {
    const lines = String(text || '').split(/\r?\n/);
    const asins = [];
    const seen = new Set();
    const warnings = [];
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;
        const asin = raw.toUpperCase();
        if (!ASIN_RE.test(asin)) {
            warnings.push(`第 ${i + 1} 行 ASIN 无效: ${raw}`);
            continue;
        }
        if (seen.has(asin)) continue;
        seen.add(asin);
        asins.push(asin);
    }
    if (asins.length > MAX_ASINS) {
        throw new Error(`单次任务最多 ${MAX_ASINS} 个 ASIN`);
    }
    return { asins, warnings };
}
```

- [ ] **Step 2: createJob 写入 job + items，调用 kickWorker()**

创建前 `countActiveTokens()` 校验；无 active token 抛错。

---

### Task 8: API 路由

**Files:**
- Modify: `routes/page-api.js`（在 `registerProtectedPageApi` 末尾、`ai-office` 块附近）

- [ ] **Step 1: 注册路由**

```javascript
const asinCrawler = require('../service/asin-crawler');
const { exportJobToCsv } = require('../service/asin-crawler/csv-export');
const tokenPool = require('../service/asin-crawler/token-pool');

app.get('/api/asin-crawler/tokens', async (req, res) => {
    try {
        const tokens = await tokenPool.listTokens();
        const active_count = await tokenPool.countActiveTokens();
        res.json({ tokens, active_count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/asin-crawler/tokens', async (req, res) => {
    try {
        const token = await tokenPool.addToken(req.body || {});
        res.json({ token });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/asin-crawler/tokens/:id/disable', async (req, res) => {
    try {
        const ok = await tokenPool.disableToken(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Token 不存在' });
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/asin-crawler/tokens/:id/reset', async (req, res) => {
    try {
        const ok = await tokenPool.resetToken(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Token 不存在' });
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/asin-crawler/jobs', async (req, res) => {
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

app.get('/api/asin-crawler/jobs', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit || 20), 100);
        const offset = Number(req.query.offset || 0);
        const jobs = await asinCrawler.listJobs({ limit, offset });
        res.json({ jobs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/asin-crawler/jobs/:id', async (req, res) => {
    try {
        const job = await asinCrawler.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        res.json({ job });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/asin-crawler/jobs/:id/items', async (req, res) => {
    try {
        const items = await asinCrawler.listJobItems(req.params.id);
        res.json({ items });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/asin-crawler/jobs/:id/export.csv', async (req, res) => {
    try {
        const job = await asinCrawler.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        const csv = await exportJobToCsv(job.id);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="asin-crawl-${job.id}.csv"`);
        res.send(csv);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/asin-crawler/jobs/:id/cancel', async (req, res) => {
    try {
        const job = await asinCrawler.cancelJob(req.params.id);
        if (!job) return res.status(404).json({ error: '任务不存在' });
        res.json({ job });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});
```

---

### Task 9: 前端 AsinCrawlerView

**Files:**
- Create: `frontend/src/views/AsinCrawlerView.js`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/components/AppSidebar.vue`

- [ ] **Step 1: 路由与侧边栏**

`router/index.js` 增加：

```javascript
import AsinCrawlerView from '@/views/AsinCrawlerView.js';
// children 中：
{ path: 'asin-crawler', name: 'asin-crawler', component: AsinCrawlerView, meta: { active: 'asin_crawler', title: 'ASIN 爬虫' } },
```

`AppSidebar.vue` 在 Google Trends 下方增加：

```html
<router-link to="/asin-crawler" :class="{ active: active === 'asin_crawler' }">ASIN 爬虫</router-link>
```

- [ ] **Step 2: 实现 AsinCrawlerView.js**

结构参考 `AiOfficeView.js`：
- Token 区：表格 + 添加表单（token + label）
- 任务区：textarea asins、amazon_domain 输入、开始按钮
- 当前选中任务进度（progress = (success+fail)/total）
- 历史任务列表
- 轮询 `GET /api/asin-crawler/jobs/:id` 与 items（running/pending 时每 4s）
- 下载 CSV：`window.open('/api/asin-crawler/jobs/' + id + '/export.csv')` 或 fetch blob

状态文案映射：
- pending → 等待中
- running → 爬取中
- completed → 已完成
- failed → 失败
- cancelled → 已取消

---

### Task 10: .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 追加配置**

```
# ASIN 爬虫（SearchAPI）
SEARCHAPI_REQUEST_INTERVAL_MS=2000
SEARCHAPI_TIMEOUT_MS=60000
SEARCHAPI_MAX_ASINS_PER_JOB=500
```

---

### Task 11: 集成验证

- [ ] **Step 1: 单元测试**

Run: `node test/test-asin-crawler-flatten.js`
Run: `node test/test-asin-crawler-csv.js`

- [ ] **Step 2: 启动 dev**

Run: `npm run dev`
Expected: 服务启动无报错，侧边栏可见「ASIN 爬虫」

- [ ] **Step 3: 手工流程**

1. 页面添加 SearchAPI token
2. 粘贴 1–2 个有效 ASIN，创建任务
3. 观察进度轮询至 completed
4. 下载 CSV，确认 UTF-8 BOM、列扁平化、`_crawl_asin` 存在
5. 禁用 token 后创建任务应被拒绝

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| MySQL 3 表 | Task 1 |
| Token 池轮换 | Task 3, 6 |
| SearchAPI 调用 | Task 4, 6 |
| 异步 worker | Task 6, 7 |
| CSV 全量扁平化 | Task 2, 5 |
| REST API | Task 8 |
| 前端页面 | Task 9 |
| 服务重启恢复 | Task 6 |
| 环境变量 | Task 10 |
| 输入校验 500 上限 | Task 7 |

## Self-Review

- 无 TBD / TODO 占位
- 函数名跨 Task 一致（`flattenForCsv`, `acquireToken`, `kickWorker` 等）
- 未引入新依赖
- 测试采用项目现有 `node test/*.js` 风格
