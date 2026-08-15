# 周复盘本周数据可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 周复盘填写页用独立组件展示 7 日订单/花费小柱和目标对照卡片（TACOS 只对推广期允许），不改 API 与保存/决策。

**Architecture:** 条宽/色调/日柱高度放 `frontend/src/utils/review-visual.js` 纯函数。`ReviewWeekVisual.js` 接收现有 `week`/`sprint` props 绘图。`ReviewFormView` 只替换原来的表+文字对照。

**Tech Stack:** Vue 3 + 现有 `style.css` 进度条类；测试用 `node test/*.js` + `assert`；不新增 npm 依赖。

## Global Constraints

- 不改 `GET /api/reviews/:id`、领星拉取、保存、决策规则、每日填报
- 不引入 echarts 等依赖
- 不改周复盘列表页
- TACOS 进度条只对 `promo_tacos_limit`；稳定期目标不画条
- 达标绿、未达标/超线红；条宽实际÷目标封顶 100%
- 越低越好超线标「已超」；越高越好未达标标「未达标」
- 目标缺：显示实际 +「目标未设」，条中性或不画满条
- CTR/CVR/CPC 实际有数才出卡片
- 花费/TACOS/日均单量始终出卡片

## File Structure

- Create: `frontend/src/utils/review-visual.js`
- Create: `test/test-review-visual.js`
- Create: `frontend/src/components/ReviewWeekVisual.js`
- Modify: `frontend/src/assets/style.css` — `.progress-fill.ok/.bad` 与周柱/对照卡片少量样式
- Modify: `frontend/src/views/ReviewFormView.js` — 引入组件，删除原两块展示

---

### Task 1: 可视化纯函数

**Files:**
- Create: `frontend/src/utils/review-visual.js`
- Test: `test/test-review-visual.js`

**Interfaces:**
- Produces:
  - `finiteOrNull(v)` → number 或 `null`；拒 `null`/`undefined`/`''`
  - `barPercent(actual, target)` → 0–100 或 `null`（target 非有限或 `<= 0` 时 null）
  - `compareTone(actual, target, higherBetter)` → `'ok' | 'bad' | 'neutral'`
  - `dayBarHeight(value, weekMax)` → 0–100
  - `weekMax(days, key)` → 已填天该 key 最大有限值，否则 0
- Dual export：`module.exports` + `export { ... }`，同 `frontend/src/utils/sprint-form-calc.js`

- [ ] **Step 1: Write the failing test**

创建 `test/test-review-visual.js`：

```javascript
const assert = require('assert');
const {
    finiteOrNull,
    barPercent,
    compareTone,
    dayBarHeight,
    weekMax
} = require('../frontend/src/utils/review-visual.js');

assert.strictEqual(finiteOrNull(null), null);
assert.strictEqual(finiteOrNull(''), null);
assert.strictEqual(finiteOrNull(0), 0);
assert.strictEqual(finiteOrNull('12.5'), 12.5);

assert.strictEqual(barPercent(50, 100), 50);
assert.strictEqual(barPercent(150, 100), 100);
assert.strictEqual(barPercent(80, 0), null);
assert.strictEqual(barPercent(80, null), null);
assert.strictEqual(barPercent(null, 100), null);

assert.strictEqual(compareTone(80, 70, false), 'bad');
assert.strictEqual(compareTone(14, 15, false), 'ok');
assert.strictEqual(compareTone(70, 70, false), 'ok');
assert.strictEqual(compareTone(5, 5, true), 'ok');
assert.strictEqual(compareTone(4, 5, true), 'bad');
assert.strictEqual(compareTone(8, 5, true), 'ok');
assert.strictEqual(compareTone(10, null, false), 'neutral');
assert.strictEqual(compareTone(null, 10, true), 'neutral');

assert.strictEqual(dayBarHeight(10, 20), 50);
assert.strictEqual(dayBarHeight(20, 20), 100);
assert.strictEqual(dayBarHeight(null, 20), 0);
assert.strictEqual(dayBarHeight(10, 0), 0);

assert.strictEqual(weekMax([
    { status: 'filled', orders: 3 },
    { status: 'filled', orders: 8 },
    { status: 'missing', orders: 99 }
], 'orders'), 8);
assert.strictEqual(weekMax([{ status: 'missing', orders: 1 }], 'orders'), 0);

console.log('ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-review-visual.js`

