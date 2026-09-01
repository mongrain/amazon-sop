# 桌宠欧洲站广告日报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌宠每天 12:20 通过 yanjun 拉取 UK/DE/FR/IT/ES 近 7 个完整自然日广告汇总，以「国家 · 指标」× 日期表格展示（涨标 ↑），并给出只读优化建议。

**Architecture:** 纯函数与拉数放在 `service/eu-ads-daily-report.js`（`callTool` 可注入，复用 `callYanjunTool` / `sumCampaignAdMetrics`）。桌宠主进程 12:20 触发、缓存上次成功结果、IPC 下发；渲染进程在 `euAdsReport` 视图展示表格与建议。不自动改广告。

**Tech Stack:** Electron 桌宠、现有 `service/yanjun-mcp.js`、`service/lingxing-metrics.js`、`dotenv`、`node --test`/`assert` 风格 `node test/*.js`；不新增 npm 依赖。

## Global Constraints

- 只汇报 + 建议，不自动暂停/改价/改预算/改否定词
- 站点仅 UK / DE / FR / IT / ES（GB→UK）
- 指标仅广告曝光、点击、出单；不掺 ASIN 级访客/总销
- 主表用最近 7 个完整自然日；当天半日不进主表
- 行 = `国家 · 指标`，列 = 日期，最右列涨标 `↑`（持平/下跌不标）
- 不改现有 12:30 / 18:10 记任务
- 密钥只在主进程环境变量 `YANJUN_MCP_URL`；不暴露给渲染进程配置面
- 提交信息用中文 `feat:` / `test:` / `docs:`；不 `--no-verify`；不提交无关脏文件（如未要求的 `pet.png` 改动可另议）
- 优先复用根目录 `service/`，桌宠用 `require('../service/...')`

## File Structure

- Create: `service/eu-ads-daily-report.js` — 日期窗、国家归一、矩阵、涨跌、建议、拉数
- Create: `test/test-eu-ads-daily-report.js`
- Modify: `desktop-pet/main.js` — 12:20 prompt、dotenv、拉数/缓存、IPC
- Modify: `desktop-pet/preload.js` — 暴露 `fetchEuAdsReport` / 报告事件
- Modify: `desktop-pet/renderer/index.html` — 报告面板 DOM
- Modify: `desktop-pet/renderer/renderer.js` — 报告视图渲染
- Modify: `desktop-pet/renderer/styles.css` — 表格样式
- Modify: `desktop-pet/renderer/pet.js` — 气泡文案（可选）
- Modify: `package.json` — `desktop:check` 如需覆盖新文件

---

### Task 1: 日期窗与欧洲店过滤纯函数

**Files:**
- Create: `service/eu-ads-daily-report.js`
- Test: `test/test-eu-ads-daily-report.js`

**Interfaces:**
- Consumes: 无（本任务不拉网）
- Produces:
  - `EU_COUNTRY_ORDER` → `['UK','DE','FR','IT','ES']`
  - `METRIC_ORDER` → `['impressions','clicks','orders']`（对外展示名：曝光/点击/出单）
  - `metricLabel(metric)` → `'曝光'|'点击'|'出单'`
  - `shiftYmd(ymd, days)` → `'YYYY-MM-DD'`
  - `completeDayWindow(todayYmd)` → `string[]` 长度 7：昨天往前共 7 天，从早到晚
  - `normalizeCountryCode(raw)` → `'UK'|...|'ES'|null`（`GB`/`UK`→`UK`；大小写不敏感；未知→`null`）
  - `listEuAdShops(payload)` → `[{ country, profileId, name }]`：从授权店列表抽出欧洲站；同国家多店都保留；`profileId` 为有限数字或数字字符串

`listEuAdShops` 列表来源与现有一致：`extractPerformanceList(payload)`，若空再试 `payload.list` / `payload.data` / `payload.shops`。国家字段：`country` / `marketplace` / `country_code`。Profile：`profile_id` / `profileId`。

- [ ] **Step 1: Write the failing test**

创建 `test/test-eu-ads-daily-report.js`：

