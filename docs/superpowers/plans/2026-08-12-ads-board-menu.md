# 广告看板菜单收敛与工单拆除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏将冲刺/每日填报收拢为可展开「广告看板」（冲刺广告、每日填报），并彻底拆除工单前后端与数据表。

**Architecture:** 仅改导航与文案，保留 `/sprints*`、`/metrics/manual` 路由与业务 CRUD。工单按方案 3 全链路删除：前端视图/路由/入口 → `/api/tickets*` 与上传接口 → `createTicket`/`runDailyTicketScan`/EXIT_EVAL 建单 → `DROP TABLE issue_tickets`。每日填报与 `runPostIngestionRules` 中的 insight 逻辑保留。

**Tech Stack:** Vue 3（`AppSidebar.vue` + Options API 视图）、Vue Router、Express（`server.js` / `routes/page-api.js`）、MySQL（`database.js`）

**Spec:** `docs/superpowers/specs/2026-08-12-ads-board-menu-design.md`

## Global Constraints

- 其它侧栏菜单顺序与内容不变
- 冲刺 URL 保持 `/sprints*`；用户可见文案「冲刺项目」→「冲刺广告」
- 侧栏子项：「冲刺广告」「每日填报」；页内每日填报标题保持「每日数据填报」
- 点「广告看板」：展开/收起，并默认跳转 `/sprints`
- `/sprints*`、`/reviews*`、`/metrics/manual` 时父级强制展开并高亮
- 不改冲刺/填报核心 CRUD；不改周复盘流程（仅去「查看工单」）；不改 AMC 广告
- 历史工单数据不备份、直接丢弃
- 仅在用户明确要求时 git commit（本计划 commit 步骤为可选）

## File Structure

| 文件 | 职责 |
|------|------|
| `frontend/src/components/AppSidebar.vue` | 可展开「广告看板」；去掉冲刺/填报/工单顶层入口 |
| `frontend/src/assets/style.css` | 子菜单缩进与展开样式 |
| `frontend/src/router/index.js` | 冲刺 title 文案；删除 tickets 路由与 import |
| `frontend/src/views/SprintsView.js` | 文案 + 去「查看工单」 |
| `frontend/src/views/SprintFormView.js` | 文案「冲刺广告」 |
| `frontend/src/views/ReviewsView.js` | 返回文案 + 去「查看工单」 |
| `frontend/src/views/MetricsManualView.js` | 去工单入口与文案 |
| `frontend/src/views/TicketsView.js` | 删除 |
| `frontend/src/views/TicketDetailView.js` | 删除 |
| `routes/page-api.js` | 删除 `fetchTicket` 与全部 `/api/tickets*` |
| `server.js` | 删除建单辅助、扫描、EXIT_EVAL 建单、上传路由 |
| `database.js` | `DROP TABLE IF EXISTS issue_tickets`；删除 CREATE |

---

### Task 1: 侧栏「广告看板」可展开菜单

**Files:**
- Modify: `frontend/src/components/AppSidebar.vue`
- Modify: `frontend/src/assets/style.css`（在 `.sidebar-nav a.active` 规则附近追加子菜单样式）

**Interfaces:**
- Consumes: `AppLayout.vue` 传入的 `active`（`sprints` | `metrics` | …）
- Produces: 侧栏组 `ads_board`；子链 `/sprints`、`/metrics/manual`；无工单顶层入口

- [ ] **Step 1: 改写 `AppSidebar.vue`**

用下面完整内容替换该文件（保留 header / 其它菜单 / 用户区；仅替换 nav 中冲刺/填报/工单为广告看板组）：

