# ScraperAPI 数据采集切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将数据采集模块（ASIN + Google Trends）从 SearchAPI.io 全部切换到 ScraperAPI，保留 Token 池轮换、任务模型与导出流程。

**Architecture:** 新建 `scraperapi.js` 作为供应商适配层；ASIN 走 Structured Amazon Product 并映射为 `{ product }`；Trends 走通用抓取 + `trends-parse.js` HTML/JSON 解析；`job-runner` / `trends.js` 改 require 与文案；删除 `searchapi.js` 运行时引用。

**Tech Stack:** Node.js CommonJS、axios、现有 MySQL token 池、现有前端 DataCollectionView

**Spec:** `docs/superpowers/specs/2026-08-10-scraperapi-data-collection-design.md`

## Global Constraints

- 运行时不得再请求 `https://www.searchapi.io`
- ASIN：`GET https://api.scraperapi.com/structured/amazon/product`
- Trends：ScraperAPI 通用 API 抓取 + 自研解析；`GOOGLE_TRENDS_BATCH_SIZE` 默认 `1`
- Token 表名暂留 `searchapi_tokens`；UI 文案改为 ScraperAPI Key
- 不改 ASIN 任务相关表结构；不做双供应商开关
- 不处理 `service/proxy-pool.js`
- Env：优先 `SCRAPERAPI_*`，兼容读取旧 `SEARCHAPI_*`
- 仅在用户明确要求时 git commit（本计划 commit 步骤为可选）

## File Structure

| 文件 | 职责 |
|------|------|
| `service/data-collection/amazon-map.js` | SDE → `{ product }` 映射；`amazonDomainToTld` |
| `service/data-collection/scraperapi.js` | HTTP、错误分类、`fetchAmazonProduct`、`fetchUrlViaScraperApi` |
| `service/data-collection/trends-parse.js` | 解析 Trends 响应 → timeline 点数组 |
| `service/data-collection/trends.js` | 改用 scraperapi；批大小默认 1；文案 |
| `service/data-collection/asin/job-runner.js` | 改用 scraperapi；文案与 interval env |
| `service/data-collection/searchapi.js` | 删除 |
| `frontend/src/views/DataCollectionView.js` | 文案 |
| `.env.example` | ScraperAPI 变量说明 |
| `test/test-amazon-map.js` | 映射单测 |
| `test/test-trends-parse.js` | 解析单测 + fixture |
| `test/fixtures/google-trends-multiline.json` | Trends 解析样例 |

---

### Task 1: Amazon 映射 + ScraperAPI 客户端（ASIN）

**Files:**
- Create: `service/data-collection/amazon-map.js`
- Create: `service/data-collection/scraperapi.js`
- Create: `test/test-amazon-map.js`

**Interfaces:**
- Produces:
  - `amazonDomainToTld(amazonDomain: string): string`
  - `mapAmazonProduct(sdeJson: object): { product: object, provider: 'scraperapi', raw: object }`
  - `fetchAmazonProduct({ asin, amazonDomain, apiKey }): Promise<mapped>`
  - `fetchUrlViaScraperApi({ url, apiKey, render? }): Promise<string>` （Task 3 使用，本 Task 一并实现）
  - `isTokenExhaustedError(error): boolean`
  - `isRetryableError(error): boolean`
  - `envNumber(primary, fallbackName, defaultValue)` 内部辅助（可选不导出）

- [ ] **Step 1: 写 `test/test-amazon-map.js`（先失败）**

```js
const { amazonDomainToTld, mapAmazonProduct } = require('../service/data-collection/amazon-map');

let passed = 0;
let failed = 0;
function ok(n) { passed += 1; console.log('  ✓', n); }
function fail(n, e) { failed += 1; console.error('  ✗', n, e.message || e); }

function assertEq(a, e, n) {
    if (a !== e) throw new Error(`期望 ${e}，实际 ${a}`);
    ok(n);
}

try {
    assertEq(amazonDomainToTld('amazon.com'), 'com', 'amazon.com → com');
    assertEq(amazonDomainToTld('www.amazon.co.uk'), 'co.uk', 'amazon.co.uk → co.uk');
    assertEq(amazonDomainToTld(''), 'com', '空域名默认 com');
} catch (e) { fail('tld 映射', e); }

try {
    const mapped = mapAmazonProduct({
        name: 'Demo Product',
        brand: 'DemoBrand',
        feature_bullets: ['a', 'b'],
        images: ['https://example.com/1.jpg'],
        product_category: 'Home›Kitchen',
        product_information: { asin: 'B0TEST', manufacturer: 'M' }
    });
    if (!mapped.product) throw new Error('缺少 product');
    if (mapped.provider !== 'scraperapi') throw new Error('provider');
    if (mapped.product.title !== 'Demo Product' && mapped.product.name !== 'Demo Product') {
        throw new Error('title/name 未映射');
    }
    if (!Array.isArray(mapped.product.feature_bullets) || mapped.product.feature_bullets.length !== 2) {
        throw new Error('feature_bullets');
    }
    ok('mapAmazonProduct 基础字段');
} catch (e) { fail('mapAmazonProduct 基础字段', e); }

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: 运行确认 RED**

```bash
node test/test-amazon-map.js
```

Expected: 模块不存在，exit ≠ 0

- [ ] **Step 3: 实现 `amazon-map.js`**

```js
function amazonDomainToTld(amazonDomain) {
    const raw = String(amazonDomain || '').trim().toLowerCase();
    if (!raw) return 'com';
    const host = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const m = host.match(/^amazon\.(.+)$/);
    return m ? m[1] : 'com';
}