```javascript
const assert = require('assert');
const {
    completeDayWindow,
    normalizeCountryCode,
    listEuAdShops,
    metricLabel,
    EU_COUNTRY_ORDER
} = require('../service/eu-ads-daily-report');

assert.deepStrictEqual(completeDayWindow('2026-09-01'), [
    '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
    '2026-08-29', '2026-08-30', '2026-08-31'
]);
assert.strictEqual(normalizeCountryCode('gb'), 'UK');
assert.strictEqual(normalizeCountryCode('DE'), 'DE');
assert.strictEqual(normalizeCountryCode('US'), null);
assert.strictEqual(metricLabel('impressions'), '曝光');
assert.deepStrictEqual(EU_COUNTRY_ORDER, ['UK', 'DE', 'FR', 'IT', 'ES']);

const shops = listEuAdShops({
    list: [
        { name: 'EU-UK', country: 'GB', profile_id: 11 },
        { name: 'EU-DE', country: 'DE', profile_id: '22' },
        { name: 'US', country: 'US', profile_id: 99 }
    ]
});
assert.deepStrictEqual(shops.map((s) => [s.country, s.profileId]), [
    ['UK', 11],
    ['DE', 22]
]);

console.log('ok test-eu-ads-daily-report task1');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-eu-ads-daily-report.js`  
Expected: FAIL（模块不存在或导出缺失）

- [ ] **Step 3: Write minimal implementation**

Create `service/eu-ads-daily-report.js` with the functions above（可先 `module.exports` 这些；后续任务追加）。`listEuAdShops` 内部可 `require('./lingxing-metrics').extractPerformanceList`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-eu-ads-daily-report.js`  
Expected: `ok test-eu-ads-daily-report task1`

- [ ] **Step 5: Commit**

```bash
git add service/eu-ads-daily-report.js test/test-eu-ads-daily-report.js
git commit -m "feat: 欧洲广告日报日期窗与店铺过滤"
```

---

### Task 2: 矩阵构建与涨跌标记

**Files:**
- Modify: `service/eu-ads-daily-report.js`
- Modify: `test/test-eu-ads-daily-report.js`

**Interfaces:**
- Consumes: Task 1 exports
- Produces:
  - `rowKey(country, metric)` → 如 `'UK · 曝光'`（中间全角空格 ` · `）
  - `buildReportMatrix({ dates, dailyByCountry })` →  
    `{ dates, rows }`  
    `dailyByCountry` 形如：  
    `{ UK: { '2026-08-30': { impressions, clicks, orders }, ... }, ... }`  
    缺国家或缺日用 `null`。  
    `rows`：按 `EU_COUNTRY_ORDER` × `METRIC_ORDER` 固定 15 行：  
    `{ key, country, metric, values: { [ymd]: number|null }, trend: 'up'|null }`  
    `trend`：用该行 `dates` 最后一天与倒数第二天比较；仅当两者均为有限数字且最后一天 **>** 前一天时为 `'up'`，否则 `null`（含缺数、持平、下跌）

- [ ] **Step 1: Extend failing assertions**

Append to the test file（保留 Task 1 断言）：

```javascript
const { buildReportMatrix, rowKey } = require('../service/eu-ads-daily-report');

assert.strictEqual(rowKey('UK', 'clicks'), 'UK · 点击');

const dates = ['2026-08-30', '2026-08-31'];
const matrix = buildReportMatrix({
    dates,
    dailyByCountry: {
        UK: {
            '2026-08-30': { impressions: 100, clicks: 10, orders: 1 },
            '2026-08-31': { impressions: 120, clicks: 8, orders: 1 }
        }
    }
});
assert.strictEqual(matrix.rows.length, 15);
const ukImp = matrix.rows.find((r) => r.key === 'UK · 曝光');
const ukClk = matrix.rows.find((r) => r.key === 'UK · 点击');
const deImp = matrix.rows.find((r) => r.key === 'DE · 曝光');
assert.strictEqual(ukImp.values['2026-08-31'], 120);
assert.strictEqual(ukImp.trend, 'up');
assert.strictEqual(ukClk.trend, null);
assert.strictEqual(deImp.values['2026-08-31'], null);
assert.strictEqual(deImp.trend, null);
```

- [ ] **Step 2: Run test — expect fail on missing exports**

Run: `node test/test-eu-ads-daily-report.js`

- [ ] **Step 3: Implement `rowKey` + `buildReportMatrix`**

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git add service/eu-ads-daily-report.js test/test-eu-ads-daily-report.js
git commit -m "feat: 欧洲广告日报矩阵与涨跌标记"
```

---

### Task 3: 只读建议规则

**Files:**
- Modify: `service/eu-ads-daily-report.js`
- Modify: `test/test-eu-ads-daily-report.js`