```vue
<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
    active: { type: String, default: '' },
    currentUser: { type: Object, default: null }
});
defineEmits(['logout']);

const router = useRouter();
const adsExpanded = ref(false);

const isAdsBoardActive = computed(() => props.active === 'sprints' || props.active === 'metrics');

watch(
    isAdsBoardActive,
    (on) => {
        if (on) adsExpanded.value = true;
    },
    { immediate: true }
);

function onAdsBoardClick() {
    adsExpanded.value = !adsExpanded.value;
    router.push('/sprints');
}
</script>

<template>
    <aside class="sidebar">
        <div class="sidebar-header">
            <h2>Amazon</h2>
            <p>OMC</p>
        </div>
        <nav class="sidebar-nav">
            <router-link to="/dashboard" :class="{ active: active === 'dashboard' }">产品看板</router-link>

            <div class="sidebar-group" :class="{ open: adsExpanded, active: isAdsBoardActive }">
                <button type="button" class="sidebar-group-toggle" :class="{ active: isAdsBoardActive }" @click="onAdsBoardClick">
                    <span>广告看板</span>
                    <span class="sidebar-group-caret">{{ adsExpanded ? '▾' : '▸' }}</span>
                </button>
                <div v-show="adsExpanded" class="sidebar-subnav">
                    <router-link to="/sprints" :class="{ active: active === 'sprints' }">冲刺广告</router-link>
                    <router-link to="/metrics/manual" :class="{ active: active === 'metrics' }">每日填报</router-link>
                </div>
            </div>

            <router-link to="/daily-rants" :class="{ active: active === 'daily_rants' }">碎碎念</router-link>
            <router-link to="/ai-office" :class="{ active: active === 'ai_office' }">AI 办公室</router-link>
            <router-link to="/annual-activities" :class="{ active: active === 'annual_activities' }">年度活动</router-link>
            <router-link to="/users" :class="{ active: active === 'users' }">人员管理</router-link>
            <router-link to="/competitors" :class="{ active: active === 'competitors' }">竞品库</router-link>
            <router-link to="/product-selection" :class="{ active: active === 'product_selection' }">选品分析</router-link>
            <router-link to="/data-collection" :class="{ active: active === 'data_collection' }">数据采集</router-link>
            <router-link to="/amc-ads" :class="{ active: active === 'amc_ads' }">AMC 广告</router-link>
            <router-link to="/product-elimination" :class="{ active: active === 'product_elimination' }">产品淘汰分析</router-link>
            <router-link to="/knowledge" :class="{ active: active === 'knowledge' }">焚诀库</router-link>
            <router-link to="/sop" :class="{ active: active === 'sop' }">SOP模板</router-link>
            <router-link to="/import" :class="{ active: active === 'import' }">导入数据</router-link>
        </nav>
        <div v-if="currentUser" class="sidebar-user">
            <div class="sidebar-user-name">{{ currentUser.name }}</div>
            <div class="sidebar-user-role">{{ currentUser.role }}</div>
            <button type="button" class="sidebar-logout-btn" @click="$emit('logout')">退出登录</button>
        </div>
    </aside>
</template>
```

- [ ] **Step 2: 追加侧栏子菜单 CSS**

在 `frontend/src/assets/style.css` 的 `.sidebar-nav a.active { ... }` 之后插入：

```css
.sidebar-group-toggle {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 12px 20px; color: var(--sidebar-text);
    background: transparent; border: none; border-left: 3px solid transparent;
    font-size: 14px; cursor: pointer; text-align: left;
}
.sidebar-group-toggle:hover { background: rgba(255,255,255,0.05); }
.sidebar-group-toggle.active {
    background: rgba(64,158,255,0.15); border-left-color: var(--primary); color: #fff;
}
.sidebar-group-caret { font-size: 12px; opacity: 0.7; }
.sidebar-subnav a { padding-left: 36px; font-size: 13px; }
```

- [ ] **Step 3: 静态验收**

Run（在仓库根目录，PowerShell）：

```powershell
Select-String -Path frontend/src/components/AppSidebar.vue -Pattern "工单看板|冲刺项目" -SimpleMatch
Select-String -Path frontend/src/components/AppSidebar.vue -Pattern "广告看板|冲刺广告|每日填报"
```

Expected: 第一条无匹配；第二条均有匹配。

浏览器：打开任意已登录页 → 侧栏见「广告看板」→ 点击展开可见两子项 → 点父级跳到 `/sprints` → 打开每日填报时父级保持展开且高亮。

