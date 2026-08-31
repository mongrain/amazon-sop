# 周复盘按冲刺开始日滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 周复盘按冲刺 `start_date` 每 7 天一档建当前周，保存冲刺时立刻建档，并纠正错位的 PENDING。

**Architecture:** 切周与纠正计划做成 `weekly-review.js` 纯函数；单冲刺写库 `ensureSprintCurrentReview` 可注入 `queryAll`/`runSql`。`server.js` 对全部（或指定）ACTIVE 冲刺循环调用。路由保存冲刺、复盘列表、定时任务改接「今天」而不是自然周一。

**Tech Stack:** 现有 Node `assert` 测试；不新增 npm 依赖；不改表。

## Global Constraints

- 不改决策规则（CONTINUE / MAINTENANCE / STOPPED）
- 不改每日 TACOS、对照可视化、领星补缺天、广告优化生成正文
- 不改表结构（仍用 `weekly_reviews.week_start_date`）
- 不一次建齐周期内所有周，不补历史每一周
- 不改已完成复盘的日期
- 不把页面改成必须显示「周三～周二」文案
- `today < start_date` 不插入
- 不额外用 `end_date` 卡住当前周
- 提交信息用中文 `feat:`；不 `--no-verify`；不提交 `service/imagediff/` 与 `.superpowers/`

## File Structure

- Modify: `service/weekly-review.js` — 切周纯函数 + 可注入写库的 `ensureSprintCurrentReview`
- Modify: `test/test-weekly-review.js`
- Modify: `server.js` — `ensureWeeklyReviewsForActiveSprints(todayYmd, sprintId?)`；定时任务去掉自然周一钥匙
- Modify: `routes/page-api.js` — 保存 ACTIVE 冲刺后建当前周；列表用今天而不是周一

从当前 `main` 开 `feat/sprint-aligned-weekly-review` 再改，不要直接改 `main` 上的无关文件。

---

### Task 1: 按冲刺开始日计算当前周

**Files:**
- Modify: `service/weekly-review.js`
- Modify: `test/test-weekly-review.js`

**Interfaces:**
- Consumes: 现有 `toYmd`、`shiftYmd`
- Produces:
  - `ymdDiffDays(fromYmd, toYmd)` → 整数天数（`to - from`）；非法日期 `null`
  - `currentSprintWeekStart(startYmd, todayYmd)` → `'YYYY-MM-DD'` 或 `null`（`today < start` 或日期非法）
  - `isOnSprintWeekGrid(weekStartYmd, startYmd)` → `week >= start` 且相差天数 `% 7 === 0`
  - `planSprintReviewEnsure({ startYmd, todayYmd, pendingWeekStarts })` → `{ currentStart, deleteWeekStarts }`。`deleteWeekStarts` 为 PENDING 里不在格子上的 `YYYY-MM-DD`（去重、保持原顺序）

- [ ] **Step 1: Write the failing test**

在 `test/test-weekly-review.js` 顶部解构增加上述四个函数，在 `weekDateList` 断言后加入：

```javascript
const {
    toYmd,
    weekDateList,
    ymdDiffDays,
    currentSprintWeekStart,
    isOnSprintWeekGrid,
    planSprintReviewEnsure,
    buildWeekDays,
    datesToPull,
    countSkippedExisting,
    decideReview,
    buildSummary,
    buildSuggestion,
    assembleReviewPayload,
    mappedHasMetric,
    computeDerivedMetrics,
    applySuggestion,
    isEmptyField
} = require('../service/weekly-review');

assert.strictEqual(ymdDiffDays('2026-08-12', '2026-08-12'), 0);
assert.strictEqual(ymdDiffDays('2026-08-12', '2026-08-19'), 7);
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-12'), '2026-08-12');
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-18'), '2026-08-12');
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-19'), '2026-08-19');
assert.strictEqual(currentSprintWeekStart('2026-08-12', '2026-08-11'), null);
assert.strictEqual(isOnSprintWeekGrid('2026-08-12', '2026-08-12'), true);
assert.strictEqual(isOnSprintWeekGrid('2026-08-19', '2026-08-12'), true);
assert.strictEqual(isOnSprintWeekGrid('2026-08-10', '2026-08-12'), false);

const planned = planSprintReviewEnsure({
    startYmd: '2026-08-12',
    todayYmd: '2026-08-14',
    pendingWeekStarts: ['2026-08-10', '2026-08-12']
});
assert.strictEqual(planned.currentStart, '2026-08-12');
assert.deepStrictEqual(planned.deleteWeekStarts, ['2026-08-10']);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-weekly-review.js`