**Interfaces:**
- Consumes: `buildReportMatrix` 结果
- Produces:
  - `buildSuggestions(matrix)` → `Array<{ country, evidence, action, review }>`，最多 5 条  
  - 对每个在矩阵中**至少有一个非空指标**的国家，取最近完整日 vs 前一日的 impressions/clicks/orders：
    - 曝光↓ 且 点击↓ → action 含「预算是否撞顶、出价是否偏低」
    - 点击↑ 且 出单↓ → action 含「搜索词相关性」或「Listing 转化」
    - 曝光↑ 且（点击持平或↓）→ action 含「CTR」或「主图」
    - 三项均↑ → action 含「观察」或「谨慎加预算」
  - 每条 `evidence` 必须含具体数字；`review` 写复核条件（如「再观察 1～2 个完整日」）
  - 调用方可在 UI 统一加前缀「建议，需你手动执行」；函数返回的 `action` 可不重复该前缀，但 `buildSuggestions` 文档注释写明 UI 必加

比较辅助：`delta(a,b)` 仅当两者为有限数字；↑ 为 `b>a`，↓ 为 `b<a`，平为 `b===a`。

- [ ] **Step 1: Write assertions**

```javascript
const { buildSuggestions } = require('../service/eu-ads-daily-report');
const sugMatrix = buildReportMatrix({
    dates: ['2026-08-30', '2026-08-31'],
    dailyByCountry: {
        UK: {
            '2026-08-30': { impressions: 200, clicks: 20, orders: 2 },
            '2026-08-31': { impressions: 100, clicks: 10, orders: 2 }
        },
        DE: {
            '2026-08-30': { impressions: 50, clicks: 5, orders: 2 },
            '2026-08-31': { impressions: 80, clicks: 10, orders: 1 }
        }
    }
});
const suggestions = buildSuggestions(sugMatrix);
assert.ok(suggestions.length >= 1 && suggestions.length <= 5);
assert.ok(suggestions.some((s) => s.country === 'UK' && /预算|出价/.test(s.action)));
assert.ok(suggestions.some((s) => s.country === 'DE' && /搜索词|Listing|转化/.test(s.action)));
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `buildSuggestions`**

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git add service/eu-ads-daily-report.js test/test-eu-ads-daily-report.js
git commit -m "feat: 欧洲广告日报只读建议规则"
```

---

### Task 4: 拉数组装（可注入 callTool）

**Files:**
- Modify: `service/eu-ads-daily-report.js`
- Modify: `test/test-eu-ads-daily-report.js`

**Interfaces:**
- Consumes: `callYanjunTool`（默认）、`extractPerformanceList`、`sumCampaignAdMetrics` from `lingxing-metrics`
- Produces:
  - `async queryCampaignRowsForDay({ profileId, ymd, callTool })` → 活动行数组  
    调用 `callTool('lingxing_ad_campaign_report', { report_date: \`${ymd} - ${ymd}\`, profile_ids: [profileId], sort_field: 'spends', sort_type: 'desc', page, length: 50 })`，分页直到不足一页或最多 40 页（同 `lingxing-fetch.queryAdReportPages` 逻辑，可内联私有函数）
  - `async fetchEuAdsDailyReport({ todayYmd, callTool })` →  
    ```js
    {
      dates,           // completeDayWindow(todayYmd)
      rows,            // buildReportMatrix
      suggestions,     // buildSuggestions
      fetchedAt,       // ISO string
      failures,        // [{ country, profileId, message }]
      shops            // listEuAdShops 结果
    }
    ```
  - 流程：
    1. `dates = completeDayWindow(todayYmd)`
    2. `shopsPayload = await callTool('lingxing_ad_auth_shops', {})`
    3. `shops = listEuAdShops(shopsPayload)`；若空 → throw `Error('未找到欧洲广告授权店铺')` 且 `err.status = 400`
    4. 初始化 `dailyByCountry = {}`
    5. 对每个 shop、每个 date：try 拉活动 → `sumCampaignAdMetrics` → 写入  
       `{ impressions: ad_impressions, clicks, orders: ad_orders }`；同国家多 profile **数值相加**（null 当 0 仅当另一侧有数；两边都空保持 null）
    6. 单次失败 push `failures`，该 shop+day 跳过，不中断其它
    7. `matrix = buildReportMatrix(...)`；返回含 `suggestions`

工具名与现有 `service/lingxing-fetch.js` 保持一致：`lingxing_ad_auth_shops`、`lingxing_ad_campaign_report`。

- [ ] **Step 1: Write mock fetch test**