- [ ] **Step 4: Commit（可选，仅当用户要求）**

```bash
git add frontend/src/components/AppSidebar.vue frontend/src/assets/style.css
git commit -m "feat: 侧栏增加可展开广告看板菜单"
```

---

### Task 2: 冲刺/填报文案与页面内工单入口清理

**Files:**
- Modify: `frontend/src/router/index.js`（sprints 相关 `meta.title`）
- Modify: `frontend/src/views/SprintsView.js`
- Modify: `frontend/src/views/SprintFormView.js`
- Modify: `frontend/src/views/ReviewsView.js`
- Modify: `frontend/src/views/MetricsManualView.js`

**Interfaces:**
- Consumes: Task 1 侧栏子链
- Produces: 用户可见「冲刺广告」；页面无工单跳转

- [ ] **Step 1: 更新路由 title**

在 `frontend/src/router/index.js`：

- `'冲刺项目'` → `'冲刺广告'`
- `'新建冲刺项目'` → `'新建冲刺广告'`
- `'编辑冲刺项目'` → `'编辑冲刺广告'`

（只改这三处 sprints 相关 title；暂不删 tickets 路由，留给 Task 3。）

- [ ] **Step 2: 更新 `SprintsView.js` 文案与操作列**

替换：

| 原文 | 新文 |
|------|------|
| `<h1>冲刺项目</h1>` | `<h1>冲刺广告</h1>` |
| `立项 -> 数据追踪 -> 规则诊断 -> 工单流转 -> 举证验收` | `立项 -> 数据追踪 -> 规则诊断 -> 周复盘` |
| `+ 新建冲刺项目` | `+ 新建冲刺广告` |
| `暂无冲刺项目` | `暂无冲刺广告` |

删除操作列中这一行：

```html
<a class="btn-sm" :href="'/tickets?asin=' + encodeURIComponent(sp.asin)">查看工单</a>
```

保留「编辑」「周复盘」。

- [ ] **Step 3: 更新 `SprintFormView.js`**

- `编辑冲刺项目` / `新建冲刺项目` → `编辑冲刺广告` / `新建冲刺广告`
- `← 返回冲刺项目` → `← 返回冲刺广告`

- [ ] **Step 4: 更新 `ReviewsView.js`**

- `← 返回冲刺项目` → `← 返回冲刺广告`
- 删除：`<a class="btn-sm" :href="'/tickets?asin=' + encodeURIComponent(r.asin)">查看工单</a>`

- [ ] **Step 5: 更新 `MetricsManualView.js`**

- `提交后会触发规则诊断与工单生成` → `提交后会触发规则诊断`
- 删除整行：`<router-link class="btn-sm" to="/tickets">查看工单看板</router-link>`
- 保留 `<h1>每日数据填报</h1>`

- [ ] **Step 6: 验收**

```powershell
Select-String -Path frontend/src/views/SprintsView.js,frontend/src/views/SprintFormView.js,frontend/src/views/ReviewsView.js,frontend/src/views/MetricsManualView.js,frontend/src/router/index.js -Pattern "冲刺项目|查看工单|工单看板|工单生成|工单流转"
```

Expected: 无匹配（`router/index.js` 里若仍有 `工单看板` title 属于 tickets 路由，Task 3 删除；本步允许该文件仍含 tickets 相关 title，但不得再有「冲刺项目」）。

更精确：

```powershell
Select-String -Path frontend/src/views/*.js,frontend/src/router/index.js -Pattern "冲刺项目"
Select-String -Path frontend/src/views/SprintsView.js,frontend/src/views/ReviewsView.js,frontend/src/views/MetricsManualView.js -Pattern "/tickets"
```

Expected: 第一条无匹配；第二条无匹配。

- [ ] **Step 7: Commit（可选）**

```bash
git add frontend/src/router/index.js frontend/src/views/SprintsView.js frontend/src/views/SprintFormView.js frontend/src/views/ReviewsView.js frontend/src/views/MetricsManualView.js
git commit -m "refactor: 冲刺改称冲刺广告并去掉页面工单入口"
```

