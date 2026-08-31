# 周复盘按冲刺开始日滚动

日期：2026-08-17  
状态：已确认设计，待实现

## 背景

周复盘现在用「今天所在自然周的周一」作为所有活跃冲刺的 `week_start_date`。打开复盘列表或定时任务到了周一，就给全部 ACTIVE 冲刺插入同一天。

冲刺以 7 天为一档，开始日经常不是周一（例如周三开）。按自然周一建档会把开始前的日期算进第一周，也和活动真实周期错位。

## 目标

1. 复盘周从该冲刺 `start_date` 起每 7 天一档，不再对齐自然周一
2. 保存 ACTIVE 冲刺时立刻建立「当前周」
3. 打开列表 / 定时任务按每个冲刺补当前周
4. ACTIVE 冲刺里错位的 PENDING 按新格子纠正；COMPLETED 不动

## 非目标

- 不改决策规则（CONTINUE / MAINTENANCE / STOPPED）
- 不改每日 TACOS、对照可视化、领星补缺天、广告优化生成正文
- 不改表结构（仍用 `weekly_reviews.week_start_date`）
- 不一次建齐周期内所有周，不补历史每一周
- 不改已完成复盘的日期
- 不把页面改成必须显示「周三～周二」文案（仍显示 `week_start_date`）

## 决策摘要

| 项 | 选择 |
|----|------|
| 切周 | `start_date + 7N`，连续 7 天 |
| 当前周 | 包含今天的那一档 |
| 未开始 | `today < start_date` 不建 |
| 结束日 | 不额外用 `end_date` 卡住当前周 |
| 创建时机 | 保存 ACTIVE 冲刺 + 列表 + 定时 |
| 旧 PENDING | 不在格子上的删除，再插入正确当前周 |
| 往期 PENDING | 日期已在格子上的保留 |
| COMPLETED | 一律不改 |

## 切周

`week_start = start_date + 7 × floor((today - start_date) / 7)`。

例：`start_date = 2026-08-12`（周三）。

| 今天 | 当前周起点 | 窗口 |
|------|------------|------|
| 08-12 ～ 08-18 | 08-12 | 周三～周二 |
| 08-19 ～ 08-25 | 08-19 | 下一档周三～周二 |

`today < start_date`：没有当前周，不插入。

复盘填报、领星补缺天、广告报表窗口仍用现有「`week_start` 起连续 7 天」；起点不再保证是周一。广告侧 `adsReportWindow` 已按 `start+6` 与昨天取 min，无需改成「日历周日」。

## 创建与纠正

对单个 ACTIVE 冲刺：

1. 算出当前周 `currentStart`；没有则结束
2. 删除该冲刺中 `status = PENDING` 且 `week_start_date` **不是** `start_date + 7N` 的行（错位的自然周一等）
3. `INSERT IGNORE` 当前周，`status = PENDING`

格子判定：`week_start_date >= start_date` 且 `(week_start_date - start_date) % 7 === 0`。  
格子上的往期 PENDING（上周没填完）保留。COMPLETED 不删不改日期。

触发：

- `POST` 新建 / 更新冲刺且结果为 ACTIVE：对该冲刺执行上述步骤
- `GET /api/reviews`：对全部 ACTIVE 冲刺执行
- `schedulerTick`：对全部 ACTIVE 冲刺执行；**不再**用全局设置 `weekly_review_generated_week` 的「自然周一变了才跑」作为唯一开关（否则周三开的冲刺要等到下个周一才建档）

非 ACTIVE 冲刺不新建、不纠正 PENDING。

## 错误与边界

| 情况 | 行为 |
|------|------|
| 冲刺未开始 | 不插入 |
| 当前周已存在 | `INSERT IGNORE`，不覆盖已填字段 |
| 错位 PENDING 与正确当前周同时存在 | 删错位行，留下/插入正确行 |
| 改了 `start_date` | 下次保存或打开列表时按新格子纠正 PENDING |
| COMPLETED 落在旧周一 | 保留，不当作错位 PENDING 删除 |

## 测试要点

- 周三开始、今天仍在第一档 → `week_start` 是周三不是周一
- 第 8 天 → 下一档起点
- 今天早于 `start_date` → 不建
- 错位 PENDING（周一）+ ACTIVE → 删除后插入正确当前周
- 格子上的往期 PENDING 保留
- COMPLETED 周一记录保留
- 保存冲刺为 ACTIVE 后库中有当前周

## 验收标准

1. 周三开始的冲刺，当前复盘周起始日是该周三（或其后第 7N 天），不是自然周一
2. 新建 ACTIVE 冲刺保存后立刻能在复盘列表看到当前周
3. 已完成复盘日期不变；未完成的错位周一记录被纠正
4. 决策、TACOS、领星补天、广告生成逻辑不改（窗口随 `week_start` 自然平移）
