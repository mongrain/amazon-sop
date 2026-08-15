# 周复盘：本周数据可视化与目标对照

日期：2026-08-15  
状态：已确认设计，待实现

## 背景

周复盘填写页已能展示该周 7 天日报，并用文字列出实际 vs 冲刺目标。对照不易扫读，本周走势也不直观。

## 目标

1. 「本周数据」用每日订单/花费小柱可视化，并保留 7 天表
2. 「对照」改成达成率卡片 + 进度条，一眼看出相对目标是达标还是超线/未达标
3. TACOS 进度条只对推广期允许 TACOS
4. 不引图表库；复用现有进度条样式

## 非目标

- 不改 `GET /api/reviews/:id`、领星拉取、保存、决策规则、每日填报
- 不引入 echarts 等依赖
- 不改周复盘列表页
- 不把稳定期 TACOS 画成进度条（决策仍用稳定期，只是卡片不画这条）

## 决策摘要

| 项 | 选择 |
|----|------|
| 可视化形态 | 对照卡片 + 进度条；本周 7 日订单/花费小柱 + 原表 |
| 组件 | 独立 `ReviewWeekVisual.js` |
| TACOS 对照 | 只对 `promo_tacos_limit` |
| 颜色 | 达标绿、未达标/超线红 |
| 条宽 | 实际÷目标，封顶 100%；超线数字旁标「已超」 |
| API | 不改，用现有 `week` / `sprint` |

## 架构

```text
ReviewFormView
  仍负责：拉取、建议预填、核对/决策表单、保存
  展示：<ReviewWeekVisual :week="week" :sprint="sprint" />

ReviewWeekVisual
  本周小柱（订单、花费）+ 7 天表 + 对照卡片

review-visual.js
  barPercent / compareTone / dayBarHeight 纯函数
```

拉取成功后 `week` 更新，组件随 props 重绘。

## 组件

| 单元 | 职责 | 依赖 |
|------|------|------|
| `frontend/src/utils/review-visual.js` | 条宽、色调、日柱高度 | 无 I/O |
| `frontend/src/components/ReviewWeekVisual.js` | 小柱、表、对照卡片 | week、sprint、review-visual、现有 CSS |
| `ReviewFormView.js` | 引入组件，删除原两块静态展示 | ReviewWeekVisual |

## 页面

仍用 `/reviews/:id`。

### 本周数据

- 7 根柱，对应 `week.days` 顺序（周一到周日）
- 每根：订单柱（实心 `--success`）、花费柱（浅色 `--primary` 半透明）并排
- 高度：该日数值 ÷ 本周已填天该指标最大值 × 100%；最大为 0 或该日非 `filled` 则为 0（空柱）
- 柱下标日期 MM-DD 与状态（已填/缺填/未到）
- 图例：订单、花费
- 下方保留现有 7 天表（日期、状态、订单、广告花费、总销售额、TACOS）

### 对照卡片

网格（约 3 列）。冲刺目标文案若有，放在卡片区上方。

每张卡片：指标名、实际、目标、进度条、色调。

| 卡片 | 实际 | 目标 | 方向 |
|------|------|------|------|
| 花费 | `week.totals.actual_max_loss` | `sprint.max_loss_7d` | 越低越好 |
| TACOS | `week.totals.actual_tacos` | `sprint.promo_tacos_limit` | 越低越好 |
| 日均单量 | `week.totals.avg_daily_orders` | `sprint.target_daily_orders` | 越高越好 |
| CTR | `week.totals.ctr` | `sprint.ctr_7d` | 越高越好，实际有数才出卡片 |
| CVR | `week.totals.cvr` | `sprint.cvr_7d` | 越高越好，实际有数才出卡片 |
| CPC | `week.totals.cpc` | `sprint.cpc` | 越低越好，实际有数才出卡片 |

花费 / TACOS / 日均单量始终出卡片（无数据则实际为 `-`）。

稳定期目标 TACOS、预算上限不画条。决策逻辑不变。

### 进度条与颜色

复用 `.progress-bar` / `.progress-fill`。fill 增加修饰类：`.progress-fill.ok` 用 `--success`，`.progress-fill.bad` 用 `--danger`。中性（目标未设）保持默认主色。

- `barPercent(actual, target)`：两者均为有限数字且 target > 0 时，`min(100, actual/target*100)`；否则 `null`（不画满条）
- `compareTone(actual, target, higherBetter)`：
  - 实际或目标非有限数字 → `neutral`
  - `higherBetter === true`：实际 ≥ 目标 → `ok`，否则 `bad`
  - `higherBetter === false`：实际 ≤ 目标 → `ok`，否则 `bad`
- `tone === 'bad'` 且越低越好时，数字旁标「已超」
- `tone === 'bad'` 且越高越好时，数字旁标「未达标」
- 目标缺：文案「目标未设」，不标已超/未达标

## 纯函数

`frontend/src/utils/review-visual.js`，同时 `module.exports` 与 `export`（同 `sprint-form-calc.js`）。

- `finiteOrNull(v)` → number 或 null（拒 `null`/`''`，避免 `Number(null)===0`）
- `barPercent(actual, target)` → number 0–100 或 null
- `compareTone(actual, target, higherBetter)` → `'ok' | 'bad' | 'neutral'`
- `dayBarHeight(value, weekMax)` → 0–100；value 非有限或 weekMax ≤ 0 → 0
- `weekMax(days, key)` → 已填天该 key 的最大有限值，没有则 0

## 接口

不改。组件 props：

```javascript
week: { type: Object, default: null }
sprint: { type: Object, default: null }
```

`week` 空或无 `days`：组件根节点不渲染。

## 错误与空态

| 情况 | 行为 |
|------|------|
| 无 week | 不渲染可视化 |
| 日非 filled | 该日双柱高度 0 |
| 本周 0 天日报 | 7 根空柱；花费/TACOS/单量卡片实际为 `-` |
| 目标未设 | 卡片显示实际 +「目标未设」，条中性或不画满条 |
| 领星拉取后 | `week` 更新，柱和卡片重绘 |

## 测试要点

- `barPercent`：50/100 → 50；150/100 → 100；目标 0 或空 → null
- `compareTone`：花费 80 vs 额度 70 且越低越好 → bad；14 vs 15 TACOS 越低越好 → ok；单量 5 vs 5 越高越好 → ok
- `dayBarHeight`：10 / 20 → 50；缺填 value null → 0
- 组件：ReviewFormView 含 `ReviewWeekVisual`；无原「对照」纯文字块（冲刺目标可在组件内）

## 验收标准

1. 填写页能看到 7 日订单/花费小柱，和下面的表对得上
2. 对照卡片能看出花费、TACOS（对推广期）、日均单量是绿还是红
3. CTR/CVR/CPC 有数才出卡片
4. 拉取领星后柱和卡片随 `week` 更新
5. 核对、决策、保存、COMPLETED 无拉取按钮，行为与现在一致

## 风险

- 进度条封顶 100%，超线只靠文案「已超」，不把条拉出容器
- TACOS 卡片对推广期，决策仍对稳定期，两处口径不同；卡片标题写明「推广期允许」以免误解
