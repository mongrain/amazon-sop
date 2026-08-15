# 周复盘冲刺广告可执行优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成优化方案时用 yanjun 拉本周已启用、名称含 `{ASIN}-冲刺` 的活动/关键词/搜索词（含环比），裁样后让 GPT 写成复盘结论并立刻入库。

**Architecture:** 过滤、裁样、报表窗口、假调用拉包放 `service/lingxing-ads-optimize.js`。GPT 入参/提示词仍在 `service/weekly-review.js`，广告包作为参数，不再因已有结论跳过。路由拉包、调 GPT、只更新 `summary` 与 `optimization_plan`。页面去掉独立优化模块。

**Tech Stack:** 现有 `callYanjunTool`、`chatCompletionText`、`pickNumeric`；测试 `node test/*.js` + `assert`；不新增 npm 依赖。

## Global Constraints

- 不改决策规则（CONTINUE / MAINTENANCE / STOPPED）
- 不改周复盘领星补缺天、对照可视化、每日填报 TACOS、冲刺保存
- 不在领星里暂停、改价、上传广告（只出文字）
- 不把 yanjun / GPT token 暴露给浏览器
- `COMPLETED` 不生成
- 不打开页自动生成，不在「从领星拉取」日报后自动生成
- 不复用整店 `diagnose_yesterday_ads`
- 活动必须已启用，名称包含 `{ASIN}-冲刺`
- 生成成功立刻写 `summary` 与 `optimization_plan`（同一段）；有字再生成也覆盖
- 提交信息用中文 `feat:`；不 `--no-verify`；不提交 `service/imagediff/` 与 `.superpowers/`

## File Structure

- Create: `service/lingxing-ads-optimize.js` — 窗口、店、名称过滤、行映射、裁样、拉包
- Create: `test/test-lingxing-ads-optimize.js`
- Modify: `service/weekly-review.js` — 新提示词；用户 JSON 含广告包；去掉 skip
- Modify: `test/test-optimize-plan.js`
- Modify: `routes/page-api.js` — 拉包、写库、YANJUN 校验
- Modify: `frontend/src/views/ReviewFormView.js` — 结论区生成按钮，删优化建议模块

继续在 `feat/daily-tacos-weekly-optimize` 上改，不要开无关分支、不要改 `main`。

---

### Task 1: 冲刺广告过滤与裁样纯函数

**Files:**
- Create: `service/lingxing-ads-optimize.js`
- Test: `test/test-lingxing-ads-optimize.js`

**Interfaces:**
- Consumes: `pickNumeric`、`extractPerformanceList` from `service/lingxing-metrics.js`；`weekDateList`、`toYmd` from `service/weekly-review.js`
- Produces:
  - `adsReportWindow(weekStartYmd, todayYmd)` → `{ start, end }`。`end = min(周日, 昨天)`；若 `end < start` 则 `end = start`
  - `formatReportDate(start, end)` → `'YYYY-MM-DD - YYYY-MM-DD'`
  - `isSprintCampaignName(name, asin)` → 名称大写后包含 `{ASIN}-冲刺`
  - `isEnabledCampaign(row)` → `state`/`campaign_state` 为 `enabled`（忽略大小写）或缺失时不当作启用
  - `pickText(row, keys)` → 第一个非空字符串
  - `mapCampaignRow(row)` / `mapKeywordRow(row)` / `mapSearchTermRow(row)` → `{ id, name, match_type, spends, sales, orders, acos, cvr, ctr, acos_ring, cvr_ring, orders_ring, spends_ring, sales_ring }`（没有的键为 `null`；词/搜索词 `name` 为关键词或搜索词文本，`campaign_name` 另存）
  - `filterSprintCampaigns(rows, asin)` → 启用且名称匹配，按 `spends` 降序最多 8 条
  - `isWorseRing(row)` / `isHighConvert(row)`
  - `trimAdPack({ campaigns, keywords, search_terms })` → `{ campaigns, keywords, search_terms }` 去重后上限：高花费活动 5 / 词 8 / 搜索词 8；变差词 8 / 搜索词 8；高转化词 5 / 搜索词 5
  - `resolveUs50ProfileId(payload, sid='17438')` → 有限数字或 `null`