function mapAmazonProduct(sdeJson) {
    const raw = sdeJson && typeof sdeJson === 'object' ? sdeJson : {};
    const images = Array.isArray(raw.images) ? raw.images : [];
    const product = {
        title: raw.name || raw.title || '',
        name: raw.name || raw.title || '',
        brand: raw.brand || '',
        feature_bullets: Array.isArray(raw.feature_bullets) ? raw.feature_bullets : [],
        images,
        main_image: images[0] || '',
        product_information: raw.product_information || {},
        categories: raw.product_category || '',
        full_description: raw.full_description || '',
        model: raw.model || '',
        ships_from: raw.ships_from || '',
        sold_by: raw.sold_by || '',
        asin: raw.product_information && raw.product_information.asin
            ? raw.product_information.asin
            : ''
    };
    return { product, provider: 'scraperapi', raw };
}

module.exports = { amazonDomainToTld, mapAmazonProduct };
```

- [ ] **Step 4: 实现 `scraperapi.js`**

```js
const axios = require('axios');
const { amazonDomainToTld, mapAmazonProduct } = require('./amazon-map');

function envMs(primary, legacy, fallback) {
    const v = process.env[primary] ?? process.env[legacy];
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TIMEOUT_MS = envMs('SCRAPERAPI_TIMEOUT_MS', 'SEARCHAPI_TIMEOUT_MS', 60000);
const BASE = 'https://api.scraperapi.com';
const EXHAUSTED_KEYWORDS = [
    'quota', 'credit', 'exhausted', 'insufficient', 'limit reached',
    'concurrency', 'payment required', 'upgrade your plan'
];

function isTokenExhaustedError(error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403 || status === 402) return true;
    const bodyText = JSON.stringify(error?.response?.data || error?.message || '').toLowerCase();
    return EXHAUSTED_KEYWORDS.some((k) => bodyText.includes(k));
}

function isRetryableError(error) {
    if (isTokenExhaustedError(error)) return false;
    const status = error?.response?.status;
    if (status && status >= 500) return true;
    const code = error?.code;
    return ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(code);
}

async function scraperApiGet(params) {
    const response = await axios.get(BASE, {
        params,
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(d) => d]
    });
    if (response.status >= 400) {
        const err = new Error(`ScraperAPI HTTP ${response.status}`);
        err.response = {
            status: response.status,
            data: response.data
        };
        throw err;
    }
    return response.data;
}