Expected: FAIL，`Cannot find module '../frontend/src/utils/review-visual.js'`

- [ ] **Step 3: Write minimal implementation**

创建 `frontend/src/utils/review-visual.js`：

```javascript
function finiteOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function barPercent(actual, target) {
    const a = finiteOrNull(actual);
    const t = finiteOrNull(target);
    if (a === null || t === null || t <= 0) return null;
    const pct = a / t * 100;
    return pct > 100 ? 100 : pct;
}

function compareTone(actual, target, higherBetter) {
    const a = finiteOrNull(actual);
    const t = finiteOrNull(target);
    if (a === null || t === null) return 'neutral';
    if (higherBetter) return a >= t ? 'ok' : 'bad';
    return a <= t ? 'ok' : 'bad';
}

function dayBarHeight(value, weekMax) {
    const v = finiteOrNull(value);
    const m = finiteOrNull(weekMax);
    if (v === null || m === null || m <= 0) return 0;
    const pct = v / m * 100;
    return pct > 100 ? 100 : pct;
}

function weekMax(days, key) {
    let max = null;
    for (const day of days || []) {
        if (!day || day.status !== 'filled') continue;
        const n = finiteOrNull(day[key]);
        if (n === null) continue;
        if (max === null || n > max) max = n;
    }
    return max === null ? 0 : max;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        finiteOrNull,
        barPercent,
        compareTone,
        dayBarHeight,
        weekMax
    };
}

export {
    finiteOrNull,
    barPercent,
    compareTone,
    dayBarHeight,
    weekMax
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-review-visual.js`