---

### Task 3: 删除工单前端路由与视图

**Files:**
- Delete: `frontend/src/views/TicketsView.js`
- Delete: `frontend/src/views/TicketDetailView.js`
- Modify: `frontend/src/router/index.js`

**Interfaces:**
- Consumes: Task 2 已无页面内 `/tickets` 链接
- Produces: 前端无工单页面；访问 `/tickets` 落 SPA 兜底（非工单页）

- [ ] **Step 1: 从 router 移除 tickets**

在 `frontend/src/router/index.js`：

1. 删除：
   ```js
   import TicketsView from '@/views/TicketsView.js';
   import TicketDetailView from '@/views/TicketDetailView.js';
   ```
2. 删除 `layoutChildren` 中：
   ```js
   { path: 'tickets', name: 'tickets', component: TicketsView, meta: { active: 'tickets', title: '工单看板' } },
   { path: 'tickets/:id', name: 'ticket-detail', component: TicketDetailView, meta: { active: 'tickets', title: '工单详情' } },
   ```

- [ ] **Step 2: 删除视图文件**

```powershell
Remove-Item frontend/src/views/TicketsView.js, frontend/src/views/TicketDetailView.js
```

- [ ] **Step 3: 验收**

```powershell
Test-Path frontend/src/views/TicketsView.js
Test-Path frontend/src/views/TicketDetailView.js
Select-String -Path frontend/src/router/index.js -Pattern "tickets|TicketsView|TicketDetailView"
Select-String -Path frontend/src -Pattern "工单看板|/tickets" -SimpleMatch
```

Expected: 前两个 `False`；router 无匹配；`frontend/src` 无「工单看板」与 `/tickets`（若 `Select-String -SimpleMatch` 对多模式不支持，分两次搜）。

- [ ] **Step 4: Commit（可选）**

```bash
git add frontend/src/router/index.js
git add -u frontend/src/views/TicketsView.js frontend/src/views/TicketDetailView.js
git commit -m "refactor: 移除工单看板前端页面与路由"
```

---

### Task 4: 删除工单 HTTP API

**Files:**
- Modify: `routes/page-api.js`（删除约 `fetchTicket` 起至 `design-request` 路由结束、product-selection require 之前的整块）

**Interfaces:**
- Consumes: 无
- Produces: 无 `/api/tickets*` 处理器

- [ ] **Step 1: 定位并删除**

删除从：

```js
    async function fetchTicket(id) {
```

到（含）`app.post('/api/tickets/:id/design-request', ...)` 整个 handler 结束的 `});`，**不要**删掉紧随其后的：

```js
    const {
        createAnalysis: createProductSelectionAnalysis,
```

即删除这些路由/辅助：

- `fetchTicket`
- `GET /api/tickets`
- `GET /api/tickets/:id`
- `POST /api/tickets/:id/assign`
- `POST /api/tickets/:id/status`
- `POST /api/tickets/:id/design-request`

- [ ] **Step 2: 验收**

```powershell
Select-String -Path routes/page-api.js -Pattern "issue_tickets|/api/tickets|fetchTicket"
```

Expected: 无匹配。

- [ ] **Step 3: Commit（可选）**

```bash
git add routes/page-api.js
git commit -m "refactor: 移除工单 REST API"
```

---

### Task 5: 拆除 server 建单逻辑与上传接口

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: Task 4（API 已无）
- Produces: 填报后不再写工单；调度不再扫工单；无 `/tickets/:id/*` 上传

- [ ] **Step 1: 删除设计用户缓存与建单辅助**

删除：

```js
let cachedDefaultDesignUserId = null;
async function getDefaultDesignUserId() { ... }

async function ticketExists(...) { ... }

async function createTicket(...) { ... }
```

保留 `ensureWeeklyReviewsForActiveSprints` 与 `ensureInsight`。

- [ ] **Step 2: 清理 `runPostIngestionRules` 中 EXIT_EVAL 建单**