async function fetchAmazonProduct({ asin, amazonDomain = 'amazon.com', apiKey }) {
    const tld = amazonDomainToTld(amazonDomain);
    const response = await axios.get(`${BASE}/structured/amazon/product`, {
        params: {
            api_key: apiKey,
            asin: String(asin || '').trim().toUpperCase(),
            tld
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true
    });
    if (response.status >= 400) {
        const err = new Error(`ScraperAPI HTTP ${response.status}`);
        err.response = response;
        throw err;
    }
    const data = response.data || {};
    if (!data || (typeof data === 'object' && !data.name && !data.title && !data.product_information)) {
        throw new Error('ScraperAPI 未返回 Amazon 商品数据');
    }
    return mapAmazonProduct(data);
}

async function fetchUrlViaScraperApi({ url, apiKey, render }) {
    const useRender = render != null
        ? Boolean(render)
        : String(process.env.SCRAPERAPI_RENDER || 'true').toLowerCase() !== 'false';
    const params = {
        api_key: apiKey,
        url: String(url)
    };
    if (useRender) params.render = 'true';
    return scraperApiGet(params);
}

module.exports = {
    fetchAmazonProduct,
    fetchUrlViaScraperApi,
    isTokenExhaustedError,
    isRetryableError,
    TIMEOUT_MS
};
```

- [ ] **Step 5: 运行确认 GREEN**

```bash
node test/test-amazon-map.js
```

Expected: 全部通过

- [ ] **Step 6: Commit（仅用户要求时）**

---

### Task 2: ASIN job-runner 切换到 ScraperAPI

**Files:**
- Modify: `service/data-collection/asin/job-runner.js`
- Modify: `service/data-collection/asin/index.js`（若有 SearchAPI 文案/ env）
- Grep: 全库 `searchapi` / `SearchAPI` 在 asin 路径下的用户可见字符串

**Interfaces:**
- Consumes: `fetchAmazonProduct`, `isTokenExhaustedError`, `isRetryableError` from `../scraperapi`
- Produces: 行为与现网一致，仅供应商与文案变化

- [ ] **Step 1: 修改 `job-runner.js`**

将：

```js
const { fetchAmazonProduct, isTokenExhaustedError, isRetryableError } = require('../searchapi');
const REQUEST_INTERVAL_MS = Number(process.env.SEARCHAPI_REQUEST_INTERVAL_MS || 2000);
```

改为：

```js
const { fetchAmazonProduct, isTokenExhaustedError, isRetryableError } = require('../scraperapi');
const REQUEST_INTERVAL_MS = Number(
    process.env.SCRAPERAPI_REQUEST_INTERVAL_MS
    || process.env.SEARCHAPI_REQUEST_INTERVAL_MS
    || 500
);
```

将所有用户可见「SearchAPI」错误文案改为「ScraperAPI」（如「无可用 ScraperAPI Key…」「全部 ScraperAPI Key 已失效…」）。

检查 `asin/index.js` 中 `SEARCHAPI_MAX_ASINS_PER_JOB`：

```js
Number(process.env.SCRAPERAPI_MAX_ASINS_PER_JOB || process.env.SEARCHAPI_MAX_ASINS_PER_JOB || 100)
```

- [ ] **Step 2: 静态确认无 searchapi require**

```bash
node -e "const r=require('./service/data-collection/asin/job-runner'); console.log(typeof r.initAsinCrawlerRunner)"
```

Expected: `function`；且 `job-runner.js` 内无 `../searchapi`

- [ ] **Step 3: Commit（仅用户要求时）**

---

### Task 3: Trends 解析器 + fixture 单测

**Files:**
- Create: `service/data-collection/trends-parse.js`
- Create: `test/fixtures/google-trends-multiline.json`
- Create: `test/test-trends-parse.js`

**Interfaces:**
- Produces:
  - `stripGoogleAntiXssi(text: string): string`
  - `parseTrendsTimeline(payload: object|string, keyword: string): Array<{date,time,formattedTime,searches,value,formattedValue,empty}>`
  - `buildTrendsExploreUrl({ keyword, geo, time, hl, tz }): string`（用于抓取的目标 URL）

**解析策略（按优先级）：**

1. 若 body 以 `)]}'` 开头的 Google API JSON → 去掉前缀后 JSON.parse  
2. 若为 HTML，尝试匹配嵌入的 `widgets` / `interest_over_time` / `timelineData` JSON 片段  
3. 支持常见 multiline 结构：`default.timelineData[]` 含 `time`, `value[]` 或 `formattedValue[]`  
4. 失败抛 `Error('Trends HTML 未解析到时序数据')`

- [ ] **Step 1: 写 fixture**

`test/fixtures/google-trends-multiline.json`：

```json
{
  "default": {
    "timelineData": [
      {
        "time": "1704067200",
        "formattedTime": "Jan 1, 2024",
        "value": [42],
        "formattedValue": ["42"]
      },
      {
        "time": "1704672000",
        "formattedTime": "Jan 8, 2024",
        "value": [55],
        "formattedValue": ["55"]
      }
    ]
  }
}
```

- [ ] **Step 2: 写失败测试 `test/test-trends-parse.js`**