Expected: 打印 `ok`，exit 0

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/review-visual.js test/test-review-visual.js
git commit -m "feat: 周复盘对照进度条与日柱纯函数"
```

---

### Task 2: ReviewWeekVisual 组件 + 样式

**Files:**
- Create: `frontend/src/components/ReviewWeekVisual.js`
- Modify: `frontend/src/assets/style.css`（在 `.progress-fill` 规则后追加）

**Interfaces:**
- Consumes: `week`, `sprint` props；`barPercent`/`compareTone`/`dayBarHeight`/`weekMax`/`finiteOrNull`
- Produces: 本周小柱 + 7 天表 + 对照卡片。`week` 空或无 `days` 时根节点不渲染

在 `style.css` 的 `.progress-fill { ... }` 之后追加：

```css
.progress-fill.ok { background: var(--success); }
.progress-fill.bad { background: var(--danger); }
.review-week-legend { display: flex; gap: 16px; font-size: 12px; color: #606266; margin-bottom: 10px; }
.review-week-legend i { display: inline-block; width: 8px; height: 12px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.review-week-legend .lg-orders { background: var(--success); }
.review-week-legend .lg-spend { background: rgba(64, 158, 255, 0.45); }
.review-day-bars { display: flex; gap: 8px; align-items: flex-end; height: 88px; margin-bottom: 12px; }
.review-day-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; }
.review-twin { display: flex; gap: 3px; align-items: flex-end; height: 64px; width: 100%; justify-content: center; }
.review-twin span { display: block; width: 8px; min-height: 0; border-radius: 2px 2px 0 0; }
.review-twin .bar-orders { background: var(--success); }
.review-twin .bar-spend { background: rgba(64, 158, 255, 0.45); }
.review-day-label { font-size: 11px; color: #909399; margin-top: 4px; text-align: center; line-height: 1.3; }
.review-compare-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.review-compare-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.review-compare-name { font-size: 13px; color: #606266; margin-bottom: 6px; }
.review-compare-nums { font-size: 13px; color: #303133; margin-bottom: 8px; }
.review-tone-ok { color: var(--success); }
.review-tone-bad { color: var(--danger); }
.review-goal-text { font-size: 13px; color: #303133; margin-bottom: 12px; }
```

创建 `frontend/src/components/ReviewWeekVisual.js`：

```javascript
import { computed } from 'vue';
import {
    barPercent,
    compareTone,
    dayBarHeight,
    weekMax,
    finiteOrNull
} from '@/utils/review-visual.js';

function statusLabel(status) {
    if (status === 'filled') return '已填';
    if (status === 'missing') return '缺填';
    if (status === 'upcoming') return '未到';
    return '-';
}

function fmtVal(v) {
    return v === null || v === undefined || v === '' ? '-' : v;
}

function dateShort(ymd) {
    const s = String(ymd || '');
    return s.length >= 10 ? s.slice(5, 10) : s || '-';
}

function buildCard(name, actual, target, higherBetter, always) {
    const a = finiteOrNull(actual);
    if (!always && a === null) return null;
    const t = finiteOrNull(target);
    const tone = compareTone(a, t, higherBetter);
    let mark = '';
    if (t === null) mark = '目标未设';
    else if (tone === 'bad' && !higherBetter) mark = '已超';
    else if (tone === 'bad' && higherBetter) mark = '未达标';
    return {
        name,
        actualLabel: a === null ? '-' : a,
        targetLabel: t === null ? '目标未设' : t,
        mark,
        tone,
        pct: barPercent(a, t)
    };
}

export default {
    name: 'ReviewWeekVisual',
    props: {
        week: { type: Object, default: null },
        sprint: { type: Object, default: null }
    },
    setup(props) {
        const visible = computed(() => !!(props.week && Array.isArray(props.week.days)));
        const days = computed(() => (props.week && props.week.days) || []);
        const totals = computed(() => (props.week && props.week.totals) || {});
        const sprint = computed(() => props.sprint || {});

        const maxOrders = computed(() => weekMax(days.value, 'orders'));
        const maxSpend = computed(() => weekMax(days.value, 'ad_spend'));

        const dayBars = computed(() => days.value.map((d) => {
            const filled = d.status === 'filled';
            return {
                date: d.date,
                short: dateShort(d.date),
                status: statusLabel(d.status),
                ordersH: filled ? dayBarHeight(d.orders, maxOrders.value) : 0,
                spendH: filled ? dayBarHeight(d.ad_spend, maxSpend.value) : 0
            };
        }));

        const cards = computed(() => {
            const t = totals.value;
            const s = sprint.value;
            const list = [
                buildCard('花费 vs 7天最大亏损额度', t.actual_max_loss, s.max_loss_7d, false, true),
                buildCard('TACOS vs 推广期允许', t.actual_tacos, s.promo_tacos_limit, false, true),
                buildCard('日均单量 vs 目标', t.avg_daily_orders, s.target_daily_orders, true, true),
                buildCard('CTR(%) vs 目标', t.ctr, s.ctr_7d, true, false),
                buildCard('CVR(%) vs 目标', t.cvr, s.cvr_7d, true, false),
                buildCard('CPC vs 目标', t.cpc, s.cpc, false, false)
            ];
            return list.filter(Boolean);
        });

        return { visible, days, dayBars, cards, sprint, fmtVal, statusLabel };
    },
    template: `<div v-if="visible">
            <div class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">本周数据</div></div>
                <div class="module-body">
                    <div class="review-week-legend">
                        <span><i class="lg-orders"></i>订单</span>
                        <span><i class="lg-spend"></i>花费</span>
                    </div>
                    <div class="review-day-bars">
                        <div class="review-day-col" v-for="d in dayBars" :key="d.date">
                            <div class="review-twin">
                                <span class="bar-orders" :style="{ height: d.ordersH + '%' }"></span>
                                <span class="bar-spend" :style="{ height: d.spendH + '%' }"></span>
                            </div>
                            <div class="review-day-label">{{ d.short }}<br>{{ d.status }}</div>
                        </div>
                    </div>
                    <div class="table-container" style="max-height:none;">
                        <table class="product-table">
                            <thead>
                                <tr>
                                    <th>日期</th>
                                    <th>状态</th>
                                    <th>订单</th>
                                    <th>广告花费</th>
                                    <th>总销售额</th>
                                    <th>TACOS</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="d in days" :key="d.date">
                                    <td>{{ d.date }}</td>
                                    <td>{{ statusLabel(d.status) }}</td>
                                    <td>{{ fmtVal(d.orders) }}</td>
                                    <td>{{ fmtVal(d.ad_spend) }}</td>
                                    <td>{{ fmtVal(d.total_sales) }}</td>
                                    <td>{{ fmtVal(d.tacos) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">对照</div></div>
                <div class="module-body">
                    <div v-if="sprint.sprint_goal" class="review-goal-text">冲刺目标：{{ sprint.sprint_goal }}</div>
                    <div class="review-compare-grid">
                        <div class="review-compare-card" v-for="c in cards" :key="c.name">
                            <div class="review-compare-name">{{ c.name }}</div>
                            <div class="review-compare-nums">
                                实际 {{ c.actualLabel }}
                                <span v-if="c.targetLabel === '目标未设'"> · 目标未设</span>
                                <span v-else> / 目标 {{ c.targetLabel }}</span>
                                <span v-if="c.mark && c.mark !== '目标未设'" :class="'review-tone-' + c.tone"> {{ c.mark }}</span>
                            </div>
                            <div v-if="c.pct != null" class="progress-bar">
                                <div class="progress-fill" :class="c.tone" :style="{ width: c.pct + '%' }"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`
};
```

- [ ] **Step 1: 加 CSS 与 `ReviewWeekVisual.js`**
- [ ] **Step 2: Run** `node test/test-review-visual.js`

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ReviewWeekVisual.js frontend/src/assets/style.css
git commit -m "feat: 周复盘本周小柱与目标对照卡片组件"
```

---

### Task 3: 接入填写页

**Files:**
- Modify: `frontend/src/views/ReviewFormView.js`

**Interfaces:**
- Consumes: `ReviewWeekVisual`；现有 `week`/`sprint` refs
- Produces: 原「本周数据」表和「对照」文字块删除，改为组件；`statusLabel`/`fmtVal` 若页面不再使用则删除

在文件顶部、现有 import 之后增加：

```javascript
import ReviewWeekVisual from '@/components/ReviewWeekVisual.js';
```

在 `export default` 增加 `components: { ReviewWeekVisual }`（与 `name`/`setup` 并列）。

`setup` 的 `return` 去掉 `statusLabel, fmtVal`（若已无引用）。

把 template 里从 `<div v-if="week" class="module-card"` 到对照那整个 `module-card` 结束（含「本周数据」和「对照」两块）替换为：

```html
            <ReviewWeekVisual :week="week" :sprint="sprint" />
```

保留页头、错误、pullMsg、核对表单、保存。拉取/保存逻辑一行不改。

- [ ] **Step 1: 引入组件并替换两块展示**
- [ ] **Step 2: Run** `node test/test-review-visual.js` 以及 `node test/test-weekly-review.js`

Expected: 两处都打印 `ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/ReviewFormView.js
git commit -m "feat: 周复盘填写页接入本周可视化对照"
```

---

## 手工验收

1. 打开 PENDING 复盘：见 7 日订单/花费小柱和下面的表，数字一致
2. 花费超额度、TACOS 超推广期 → 红 +「已超」；日均单量达目标 → 绿
3. CTR/CVR/CPC 无实际则无对应卡片
4. 点领星拉取后柱和卡片随 week 更新
5. 核对/决策/保存/COMPLETED 无按钮，与改造前一致