在 `runPostIngestionRules` 内，删除整段「亏损超线 → 查 `issue_tickets` → `createTicket(EXIT_EVAL)`」逻辑（约 `if (profitMargin !== null && maxLoss7d !== null) { ... }` 整块）。

**保留**其后的 `promoLimit` / `ensureInsight('GOOD_PERF', ...)` 块。

- [ ] **Step 3: 删除上传路由**

删除：

```js
app.post('/tickets/:id/design-asset', ...)
app.post('/tickets/:id/verify', ...)
```

- [ ] **Step 4: 删除 `runDailyTicketScan` 及其调度**

1. 删除整个 `async function runDailyTicketScan(targetDateStr) { ... }`
2. 在 `schedulerTick` 中删除：

```js
    const targetDateStr = toDateString(addDays(now, -1));
    const lastScan = await getSetting('daily_ticket_scan_date', '');
    if (lastScan !== targetDateStr && (now.getHours() > 0 || now.getMinutes() >= 10)) {
        await runDailyTicketScan(targetDateStr);
        await setSetting('daily_ticket_scan_date', targetDateStr);
    }
```

保留周复盘生成逻辑。

- [ ] **Step 5: 验收**

```powershell
Select-String -Path server.js -Pattern "issue_tickets|createTicket|ticketExists|runDailyTicketScan|getDefaultDesignUserId|/tickets/"
```

Expected: 无匹配。

确认 insight 仍在：

```powershell
Select-String -Path server.js -Pattern "ensureInsight|GOOD_PERF|runPostIngestionRules"
```

Expected: 均有匹配。

- [ ] **Step 6: Commit（可选）**

```bash
git add server.js
git commit -m "refactor: 移除工单自动生成与上传接口"
```

---

### Task 6: 删除 `issue_tickets` 表定义并 DROP

**Files:**
- Modify: `database.js`（原 `CREATE TABLE IF NOT EXISTS issue_tickets` 的 try/catch 块，约 361–389 行）

**Interfaces:**
- Consumes: Task 5（运行时不再读写该表）
- Produces: 启动迁移后库中无 `issue_tickets`

- [ ] **Step 1: 替换建表为 DROP**

将：

```js
    try {
        await p.query(`CREATE TABLE IF NOT EXISTS issue_tickets (
            ...
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }
```

替换为：

```js
    try {
        await p.query('DROP TABLE IF EXISTS issue_tickets');
    } catch (e) {
        // Silently skip
    }
```

- [ ] **Step 2: 验收**

```powershell
Select-String -Path database.js -Pattern "issue_tickets"
```

Expected: 仅出现在 `DROP TABLE IF EXISTS issue_tickets` 一行。

重启后端一次，确认启动无报错；若可连库：

```sql
SHOW TABLES LIKE 'issue_tickets';
```

Expected: 空结果。

- [ ] **Step 3: 全量回归清单**

1. 侧栏：仅「广告看板」承载冲刺/填报；无工单入口；其它菜单仍在  
2. `/sprints` 文案为冲刺广告；可新建/编辑；周复盘可进  
3. `/metrics/manual` 可提交；文案无工单  
4. `/tickets` 不是工单页；`GET /api/tickets` 404/无路由  
5. 产品看板、AMC 广告等其它模块可打开  

- [ ] **Step 4: Commit（可选）**

```bash
git add database.js
git commit -m "refactor: 启动时删除 issue_tickets 表"
```

---

## Spec Coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 侧栏可展开广告看板 + 两子项 | Task 1 |
| 去掉冲刺/填报/工单顶层入口 | Task 1 |
| 点广告看板跳 `/sprints` + 强制展开 | Task 1 |
| 冲刺文案 → 冲刺广告，URL 不变 | Task 2 |
| 去页面内工单入口与相关文案 | Task 2 |
| 删除 tickets 视图/路由 | Task 3 |
| 删除 `/api/tickets*` | Task 4 |
| 删除上传 + 建单 + 日扫 | Task 5 |
| DROP `issue_tickets` | Task 6 |
| 保留填报/insight、其它菜单 | Task 5–6 验收 |

无 TBD/占位；签名与路径与现网文件一致。
