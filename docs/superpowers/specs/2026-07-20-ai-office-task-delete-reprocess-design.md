# AI 办公室任务：删除与重新处理

日期：2026-07-20  
状态：已确认设计，待实现

## 背景

AI 办公室任务执行依赖进程内 `setImmediate`。服务重启后，数据库中仍为 `QUEUED` / `IN_PROGRESS` / `PENDING_REVIEW` 的任务不会被重新派发，界面显示「执行中」但实际已假死。同时缺少删除与手动重跑能力。

## 目标

1. 支持删除任务（含子任务与日志级联删除）
2. 支持任意状态手动「重新处理」
3. 服务启动时自动恢复未完成的卡住任务（不自动重跑 `DONE` / `FAILED`）

## 非目标

- 不改 agent 角色、审核流程、表结构
- 不加批量删除、不加 reassign
- 不引入持久化队列或执行锁

## 决策摘要

| 项 | 选择 |
|----|------|
| 手动重跑范围 | 任意状态（含 `DONE` / `FAILED`） |
| 删除子任务 | 级联删除（DB CASCADE） |
| 启动恢复 | 自动恢复未完成态 + 前端手动重跑 |
| Boss 父任务重跑 | 先删旧子任务，再重置父任务为 `QUEUED` 后重派 |

## API

### `DELETE /api/ai-office/tasks/:id`

- 任意状态可删
- `DELETE FROM ai_office_tasks WHERE id = ?`（CASCADE 清子任务与 logs）
- 调用 `refreshAgentStatuses()`
- 写 system 日志无必要（记录已删）
- 404：任务不存在

### `POST /api/ai-office/tasks/:id/reprocess`

- 任意状态可重跑
- 流程：
  1. 若不存在 → 404
  2. 删除该任务下所有子任务（CASCADE / 显式 `DELETE WHERE parent_task_id = ?`）
  3. 重置字段：`status='QUEUED'`，`output_markdown` / `review_comment` / `error_message` / `completed_at` 置空，`retry_count=0`
  4. 追加 system 日志：`任务已重新处理`
  5. `refreshAgentStatuses()`
  6. `dispatchAiOfficeTask(id)`
  7. 返回更新后的 task

## Service / Orchestration

### `service/ai-office.js`

- `deleteTask(id)`：校验存在 → DELETE → refreshAgentStatuses
- `reprocessTask(id)`：校验存在 → 删子任务 → 重置字段 → appendLog → refreshAgentStatuses → 返回 task（dispatch 由路由或 orchestration 调用）
- `listStuckTasks()`：`status IN ('QUEUED','IN_PROGRESS','PENDING_REVIEW')`

### `orchestration/ai-office/index.js`

- `resumeStuckAiOfficeTasks()`：
  1. `listStuckTasks()`
  2. 对每条：若为根任务且所有子任务已 `DONE`，优先 `checkParentCompletion`；否则对该任务执行与手动重跑相同的重置逻辑后 `dispatch`（子任务本身若卡住则单独重置+dispatch）
  3. 简化实现（推荐）：对每条 stuck 任务调用与 `reprocessTask` 等价的重置（注意：子任务被父任务级联删除时勿重复处理），再 `dispatchAiOfficeTask`
  4. 仅启动时调用一次；**不**处理 `DONE`/`FAILED`

### 启动挂钩

在 `server.js` `app.listen` 回调（或 DB 就绪之后）调用：

```js
const { resumeStuckAiOfficeTasks } = require('./orchestration/ai-office');
resumeStuckAiOfficeTasks().catch(err => console.error('[ai-office] resume stuck failed', err));
```

## 前端

### 列表 `AiOfficeView`

- 操作列增加「重新处理」「删除」
- 均需二次确认（`ElMessageBox.confirm`）
- 成功后刷新列表；删除当前若在详情则跳回列表（仅详情页）

### 详情 `AiOfficeTaskView`

- 同样提供「重新处理」「删除」
- 删除成功 → `router.push('/ai-office')`
- 重新处理成功 → 刷新详情并继续轮询

## 状态与行为矩阵

| 场景 | 行为 |
|------|------|
| 删根任务 | 级联删子任务 + logs |
| 删子任务 | 只删该子任务 + 其 logs；父任务状态不变（若需父完成请手动重跑父或等其它子任务） |
| 手动重跑任意状态 | 清子任务 → `QUEUED` → dispatch |
| 启动恢复 | 仅未完成三态；清子/重置后 dispatch（或先尝试 parent completion） |
| 启动时已有 DONE/FAILED | 不动 |

## 风险与注意

- 手动重跑 `DONE` 会消耗 GPT 配额，依赖二次确认
- 启动批量恢复若卡住任务很多，可能瞬时并发较高；当前规模可接受，不做限流
- 删除 `IN_PROGRESS` 无法取消已在飞的 GPT 请求，仅清库；进程内旧回调结束后若仍写库，可能写到已删 id（应忽略/失败）——现有 update 按 id 更新，无行则无影响

## 验收

1. 列表/详情可删任务，子任务与日志一并消失
2. 任意状态点「重新处理」后变为执行中并产生新日志/输出
3. Boss 任务重跑不会残留旧子任务
4. 人为把任务留在 `IN_PROGRESS` 后重启服务，启动后自动继续执行
5. 已完成任务重启后不会被自动重跑