环比：`pickNumeric` 别名 `acos_ring`, `ring_acos`, `acos_wow`, `cvr_ring`, `ring_cvr`, `orders_ring`, `spends_ring`, `sales_ring`。花费：`spends`, `spend`, `cost`。ACOS/CVR/CTR：绝对值 `>1` 当百分数，否则 `toFormPercent`。

`isWorseRing`：ACOS 环比 `>0`，或 CVR 环比 `<0`，或订单环比 `<0`，或（花费环比 `>0` 且销售额环比 `<0`）。

`isHighConvert`：`orders > 0` 且（`acos != null && acos < 30` 或 `cvr != null && cvr > 10`）。

`resolveUs50ProfileId`：从 `extractPerformanceList` 或 `payload.data`/`payload.list`/`payload.shops` 取数组；`sid`/`store_id`/`seller_id` 等于 `'17438'`，或名称含 `50` 且国家 `US`/`USA`；取 `profile_id`/`profileId`。

- [ ] **Step 1: Write the failing test**

创建 `test/test-lingxing-ads-optimize.js`：

```javascript
const assert = require('assert');
const {
    adsReportWindow,
    formatReportDate,
    isSprintCampaignName,
    isEnabledCampaign,
    filterSprintCampaigns,
    isWorseRing,
    isHighConvert,
    trimAdPack,
    mapCampaignRow,
    resolveUs50ProfileId
} = require('../service/lingxing-ads-optimize');

assert.deepStrictEqual(adsReportWindow('2026-08-10', '2026-08-14'), {
    start: '2026-08-10', end: '2026-08-13'
});
assert.deepStrictEqual(adsReportWindow('2026-08-10', '2026-08-20'), {
    start: '2026-08-10', end: '2026-08-16'
});
assert.deepStrictEqual(adsReportWindow('2026-08-10', '2026-08-10'), {
    start: '2026-08-10', end: '2026-08-10'
});
assert.strictEqual(formatReportDate('2026-08-10', '2026-08-16'), '2026-08-10 - 2026-08-16');

assert.strictEqual(isSprintCampaignName('B0XX-冲刺-自动', 'b0xx'), true);
assert.strictEqual(isSprintCampaignName('B0XX-维护', 'B0XX'), false);
assert.strictEqual(isEnabledCampaign({ state: 'enabled' }), true);
assert.strictEqual(isEnabledCampaign({ state: 'paused' }), false);

const mapped = mapCampaignRow({
    campaign_id: 'c1',
    campaign_name: 'B0XX-冲刺',
    state: 'enabled',
    spends: 12,
    sales: 40,
    orders: 2,
    acos: 0.3
});
assert.strictEqual(mapped.id, 'c1');
assert.strictEqual(mapped.name, 'B0XX-冲刺');
assert.strictEqual(mapped.spends, 12);
assert.ok(mapped.acos > 20);

const filtered = filterSprintCampaigns([
    { campaign_id: 'a', campaign_name: 'B0XX-冲刺', state: 'enabled', spends: 5 },
    { campaign_id: 'b', campaign_name: 'B0XX-冲刺', state: 'paused', spends: 99 },
    { campaign_id: 'c', campaign_name: 'B0XX-维护', state: 'enabled', spends: 80 }
], 'B0XX');
assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].id, 'a');

assert.strictEqual(isWorseRing({ acos_ring: 2 }), true);
assert.strictEqual(isWorseRing({ cvr_ring: -1 }), true);
assert.strictEqual(isWorseRing({ spends_ring: 3, sales_ring: -1 }), true);
assert.strictEqual(isWorseRing({ acos_ring: -1, cvr_ring: 1 }), false);
assert.strictEqual(isHighConvert({ orders: 3, acos: 12 }), true);
assert.strictEqual(isHighConvert({ orders: 0, acos: 5 }), false);

const trimmed = trimAdPack({
    campaigns: [
        { id: '1', name: 'A', spends: 100 },
        { id: '2', name: 'B', spends: 90 },
        { id: '3', name: 'C', spends: 80 },
        { id: '4', name: 'D', spends: 70 },
        { id: '5', name: 'E', spends: 60 },
        { id: '6', name: 'F', spends: 50 }
    ],
    keywords: [
        { id: 'k1', name: 'bad', spends: 10, acos_ring: 5, orders: 1, acos: 80 },
        { id: 'k2', name: 'good', spends: 8, orders: 4, acos: 10 }
    ],
    search_terms: [
        { id: 's1', name: 'q1', spends: 9, cvr_ring: -2 }
    ]
});
assert.strictEqual(trimmed.campaigns.length, 5);
assert.ok(trimmed.keywords.some((k) => k.name === 'bad'));
assert.ok(trimmed.keywords.some((k) => k.name === 'good'));
assert.ok(trimmed.search_terms.some((s) => s.name === 'q1'));

assert.strictEqual(resolveUs50ProfileId({
    list: [{ sid: '17438', profile_id: 99, country: 'US', name: '50宴君' }]
}), 99);
assert.strictEqual(resolveUs50ProfileId({ list: [] }), null);

console.log('ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-lingxing-ads-optimize.js`