Expected: FAIL（未导出 `ymdDiffDays` / `currentSprintWeekStart`）

- [ ] **Step 3: Write minimal implementation**

在 `service/weekly-review.js` 的 `shiftYmd` 后增加：

```javascript
function ymdDiffDays(fromYmd, toYmd) {
    const from = toYmd(fromYmd);
    const to = toYmd(toYmd);
    if (!from || !to) return null;
    const a = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
    const b = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function currentSprintWeekStart(startYmd, todayYmd) {
    const start = toYmd(startYmd);
    const today = toYmd(todayYmd);
    if (!start || !today || today < start) return null;
    const n = ymdDiffDays(start, today);
    if (n == null) return null;
    return shiftYmd(start, Math.floor(n / 7) * 7);
}

function isOnSprintWeekGrid(weekStartYmd, startYmd) {
    const start = toYmd(startYmd);
    const week = toYmd(weekStartYmd);
    if (!start || !week || week < start) return false;
    const n = ymdDiffDays(start, week);
    return n != null && n % 7 === 0;
}

function planSprintReviewEnsure({ startYmd, todayYmd, pendingWeekStarts } = {}) {
    const currentStart = currentSprintWeekStart(startYmd, todayYmd);
    const deleteWeekStarts = [];
    const seen = new Set();
    for (const raw of pendingWeekStarts || []) {
        const w = toYmd(raw);
        if (!w || seen.has(w)) continue;
        seen.add(w);
        if (!isOnSprintWeekGrid(w, startYmd)) deleteWeekStarts.push(w);
    }
    return { currentStart, deleteWeekStarts };
}
```