```js
const fs = require('fs');
const path = require('path');
const { parseTrendsTimeline, stripGoogleAntiXssi, buildTrendsExploreUrl } = require('../service/data-collection/trends-parse');

let passed = 0;
let failed = 0;
function ok(n) { passed += 1; console.log('  ✓', n); }
function fail(n, e) { failed += 1; console.error('  ✗', n, e.message || e); }

try {
    const s = stripGoogleAntiXssi(")]}'\n{\"a\":1}");
    if (s !== '{"a":1}' && !s.includes('"a"')) throw new Error(s);
    ok('strip anti-xssi');
} catch (e) { fail('strip anti-xssi', e); }

try {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/google-trends-multiline.json'), 'utf8'));
    const rows = parseTrendsTimeline(fixture, 'shoes');
    if (!Array.isArray(rows) || rows.length !== 2) throw new Error('len');
    if (rows[0].value !== 42) throw new Error('value0');
    if (!rows[0].date) throw new Error('date');
    ok('parse fixture timeline');
} catch (e) { fail('parse fixture timeline', e); }

try {
    const prefixed = ")]}'\n" + fs.readFileSync(path.join(__dirname, 'fixtures/google-trends-multiline.json'), 'utf8');
    const rows = parseTrendsTimeline(prefixed, 'shoes');
    if (rows.length !== 2) throw new Error('prefixed len');
    ok('parse anti-xssi string');
} catch (e) { fail('parse anti-xssi string', e); }

try {
    const url = buildTrendsExploreUrl({ keyword: 'nike shoes', geo: 'US', time: 'today 3-m', hl: 'en-US', tz: 360 });
    if (!String(url).includes('trends.google.com')) throw new Error(url);
    if (!String(url).includes('nike')) throw new Error('keyword missing');
    ok('buildTrendsExploreUrl');
} catch (e) { fail('buildTrendsExploreUrl', e); }

try {
    parseTrendsTimeline('<html>no data</html>', 'x');
    fail('invalid should throw', new Error('未抛错'));
} catch (e) {
    if (String(e.message).includes('未抛错')) fail('invalid should throw', e);
    else ok('invalid should throw');
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: RED**

```bash
node test/test-trends-parse.js
```

- [ ] **Step 4: 实现 `trends-parse.js`**

实现须覆盖上述测试。`buildTrendsExploreUrl` 建议：

```js
function buildTrendsExploreUrl({ keyword, geo, time, hl, tz }) {
    const u = new URL('https://trends.google.com/trends/explore');
    u.searchParams.set('q', keyword);
    if (geo) u.searchParams.set('geo', geo);
    if (time) u.searchParams.set('date', time); // 若实测参数名不同，联调时修正，并更新本注释
    if (hl) u.searchParams.set('hl', hl);
    // tz 可选挂到 hash 或忽略
    return u.toString();
}
```

**注意：** Google Trends 公开 explore 页不一定直接含完整 timeline。实现解析时同时支持：

- `default.timelineData`
- `interest_over_time.timeline_data`（兼容旧 SearchAPI 形态，便于测试）
- HTML 中用正则提取 `timelineData` JSON 数组

若 explore 页实在无数据，允许后续 Task 4 改为先请求  
`https://trends.google.com/trends/api/explore?...` 再请求 widget URL（仍经 ScraperAPI）。Task 3 至少保证 fixture / anti-xssi / timelineData 解析正确。

- [ ] **Step 5: GREEN**

```bash
node test/test-trends-parse.js
```

- [ ] **Step 6: Commit（仅用户要求时）**

---

### Task 4: 接线 `trends.js`

**Files:**
- Modify: `service/data-collection/trends.js`

**Interfaces:**
- Consumes: `fetchUrlViaScraperApi`, `isTokenExhaustedError`, `isRetryableError` from `./scraperapi`；`parseTrendsTimeline`, `buildTrendsExploreUrl` from `./trends-parse`
- Produces: `getGoogleTrendsBatch` 对外行为不变

- [ ] **Step 1: 替换 require 与 BATCH_SIZE**

```js
const { fetchUrlViaScraperApi, isTokenExhaustedError, isRetryableError } = require('./scraperapi');
const { parseTrendsTimeline, buildTrendsExploreUrl } = require('./trends-parse');

const BATCH_SIZE = Math.max(1, Number(process.env.GOOGLE_TRENDS_BATCH_SIZE || 1));
```

- [ ] **Step 2: 重写 `fetchTrendsBatchFromSearchApi` → `fetchTrendsBatchFromScraperApi`**

逻辑要点：

1. `list.length > BATCH_SIZE` 时仍抛错（默认 1）  
2. Token 轮换与现有 while 循环相同，文案改为 ScraperAPI  
3. 对每个关键词（本批）构建 URL：`buildTrendsExploreUrl({ keyword, geo, time: resolveGoogleTime(interval), hl: DEFAULT_HL, tz: DEFAULT_TZ })`  
4. `const body = await fetchUrlViaScraperApi({ url, apiKey: token.token })`  
5. `const dataPoints = parseTrendsTimeline(body, keyword)`  
6. 返回 Map，message 改为 `Google Trends relative interest via ScraperAPI, scaled 0-100`  
7. `formatRequestError` 内 SearchAPI → ScraperAPI  