Expected: FAIL，找不到模块

- [ ] **Step 3: Write minimal implementation**

创建 `service/lingxing-ads-optimize.js`，实现上述导出。`weekDateList`/`toYmd` 从 `./weekly-review` 引入时注意：`weekly-review` 已 require `lingxing-metrics`，不要让 `lingxing-ads-optimize` 再被 `weekly-review` 顶层 require（避免环）。本任务本文件不要 require `weekly-review`：窗口用本地 `shiftYmd`（可从 `lingxing-metrics.previousCompleteDay` 的 `shiftYmd` 思路复制 10 行，或把 `weekDateList` 调用放到测试里用字面日期——实现里自己算周一+6）。

推荐：本文件自写 `shiftYmd`（与 `lingxing-metrics.js` 同款），`adsReportWindow` 内算 7 天。

`filterSprintCampaigns` 先 `mapCampaignRow` 再滤。`id` 用 `pickText` 的 `campaign_id`/`id`。

`trimAdPack` 用 `id` 或 `name` 去重；先高花费再变差再高转化，后加入不超过上限。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-lingxing-ads-optimize.js`

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add service/lingxing-ads-optimize.js test/test-lingxing-ads-optimize.js
git commit -F .superpowers/sdd/commit-msg.txt
```

Message: `feat: 冲刺广告名称过滤与报表裁样`

Windows 用 UTF-8 文件：`git commit -F .superpowers/sdd/commit-msg.txt`。不要提交 `.superpowers/`。

---

### Task 2: GPT 入参改为带广告包且始终覆盖

**Files:**
- Modify: `service/weekly-review.js`
- Modify: `test/test-optimize-plan.js`

**Interfaces:**
- Consumes: Task 1 的 `trimAdPack` 结果形状 `{ campaigns, keywords, search_terms }`
- Produces:
  - `OPTIMIZE_SYSTEM_PROMPT` 按 spec 替换（点名真实活动/词、换打法、变差词、高转化加码、不要改写决策、不编造）
  - `buildOptimizeUserContent({ review, sprint, week, suggestion, ads })` JSON 增加 `campaigns`/`keywords`/`search_terms`（缺省 `[]`）
  - `generateOptimizePlan` **删除**已有 `optimization_plan` 则 skip 的分支；每次调用 `chatFn`；成功 `{ summary, optimization_plan }` 为同一 trim 文本，无 `skipped`

- [ ] **Step 1: Write the failing test**

改 `test/test-optimize-plan.js`：