`module.exports` 增加这四个函数。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-weekly-review.js`

Expected: `ok`

- [ ] **Step 5: Commit**

Message: `feat: 复盘周按冲刺开始日计算当前档`

---

### Task 2: 按格子纠正并插入当前周

**Files:**
- Modify: `service/weekly-review.js`
- Modify: `test/test-weekly-review.js`

**Interfaces:**
- Consumes: Task 1 的 `planSprintReviewEnsure`、`toYmd`
- Produces:
  - `async ensureSprintCurrentReview({ sprintId, startYmd, todayYmd, queryAll, runSql })`
    - `queryAll('SELECT week_start_date FROM weekly_reviews WHERE sprint_id = ? AND status = ?', [sprintId, 'PENDING'])`
    - 对 `deleteWeekStarts` 逐条 `runSql('DELETE FROM weekly_reviews WHERE sprint_id = ? AND status = ? AND week_start_date = ?', [sprintId, 'PENDING', date])`
    - 若 `currentStart` 非空：`runSql('INSERT IGNORE INTO weekly_reviews (sprint_id, week_start_date, status) VALUES (?, ?, ?)', [sprintId, currentStart, 'PENDING'])`
    - 不查询、不删除 `COMPLETED`

- [ ] **Step 1: Write the failing test**

在 `test/test-weekly-review.js` 解构增加 `ensureSprintCurrentReview`，在 Task 1 断言后、文件末尾 `console.log('ok')` 前改为 async IIFE（若文件仍是同步，把「ok」挪进 IIFE 末尾，先跑完全部同步断言）：

```javascript
(async () => {
    const sqls = [];
    await ensureSprintCurrentReview({
        sprintId: 12,
        startYmd: '2026-08-12',
        todayYmd: '2026-08-14',
        queryAll: async () => [
            { week_start_date: '2026-08-10' },
            { week_start_date: '2026-08-12' }
        ],
        runSql: async (sql, params) => { sqls.push({ sql, params }); }
    });
    assert.ok(sqls.some((s) => String(s.sql).includes('DELETE') && s.params[2] === '2026-08-10'));
    assert.ok(!sqls.some((s) => String(s.sql).includes('DELETE') && s.params[2] === '2026-08-12'));
    assert.ok(sqls.some((s) => String(s.sql).includes('INSERT IGNORE') && s.params[1] === '2026-08-12'));

    const none = [];
    await ensureSprintCurrentReview({
        sprintId: 12,
        startYmd: '2026-08-20',
        todayYmd: '2026-08-14',
        queryAll: async () => [{ week_start_date: '2026-08-10' }],
        runSql: async (sql, params) => { none.push({ sql, params }); }
    });
    assert.ok(none.some((s) => String(s.sql).includes('DELETE')));
    assert.ok(!none.some((s) => String(s.sql).includes('INSERT')));

    console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-weekly-review.js`

Expected: FAIL（未导出 `ensureSprintCurrentReview`）

- [ ] **Step 3: Write minimal implementation**

```javascript
async function ensureSprintCurrentReview({ sprintId, startYmd, todayYmd, queryAll, runSql }) {
    const rows = await queryAll(
        'SELECT week_start_date FROM weekly_reviews WHERE sprint_id = ? AND status = ?',
        [sprintId, 'PENDING']
    );
    const pendingWeekStarts = (rows || []).map((r) => r && r.week_start_date);
    const { currentStart, deleteWeekStarts } = planSprintReviewEnsure({
        startYmd, todayYmd, pendingWeekStarts
    });
    for (const date of deleteWeekStarts) {
        await runSql(
            'DELETE FROM weekly_reviews WHERE sprint_id = ? AND status = ? AND week_start_date = ?',
            [sprintId, 'PENDING', date]
        );
    }
    if (currentStart) {
        await runSql(
            'INSERT IGNORE INTO weekly_reviews (sprint_id, week_start_date, status) VALUES (?, ?, ?)',
            [sprintId, currentStart, 'PENDING']
        );
    }
}
```

导出 `ensureSprintCurrentReview`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-weekly-review.js`

Expected: `ok`

再跑：`node test/test-optimize-plan.js`、`node test/test-lingxing-ads-optimize.js`

Expected: `ok`

- [ ] **Step 5: Commit**

Message: `feat: 按冲刺格子纠正并插入当前周复盘`

---

### Task 3: 保存冲刺、列表、定时按冲刺周建档

**Files:**
- Modify: `server.js`
- Modify: `routes/page-api.js`

**Interfaces:**
- Consumes: Task 2 `ensureSprintCurrentReview`；现有 `queryAll`、`runSql`、`toDateString`
- Produces:
  - `ensureWeeklyReviewsForActiveSprints(todayYmd, sprintId?)`：查 `status = 'ACTIVE'`（可选 `AND id = ?`），对每条调用 `ensureSprintCurrentReview`
  - `GET /api/reviews` 调用 `ensureWeeklyReviewsForActiveSprints(toDateString(new Date()))`，不再 `getMondayStart`
  - `saveSprint` 在写入成功后：若 `status === 'ACTIVE'` 且有 `sprintId`（更新用入参 id；新建用 `insertId`），调用 `ensureWeeklyReviewsForActiveSprints(toDateString(new Date()), sprintId)`
  - `schedulerTick` 每轮调用 `ensureWeeklyReviewsForActiveSprints(toDateString(now))`，去掉 `weekly_review_generated_week` 与自然周一比较

- [ ] **Step 1: Rewrite ensure + scheduler**

`server.js` 顶部已有或改为：

```javascript
const {
    ensureSprintCurrentReview,
    toYmd: toYmdReview
} = require('./service/weekly-review');
```

（若已 `require('./service/weekly-review')`，只往解构里加这两个名字，不要重复 require。）

替换 `ensureWeeklyReviewsForActiveSprints`：

```javascript
async function ensureWeeklyReviewsForActiveSprints(todayYmd, sprintId) {
    const today = String(todayYmd || '').trim();
    if (!today) return;
    const params = [];
    let sql = "SELECT id, start_date FROM sprint_projects WHERE status = 'ACTIVE'";
    if (sprintId) {
        sql += ' AND id = ?';
        params.push(sprintId);
    }
    const sprints = await queryAll(sql, params);
    for (const sp of sprints || []) {
        await ensureSprintCurrentReview({
            sprintId: sp.id,
            startYmd: toYmdReview(sp.start_date),
            todayYmd: today,
            queryAll,
            runSql
        });
    }
}
```

`schedulerTick` 改为：

```javascript
async function schedulerTick() {
    if (!dbReady) return;
    const now = new Date();
    await ensureWeeklyReviewsForActiveSprints(toDateString(now));
}
```

- [ ] **Step 2: Wire routes**

`routes/page-api.js` 的 `GET /api/reviews`：

```javascript
            await ensureWeeklyReviewsForActiveSprints(toDateString(new Date()));
```

删掉该处 `getMondayStart` 调用。若解构后 `getMondayStart` 不再使用，从解构列表去掉。

`saveSprint` 在 INSERT/UPDATE 之后返回并建档：

```javascript
        let sprintId = id || null;
        if (id) {
            await runSql(
                `UPDATE sprint_projects SET
                 asin = ?, owner_id = ?, status = ?, start_date = ?, end_date = ?, target_cycle_days = ?,
                 current_daily_orders = ?, target_daily_orders = ?, current_rank = ?, target_rank = ?,
                 promo_tacos_limit = ?, stable_tacos_target = ?, max_loss_7d = ?, inventory_days = ?,
                 competitor_action = ?, page_ok = ?, exit_conditions = ?, profit_margin = ?, acos_limit = ?,
                 ctr_7d = ?, cvr_7d = ?, cpc = ?, required_impressions = ?, required_clicks = ?, budget_cap = ?,
                 sprint_goal = ?, sprint_keywords = ?, fba_warehouse_qty = ?,
                 updated_at = NOW()
                 WHERE id = ?`,
                [asin, ...values, id]
            );
        } else {
            const result = await runSql(
                `INSERT INTO sprint_projects
                 (asin, owner_id, status, start_date, end_date, target_cycle_days,
                  current_daily_orders, target_daily_orders, current_rank, target_rank,
                  promo_tacos_limit, stable_tacos_target, max_loss_7d, inventory_days,
                  competitor_action, page_ok, exit_conditions, profit_margin, acos_limit,
                  ctr_7d, cvr_7d, cpc, required_impressions, required_clicks, budget_cap,
                  sprint_goal, sprint_keywords, fba_warehouse_qty)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [asin, ...values]
            );
            sprintId = result && result.insertId;
        }
        if (status === 'ACTIVE' && sprintId) {
            await ensureWeeklyReviewsForActiveSprints(toDateString(new Date()), sprintId);
        }
```

UPDATE 分支的 SQL 文本必须与现有文件一致，只加 `sprintId` 与末尾 `ensure` 调用。

- [ ] **Step 3: Run tests**

```bash
node test/test-weekly-review.js
node test/test-optimize-plan.js
node test/test-lingxing-ads-optimize.js
node test/test-lingxing-metrics.js
node test/test-review-visual.js
```

Expected: 全部 `ok`

- [ ] **Step 4: Commit**

Message: `feat: 保存冲刺与定时任务按冲刺周建复盘`

---

## 验收对照

| 规格 | 任务 |
|------|------|
| `start_date + 7N` 当前周 | Task 1 |
| 未开始不建 | Task 1、2 |
| 错位 PENDING 删除、格子上往期保留 | Task 1、2 |
| COMPLETED 不删 | Task 2 只查 PENDING |
| 保存 ACTIVE 立刻建当前周 | Task 3 |
| 列表 / 定时按冲刺补当前周 | Task 3 |
| 去掉自然周一全局钥匙 | Task 3 |
