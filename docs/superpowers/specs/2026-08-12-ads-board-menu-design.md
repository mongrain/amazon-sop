# 广告看板菜单收敛与工单拆除

日期：2026-08-12  
状态：已确认设计，待实现

## 背景

侧栏将「冲刺项目」「每日填报」「工单看板」并列为独立入口，与「广告运营」心智不符。需要把冲刺与填报收拢到「广告看板」下，并彻底移除工单能力。

## 目标

1. 侧栏去掉「冲刺项目」「每日填报」「工单看板」顶层入口
2. 新增可展开「广告看板」，下挂「冲刺广告」「每日填报」
3. 「冲刺项目」用户可见文案统一改为「冲刺广告」；路由 path 仍为 `/sprints*`
4. 工单：前端页面/路由/入口、后端 API、自动建单逻辑、`issue_tickets` 表一并拆除

## 非目标

- 不改其它侧栏菜单（产品看板、AMC 广告、人员管理等）
- 不改冲刺项目 / 每日填报的核心 CRUD 与业务表
- 不改周复盘流程（仅去掉「查看工单」入口；周复盘仍归属冲刺广告 `active: 'sprints'`）
- 不改 AMC 广告模块
- 不迁移或备份历史工单数据（按方案 3 直接丢弃）

## 决策摘要

| 项 | 选择 |
|----|------|
| 菜单范围 | 仅收敛冲刺/填报/工单三块，其它菜单保留 |
| 子模块交互 | 侧栏可展开子菜单 |
| 点「广告看板」 | 展开/收起；并默认跳转 `/sprints` |
| 冲刺 URL | 保留 `/sprints*`，只改文案 |
| 工单处理 | 方案 3：前后端 + 自动建单 + 表结构全部拆除 |

## 信息架构

### 侧栏

- 删除顶层：冲刺项目、每日填报、工单看板
- 新增可展开组：**广告看板**
  - **冲刺广告** → `/sprints`
  - **每日填报** → `/metrics/manual`
- 当前路由属于 `/sprints*`、`/reviews*`、`/metrics/manual` 时：父级强制展开且高亮
- 展开状态：归属广告看板时强制展开；其它情况由点击切换（不必依赖 localStorage）

### 路由与 meta

| 路径 | 标题（用户可见） | active |
|------|------------------|--------|
| `/sprints*` | 冲刺广告 / 新建冲刺广告 / 编辑冲刺广告 | `sprints` |
| `/reviews*` | 周复盘（不变） | `sprints` |
| `/metrics/manual` | 侧栏「每日填报」；页内标题保持「每日数据填报」 | `metrics` |
| `/tickets*` | **删除** | — |

侧栏父级标识：`ads_board`（仅侧栏展开/高亮用）。

## 前端改动

### `AppSidebar.vue` + `style.css`

- 实现广告看板可展开菜单；子项缩进，样式沿用现有 sidebar
- 去掉工单看板链接

### 文案

- `SprintsView` / `SprintFormView` / `ReviewsView` 等：「冲刺项目」→「冲刺广告」
- 冲刺页描述去掉「工单流转」表述

### 删除

- `frontend/src/views/TicketsView.js`
- `frontend/src/views/TicketDetailView.js`
- `router/index.js` 中 tickets 路由与 import

### 去掉工单入口

- `SprintsView`：「查看工单」
- `MetricsManualView`：「查看工单看板」及「工单生成」相关描述
- `ReviewsView`：「查看工单」

## 后端改动

### API / 上传

- 删除 `routes/page-api.js` 中全部 `/api/tickets*`
- 删除 `server.js` 中 `/tickets/:id/design-asset`、`/tickets/:id/verify`

### 自动建单

- 删除 `ticketExists`、`createTicket`
- 删除规则诊断中写入工单的分支：`CTR_LOW` / `CVR_LOW` / `ACOS_HIGH` / `RANK_DROP` / `EXIT_EVAL`
- **保留**每日填报提交与指标计算本身；只停掉「写工单」

### 数据

- `database.js`：不再 `CREATE TABLE issue_tickets`；启动时执行 `DROP TABLE IF EXISTS issue_tickets`
- 不保留历史工单数据

## 验收标准

1. 侧栏仅以「广告看板」承载原冲刺/填报入口，可展开看到「冲刺广告」「每日填报」；工单顶栏入口消失
2. 冲刺广告、每日填报功能与改造前一致，用户可见文案为「冲刺广告」
3. `/tickets`、`/api/tickets*` 不可用；填报后不再生成工单；库中无 `issue_tickets` 表（或已 drop）
4. 其它菜单与页面不受影响

## 风险与回滚

- 历史工单数据不可恢复；若需保留应在实现前先导出（本次明确不导出）
- 回滚：恢复侧栏三项、tickets 视图/路由、API 与建单逻辑，并重新建表（数据仍丢失）