- `OPTIMIZE_SYSTEM_PROMPT` 断言改为包含 `换打法` 或 `不要编造`
- `buildOptimizeUserContent` 传入 `ads: { campaigns: [{ name: 'B0XX-冲刺' }], keywords: [], search_terms: [] }`，断言 JSON 含 `B0XX-冲刺` 与 `campaigns`
- 删除 skip 用例；改为「已有方案仍调用 chatFn」：

```javascript
    chatCalls = 0;
    const overwritten = await generateOptimizePlan({
        review: { asin: 'B0XX', optimization_plan: '已有方案' },
        sprint: {},
        week: optWeek,
        suggestion: { decision: 'CONTINUE' },
        ads: { campaigns: [], keywords: [], search_terms: [] },
        chatFn
    });
    assert.strictEqual(overwritten.summary, '- 控花费\n- 冲单量');
    assert.strictEqual(overwritten.optimization_plan, overwritten.summary);
    assert.strictEqual(chatCalls, 1);
```

空 GPT 仍 502。首次生成用例改为断言 `summary`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-optimize-plan.js`

Expected: FAIL（仍 skip 或提示词不含新字）

- [ ] **Step 3: Write minimal implementation**

替换 `OPTIMIZE_SYSTEM_PROMPT`：

```javascript
const OPTIMIZE_SYSTEM_PROMPT = [
    '你是亚马逊广告优化助手。根据提供的冲刺广告报表和本周日报，写出下一周可执行优化，作为复盘结论。',
    '要求：',
    '- 使用中文分条（每条一行，以 - 开头），每条带一句数据依据',
    '- 必须点名 JSON 中出现的活动名、投放词或搜索词',
    '- 覆盖：该换打法的（自动↔手动、广泛↔精确）、该降出价或暂停/否定的变差词、该加预算或出价的高转化词',
    '- 不要改写或否定规则建议决策（CONTINUE / MAINTENANCE / STOPPED）',
    '- 不要编造未出现的活动名、投放词或搜索词',
    '- campaigns/keywords/search_terms 为空时，写明未找到该 ASIN 已启用且名称含「ASIN-冲刺」的广告，不要编造',
    '- 只依据给定数据；缺数据就写明依据不足'
].join('\n');
```

`buildOptimizeUserContent` 增加：

```javascript
        campaigns: (ads && ads.campaigns) || [],
        keywords: (ads && ads.keywords) || [],
        search_terms: (ads && ads.search_terms) || []
```

`generateOptimizePlan`：去掉 `isEmptyField(existing)` 提前返回；`chatFn` 的 userContent 传入 `ads`；返回 `{ summary: plan, optimization_plan: plan }`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-optimize-plan.js`

Expected: `ok`

再跑：`node test/test-weekly-review.js`、`node test/test-lingxing-ads-optimize.js`

Expected: `ok`

- [ ] **Step 5: Commit**

Message: `feat: 周复盘优化结论改为覆盖生成并带入广告包`

---

### Task 3: yanjun 拉包并生成后写库

**Files:**
- Modify: `service/lingxing-ads-optimize.js` — `fetchSprintAdPack`
- Modify: `test/test-lingxing-ads-optimize.js`
- Modify: `routes/page-api.js`

**Interfaces:**
- Consumes: `callYanjunTool`；Task 1/2 函数
- Produces:
  - `async fetchSprintAdPack({ asin, weekStartYmd, todayYmd, callTool })` → `{ ads, profileId }`
    - `callTool('lingxing_ad_auth_shops', {})` → `resolveUs50ProfileId`；`null` 则 throw `status:400` `未找到50宴君北美广告店铺`
    - 活动：`lingxing_ad_campaign_report`，`report_date`、`profile_ids:[profileId]`、`asin`、`state:'enabled'`、`page:1`、`length:50`、`sort_field:'spends'`、`sort_type:'desc'`
    - `filterSprintCampaigns`；无匹配则 `{ ads: { campaigns:[], keywords:[], search_terms:[] }, profileId }`，不再拉词
    - 有匹配：`lingxing_ad_campaign_keyword_report`（`campaign_id` 为 id 数组，`with_ring:1`，同样分页排序）
    - `lingxing_ad_campaign_search_term_report`（`campaign_id`、`asin`、`with_ring:true`）
    - `trimAdPack`
  - 路由：未配 `YANJUN_MCP_URL` → 400 `未配置领星网关`；未配 `GPT_API_URL` 仍 400；COMPLETED 400 且不调用 `callTool`；成功 `UPDATE weekly_reviews SET summary=?, optimization_plan=?, updated_at=NOW() WHERE id=?`；响应 `{ summary, optimization_plan }`；不改决策与项目状态