```javascript
const { fetchEuAdsDailyReport } = require('../service/eu-ads-daily-report');

(async () => {
    const calls = [];
    const callTool = async (name, args) => {
        calls.push({ name, args });
        if (name === 'lingxing_ad_auth_shops') {
            return { list: [
                { name: 'UK', country: 'UK', profile_id: 1 },
                { name: 'DE', country: 'DE', profile_id: 2 }
            ] };
        }
        if (name === 'lingxing_ad_campaign_report') {
            const pid = args.profile_ids[0];
            const day = String(args.report_date).slice(0, 10);
            if (pid === 1 && day === '2026-08-31') {
                return { list: [{ impressions: 10, clicks: 2, orders: 1, spends: 1 }] };
            }
            return { list: [{ impressions: 5, clicks: 1, orders: 0, spends: 1 }] };
        }
        throw new Error('unexpected ' + name);
    };
    const report = await fetchEuAdsDailyReport({ todayYmd: '2026-09-01', callTool });
    assert.strictEqual(report.dates.length, 7);
    assert.strictEqual(report.rows.length, 15);
    const ukImp = report.rows.find((r) => r.key === 'UK · 曝光');
    assert.strictEqual(ukImp.values['2026-08-31'], 10);
    assert.ok(Array.isArray(report.suggestions));
    assert.ok(calls.some((c) => c.name === 'lingxing_ad_auth_shops'));
    console.log('ok fetchEuAdsDailyReport');
})().catch((e) => { console.error(e); process.exit(1); });
```

把异步部分并入现有测试文件时：用顶层 async IIFE 包住全部断言，或拆 `assert` 同步段 + 末尾 async。推荐整文件改为 async IIFE，先跑同步再跑 async。

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement query + fetch**

- [ ] **Step 4: Run full `node test/test-eu-ads-daily-report.js` — pass**

- [ ] **Step 5: Commit**

```bash
git add service/eu-ads-daily-report.js test/test-eu-ads-daily-report.js
git commit -m "feat: 欧洲广告日报 yanjun 拉数组装"
```

---

### Task 5: 桌宠 12:20 触发 + IPC + 缓存

**Files:**
- Modify: `desktop-pet/main.js`
- Modify: `desktop-pet/preload.js`

**Interfaces:**
- Consumes: `fetchEuAdsDailyReport` from `../service/eu-ads-daily-report`；`require('dotenv').config()` 在文件顶部（相对仓库根 `.env`）
- Produces:
  - `PROMPTS` 增加一项：  
    `{ key: 'euAdsReport', label: '12:20', title: '欧洲广告日报', question: '欧洲站广告近 7 日汇总来了。', message: '欧洲站广告日报到了', hour: 12, minute: 20 }`  
    **插入在 `tasks`（12:30）之前**，保证同日先触发 12:20
  - 内存/文件缓存：`lastEuAdsReport`（成功结果）；失败时 IPC 仍可返回 `{ error, report: lastSuccess|null }`
  - `ipcMain.handle('pet:fetch-eu-ads-report', async () => { ... })`：  
    - 无 `YANJUN_MCP_URL` → `{ error: '未配置领星网关', report: last }`  
    - 否则 `todayYmd = getDateKey()`，`fetchEuAdsDailyReport({ todayYmd })`，成功写入缓存
  - `triggerPrompt` 当 `prompt.key === 'euAdsReport'`：照常通知 + `showChatWindow('euAdsReport')`，并 **异步预拉**（不阻塞 UI）；拉完 `chatWindow.webContents.send('pet:eu-ads-report', payload)`
  - preload：  
    `fetchEuAdsReport: () => ipcRenderer.invoke('pet:fetch-eu-ads-report')`  
    `onEuAdsReport: (cb) => ipcRenderer.on('pet:eu-ads-report', (_e, p) => cb(p))`

不修改记任务的 `pet:save-answer` 行为。

- [ ] **Step 1: 改 main/preload（无自动化 UI 测试；用 node --check）**

在 `main.js` 顶部：

```javascript
require('dotenv').config();
const { fetchEuAdsDailyReport } = require('../service/eu-ads-daily-report');
```

按上面 Interfaces 接线。

- [ ] **Step 2: Syntax check**

Run: `node --check desktop-pet/main.js`  
Run: `node --check desktop-pet/preload.js`  
Expected: 无输出、exit 0

- [ ] **Step 3: Commit**

```bash
git add desktop-pet/main.js desktop-pet/preload.js
git commit -m "feat: 桌宠 12:20 欧洲广告日报触发与 IPC"
```

---

### Task 6: 汇报窗 UI（表格 + 建议）

**Files:**
- Modify: `desktop-pet/renderer/index.html`
- Modify: `desktop-pet/renderer/renderer.js`
- Modify: `desktop-pet/renderer/styles.css`
- Modify: `desktop-pet/renderer/pet.js`（气泡：`euAdsReport` → 「欧洲广告日报来了」）