上层 `getGoogleTrendsBatch` 里 `source: 'searchapi'` 改为 `source: 'scraperapi'`。  
删除对 `fetchSearchApi` / `mapSearchApiTimeline` 的依赖（若 `mapSearchApiTimeline` 仅服务 SearchAPI 则可删除）。

若单次批内多个 keyword（BATCH_SIZE>1），循环逐个抓取并合并 Map（仍共用同一 token 尝试）。

- [ ] **Step 3: 加载冒烟**

```bash
node -e "require('./service/data-collection/trends'); console.log('ok')"
node test/test-trends-parse.js
node test/test-amazon-map.js
```

Expected: ok + 测试通过

- [ ] **Step 4: Commit（仅用户要求时）**

---

### Task 5: 前端文案、env、删除 searchapi.js

**Files:**
- Modify: `frontend/src/views/DataCollectionView.js`
- Modify: `.env.example`
- Delete: `service/data-collection/searchapi.js`
- Modify: 任意残留运行时 SearchAPI 用户文案（`trends.js` / `job-runner` 已改则跳过）

- [ ] **Step 1: 更新 DataCollectionView 文案**

至少：

- `SearchAPI · Token · ASIN 爬虫 · Google Trends` → `ScraperAPI · Token · ASIN 爬虫 · Google Trends`
- `每行一个 SearchAPI Token` → `每行一个 ScraperAPI Key`
- 其它可见「SearchAPI」改为「ScraperAPI」

- [ ] **Step 2: 更新 `.env.example`**

将 SearchAPI 段改为：

```env
# Google Trends（通过 ScraperAPI 抓取 HTML 解析，与 ASIN 共用 Key 池）
# 在「数据采集 → Token」页添加 ScraperAPI Key 后即可使用
GOOGLE_TRENDS_GEO=US
GOOGLE_TRENDS_HL=en-US
GOOGLE_TRENDS_TZ=360
GOOGLE_TRENDS_REQUEST_INTERVAL_MS=3000
GOOGLE_TRENDS_CACHE_TTL_MS=86400000
# ScraperAPI Trends 默认每次 1 个关键词
GOOGLE_TRENDS_BATCH_SIZE=1

# ASIN 爬虫（ScraperAPI Structured Amazon Product）
SCRAPERAPI_REQUEST_INTERVAL_MS=500
SCRAPERAPI_TIMEOUT_MS=60000
SCRAPERAPI_MAX_ASINS_PER_JOB=100
SCRAPERAPI_RENDER=true
# 兼容旧名（可选）：SEARCHAPI_TIMEOUT_MS / SEARCHAPI_REQUEST_INTERVAL_MS
```

- [ ] **Step 3: 删除 `searchapi.js` 并确认无引用**

```bash
# PowerShell
Select-String -Path (Get-ChildItem -Recurse -Include *.js,*.vue,*.md -File | Where-Object { $_.FullName -notmatch 'node_modules|\.superpowers' }) -Pattern "searchapi\.io|require\('\./searchapi'\)|require\('\.\./searchapi'\)" | Select-Object -First 30
```

Expected: 无运行时 `require` 到已删文件；无 `searchapi.io` URL（文档历史提及可保留）。

删除文件：`service/data-collection/searchapi.js`

- [ ] **Step 4: 回归**

```bash
node test/test-amazon-map.js
node test/test-trends-parse.js
node test/test-asin-crawler-flatten.js
node test/test-asin-crawler-export.js
node -e "require('./service/data-collection'); console.log('ok')"
```

Expected: 全部通过 / ok

- [ ] **Step 5: 将 spec 状态改为「已批准」**（若尚未改）

`docs/superpowers/specs/2026-08-10-scraperapi-data-collection-design.md` 顶部状态：`已批准`

- [ ] **Step 6: Commit（仅用户要求时）**

---

## Spec Coverage

| Spec 要求 | Task |
|-----------|------|
| scraperapi.js + Amazon SDE | Task 1–2 |
| amazon 映射 `{ product }` | Task 1 |
| Trends HTML/JSON 解析 | Task 3–4 |
| BATCH_SIZE 默认 1 | Task 4 |
| Token 池保留，文案 ScraperAPI | Task 2、5 |
| 删除 searchapi 运行时 | Task 5 |
| env SCRAPERAPI_* 兼容旧名 | Task 1–2、5 |
| 不改任务表 / 不做双供应商 | 全任务遵守 |

## Placeholder Scan

无 TBD；Trends explore URL 参数名允许联调微调，但解析契约以 fixture 测试锁定。