- [ ] **Step 1: Write the failing test**

在 `test/test-lingxing-ads-optimize.js` 增加 `fetchSprintAdPack` 假 `callTool`：

```javascript
const { fetchSprintAdPack } = require('../service/lingxing-ads-optimize');

(async () => {
    const calls = [];
    const callTool = async (name, args) => {
        calls.push({ name, args });
        if (name === 'lingxing_ad_auth_shops') {
            return { list: [{ sid: '17438', profile_id: 77, country: 'US' }] };
        }
        if (name === 'lingxing_ad_campaign_report') {
            return { list: [
                { campaign_id: 'c1', campaign_name: 'B0XX-冲刺-自动', state: 'enabled', spends: 20 },
                { campaign_id: 'c2', campaign_name: 'B0XX-维护', state: 'enabled', spends: 99 }
            ] };
        }
        if (name === 'lingxing_ad_campaign_keyword_report') {
            return { list: [{ keyword_id: 'k1', keyword_text: 'gloves', spends: 5, orders: 2, acos: 15 }] };
        }
        if (name === 'lingxing_ad_campaign_search_term_report') {
            return { list: [{ query: 'work gloves', spends: 4, cvr_ring: -1 }] };
        }
        throw new Error('unexpected ' + name);
    };
    const pack = await fetchSprintAdPack({
        asin: 'B0XX',
        weekStartYmd: '2026-08-10',
        todayYmd: '2026-08-14',
        callTool
    });
    assert.strictEqual(pack.profileId, 77);
    assert.strictEqual(pack.ads.campaigns.length, 1);
    assert.strictEqual(pack.ads.campaigns[0].name.includes('冲刺'), true);
    assert.ok(calls.some((c) => c.name === 'lingxing_ad_campaign_keyword_report'));
    assert.deepStrictEqual(calls.find((c) => c.name === 'lingxing_ad_campaign_report').args.asin, 'B0XX');

    const emptyTool = async (name) => {
        if (name === 'lingxing_ad_auth_shops') return { list: [{ sid: '17438', profile_id: 77 }] };
        if (name === 'lingxing_ad_campaign_report') return { list: [] };
        throw new Error('should not fetch terms');
    };
    const empty = await fetchSprintAdPack({
        asin: 'B0XX', weekStartYmd: '2026-08-10', todayYmd: '2026-08-14', callTool: emptyTool
    });
    assert.deepStrictEqual(empty.ads.campaigns, []);
    console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
```