**Interfaces:**
- Consumes: preload `fetchEuAdsReport` / `onEuAdsReport`；state `currentPromptKey`
- Produces: 当 `currentPromptKey === 'euAdsReport'`（或 `viewMode === 'euAds'`）时：
  - **隐藏**记任务表单与任务列表（或整块 `answer-panel` / `history-card`）
  - **显示** `#euAdsPanel`：标题说明、刷新按钮、表格、建议列表、页脚（fetchedAt / failures / error）
  - 表格：首列「国家 · 指标」，中间 `dates` 列，末列「涨跌」（`trend==='up'` 显示 `↑`）
  - 建议：每条展示 `【建议，需你手动执行】{country}：{action}`，副文 `依据：{evidence}` / `复核：{review}`
  - 刷新：调用 `fetchEuAdsReport()`，loading 时按钮 disabled，文案「拉取中…」
  - `onEuAdsReport` / `onPrompt(euAdsReport)` 时自动进入该视图并渲染

HTML 最小结构：

```html
<section id="euAdsPanel" class="eu-ads-panel hidden">
  <div class="eu-ads-head">
    <div class="eu-ads-title">欧洲站广告近 7 日汇总</div>
    <button id="euAdsRefreshBtn" type="button" class="ghost-btn">刷新</button>
  </div>
  <div id="euAdsHint" class="eu-ads-hint"></div>
  <div id="euAdsTableWrap" class="eu-ads-table-wrap"></div>
  <div class="eu-ads-suggestions-title">今日建议</div>
  <ul id="euAdsSuggestions" class="eu-ads-suggestions"></ul>
  <div id="euAdsFooter" class="eu-ads-footer"></div>
</section>
```

样式：沿用现有聊天卡色板；表格 `font-size` 略小、可横向滚动；**不要**新引入整套设计系统。

- [ ] **Step 1: 实现 HTML/CSS/JS 切换与渲染**

- [ ] **Step 2: Check**

Run: `npm run desktop:check`  
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add desktop-pet/renderer/index.html desktop-pet/renderer/renderer.js desktop-pet/renderer/styles.css desktop-pet/renderer/pet.js package.json
git commit -m "feat: 桌宠欧洲广告日报表格与建议 UI"
```

---

### Task 7: 联调自检清单（手工）+ 文档勾选

**Files:**
- 无必须代码变更；若发现缺口只修最小 bug

- [ ] **Step 1: 跑单测**

Run: `node test/test-eu-ads-daily-report.js`  
Expected: 全部 ok

- [ ] **Step 2: 手工联调（本机有 `.env` 中 `YANJUN_MCP_URL`）**

1. `npm run desktop:start`
2. 临时把 `euAdsReport` 的 hour/minute 调到当前时间后 1 分钟，或托盘菜单临时加「立刻欧洲日报」按钮（若加了按钮，联调后可保留为调试入口，文案「拉取欧洲广告日报」）
3. 确认：通知弹出 → 窗内表格 15 行、7 日列、涨标 ↑ → 建议带「需你手动执行」
4. 确认 12:30 记任务仍可用
5. 去掉 `YANJUN_MCP_URL` 再刷新 → 提示「未配置领星网关」且不崩

- [ ] **Step 3: 若加了调试菜单，提交**

```bash
git add desktop-pet/main.js
git commit -m "feat: 桌宠托盘手动拉取欧洲广告日报"
```

（若未加菜单可跳过本 commit）

- [ ] **Step 4: 对照规格勾选**

规格 `docs/superpowers/specs/2026-09-01-desktop-pet-eu-ads-daily-report-design.md` 各条均有对应实现；本 plan 任务覆盖目标/非目标/表格/建议/失败处理。

---

## Spec coverage (self-review)

| 规格项 | 任务 |
|--------|------|
| 12:20 通知 + 汇报窗 | Task 5–6 |
| yanjun 拉欧洲 7 完整日 | Task 1, 4 |
| 国家·指标 × 日期 + ↑ | Task 2, 6 |
| 只读建议 3～5 条 | Task 3, 6 |
| 不改记任务 | Task 5–6（独立 key） |
| 部分失败 / 无网关 | Task 4–5 |
| 不自动改广告 | Global + Task 3 |

无 TBD/占位实现步骤；类型名在任务间一致：`fetchEuAdsDailyReport`、`buildReportMatrix`、`buildSuggestions`、`euAdsReport`。