把文件原同步 `console.log('ok')` 挪进该 IIFE 末尾（先跑同步断言，再 await 拉包）。无 profile 时 throw 400 可加一条。

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-lingxing-ads-optimize.js`

Expected: FAIL，未导出 `fetchSprintAdPack`

- [ ] **Step 3: Implement fetch + route**

`fetchSprintAdPack` 用 `extractPerformanceList` 解析各报表。`callTool` 缺省 `require('./yanjun-mcp').callYanjunTool`。

`routes/page-api.js` 的 optimize-plan：

```javascript
            if (!String(process.env.YANJUN_MCP_URL || '').trim()) {
                return res.status(400).json({ error: '未配置领星网关' });
            }
            if (!String(process.env.GPT_API_URL || '').trim()) {
                return res.status(400).json({ error: '未配置 GPT_API_URL' });
            }
            const { fetchSprintAdPack } = require('../service/lingxing-ads-optimize');
            const pack = await fetchSprintAdPack({
                asin: bundle.review.asin,
                weekStartYmd: bundle.week.start,
                todayYmd: toDateString(new Date())
            });
            const { chatCompletionText } = require('../gpt');
            const result = await generateOptimizePlan({
                review: bundle.review,
                sprint: bundle.sprint,
                week: bundle.week,
                suggestion: bundle.suggestion,
                ads: pack.ads,
                chatFn: chatCompletionText
            });
            await runSql(
                'UPDATE weekly_reviews SET summary = ?, optimization_plan = ?, updated_at = NOW() WHERE id = ?',
                [result.summary, result.optimization_plan, id]
            );
            res.json(result);
```

COMPLETED 判断必须在拉包之前。保存接口：`optimization_plan` 改为与 `summary` 同一段：

```javascript
            const optimization_plan = summary;
```

（覆盖 body 里可能残留的旧 `optimization_plan`。）

- [ ] **Step 4: Run tests**

```bash
node test/test-lingxing-ads-optimize.js
node test/test-optimize-plan.js
node test/test-weekly-review.js
```

Expected: 全部 `ok`

- [ ] **Step 5: Commit**

Message: `feat: 生成优化结论时拉取冲刺广告并入库`

---

### Task 4: 复盘页只留结论并生成即覆盖

**Files:**
- Modify: `frontend/src/views/ReviewFormView.js`

**Interfaces:**
- Consumes: `{ summary, optimization_plan }`
- Produces: 无独立优化模块；生成覆盖 `form.summary`；提示「已生成并保存」

- [ ] **Step 1: UI**

- `form` 去掉 `optimization_plan`；`hydrateReview` 不再赋该字段
- `generateOptimizePlan`：去掉「已有则 return」；成功 `form.summary = data.summary || data.optimization_plan || ''`；`optimizeMsg = '已生成并保存'`
- 删除「优化建议」整块
- 在「复盘结论记录」label 行放按钮（PENDING 才显示）：

```html
                        <div style="margin-top:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;">
                                <div style="font-size:13px; color:#606266;">复盘结论记录 *</div>
                                <button
                                    v-if="review.status !== 'COMPLETED'"
                                    class="btn-secondary"
                                    type="button"
                                    :disabled="generating || saving || pulling"
                                    @click="generateOptimizePlan"
                                >{{ generating ? '生成中...' : '生成优化方案' }}</button>
                            </div>
                            <div v-if="optimizeMsg" style="font-size:13px; color:#606266; margin-bottom:8px;">{{ optimizeMsg }}</div>
                            <textarea v-model="form.summary" class="sop-remark" rows="8" required></textarea>
                        </div>
```

不要在 `loadReview` / `pullLingxing` 里调生成。保存仍 `{ ...form }`（无 optimization_plan 时由服务端用 summary 同步）。

- [ ] **Step 2: 回归**

```bash
node test/test-lingxing-ads-optimize.js
node test/test-optimize-plan.js
node test/test-weekly-review.js
node test/test-lingxing-metrics.js
node test/test-review-visual.js
```

Expected: 全部 `ok`

- [ ] **Step 3: Commit**

Message: `feat: 周复盘结论区生成冲刺广告优化并即时保存`

---

## 验收对照

| 规格 | 任务 |
|------|------|
| `{ASIN}-冲刺` + enabled 过滤 | Task 1、3 |
| 活动/关键词/搜索词 + 环比裁样 | Task 1、3 |
| GPT 点名真实词、换打法 | Task 2 |
| 覆盖已有结论 | Task 2、4 |
| 生成立刻写 summary + optimization_plan | Task 3 |
| 页面只留结论 | Task 4 |
| COMPLETED / 未配网关不写库 | Task 3 |
| 无匹配活动仍 GPT | Task 2、3 |
