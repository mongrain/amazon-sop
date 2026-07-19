# AI 办公室任务删除与重新处理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 办公室任务增加删除、任意状态重新处理，以及服务启动时自动恢复卡住的未完成任务。

**Architecture:** Service 层负责删库/重置字段；orchestration 负责 dispatch 与启动 resume；routes 暴露 DELETE/reprocess；前端列表与详情加操作按钮。复用现有 `dispatchAiOfficeTask`，不改表结构。

**Tech Stack:** Node.js Express, MySQL raw SQL, Vue 3

**Spec:** `docs/superpowers/specs/2026-07-20-ai-office-task-delete-reprocess-design.md`

## Global Constraints

- 删除级联子任务与日志（DB CASCADE）
- 手动 reprocess：任意状态；先删子任务，再重置为 QUEUED 后 dispatch
- 启动 resume：仅 QUEUED / IN_PROGRESS / PENDING_REVIEW；不动 DONE / FAILED
- 不引入新依赖；不改审核/agent 逻辑
- 未经用户要求不 git commit

---

## File Map

| 文件 | 职责 |
|------|------|
| `service/ai-office.js` | `deleteTask` / `reprocessTask` / `listStuckTasks` |
| `orchestration/ai-office/index.js` | `resumeStuckAiOfficeTasks`；导出 |
| `routes/page-api.js` | DELETE + POST reprocess |
| `server.js` | listen 后调用 resume |
| `frontend/src/views/AiOfficeView.js` | 列表操作列 |
| `frontend/src/views/AiOfficeTaskView.js` | 详情操作按钮 |

---

### Task 1: Service — delete / reprocess / listStuck

**Files:**
- Modify: `service/ai-office.js`

**Produces:**
- `deleteTask(id): Promise<boolean>` — false 表示不存在
- `reprocessTask(id): Promise<object|null>` — 重置后返回 task，不存在返回 null（不负责 dispatch）
- `listStuckTasks(): Promise<object[]>`

- [ ] **Step 1: 实现三个函数并导出**

```javascript
async function deleteTask(taskId) {
    const task = await getTaskById(taskId);
    if (!task) return false;
    await runSql('DELETE FROM ai_office_tasks WHERE id = ?', [taskId]);
    await refreshAgentStatuses();
    return true;
}

async function reprocessTask(taskId) {
    const task = await getTaskById(taskId);
    if (!task) return null;

    await runSql('DELETE FROM ai_office_tasks WHERE parent_task_id = ?', [taskId]);
    await runSql(`
        UPDATE ai_office_tasks SET
            status = 'QUEUED',
            output_markdown = NULL,
            review_comment = NULL,
            error_message = NULL,
            completed_at = NULL,
            retry_count = 0,
            updated_at = NOW()
        WHERE id = ?
    `, [taskId]);
    await appendLog(taskId, { log_type: 'system', content: '任务已重新处理' });
    await refreshAgentStatuses();
    return getTaskById(taskId);
}

async function listStuckTasks() {
    return listTasks({
        include_subtasks: true,
        // need status IN filter — implement dedicated query:
    });
}
```

实际 `listStuckTasks` 用专用 SQL：

```javascript
async function listStuckTasks() {
    const rows = await queryAll(`
        SELECT t.*, a.code AS agent_code, a.name AS agent_name, a.avatar_emoji AS agent_emoji
        FROM ai_office_tasks t
        LEFT JOIN ai_agents a ON t.assigned_agent_id = a.id
        WHERE t.status IN ('QUEUED','IN_PROGRESS','PENDING_REVIEW')
        ORDER BY t.id ASC
    `);
    return rows.map(enrichTask);
}
```

导出 `deleteTask`, `reprocessTask`, `listStuckTasks`。

- [ ] **Step 2: 自检** — 确认 `updateTaskStatus` 在 DONE/FAILED 时写 `completed_at`，重置路径必须显式清 `completed_at`（已在上方 SQL）。

---

### Task 2: Orchestration resume + Routes + Server boot

**Files:**
- Modify: `orchestration/ai-office/index.js`
- Modify: `routes/page-api.js`（ai-office 路由段末尾）
- Modify: `server.js`（`app.listen` 回调）

**Consumes:** `reprocessTask`, `listStuckTasks`, `deleteTask`, `checkParentCompletion`

- [ ] **Step 1: `resumeStuckAiOfficeTasks`**

```javascript
async function resumeStuckAiOfficeTasks() {
    const stuck = await aiOffice.listStuckTasks();
    if (!stuck.length) {
        console.log('[ai-office] no stuck tasks to resume');
        return { resumed: 0 };
    }

    let resumed = 0;
    const handled = new Set();

    for (const task of stuck) {
        if (handled.has(task.id)) continue;

        // Boss 父任务：子任务已全部 DONE 则只补关父任务
        if (!task.parent_task_id) {
            const detail = await aiOffice.getTaskDetail(task.id);
            const subs = (detail && detail.subtasks) || [];
            if (
                task.status === 'IN_PROGRESS' &&
                subs.length > 0 &&
                subs.every(s => s.status === 'DONE')
            ) {
                await aiOffice.checkParentCompletion(task.id);
                handled.add(task.id);
                resumed += 1;
                continue;
            }
        }

        const reset = await aiOffice.reprocessTask(task.id);
        if (!reset) continue;
        // reprocess 已删子任务，标记子 id 避免再处理
        for (const s of stuck) {
            if (s.parent_task_id === task.id) handled.add(s.id);
        }
        handled.add(task.id);
        dispatchAiOfficeTask(task.id);
        resumed += 1;
    }

    console.log(`[ai-office] resumed ${resumed} stuck task(s)`);
    return { resumed };
}

module.exports = { dispatchAiOfficeTask, executeAiOfficeTask, resumeStuckAiOfficeTasks };
```

- [ ] **Step 2: 路由**

```javascript
app.delete('/api/ai-office/tasks/:id', async (req, res) => {
    try {
        const ok = await aiOffice.deleteTask(Number(req.params.id));
        if (!ok) return res.status(404).json({ error: '任务不存在' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ai-office/tasks/:id/reprocess', async (req, res) => {
    try {
        const task = await aiOffice.reprocessTask(Number(req.params.id));
        if (!task) return res.status(404).json({ error: '任务不存在' });
        dispatchAiOfficeTask(task.id);
        res.json({ task });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
```

- [ ] **Step 3: server.js listen 回调内**

```javascript
const { resumeStuckAiOfficeTasks } = require('./orchestration/ai-office');
resumeStuckAiOfficeTasks().catch(err =>
    console.error('[ai-office] resume stuck failed', err)
);
```

---

### Task 3: Frontend 列表 + 详情

**Files:**
- Modify: `frontend/src/views/AiOfficeView.js`
- Modify: `frontend/src/views/AiOfficeTaskView.js`

- [ ] **Step 1: AiOfficeView — 操作列**

使用 `confirm()`（与项目其他页一致）：

```javascript
async function reprocessTask(task) {
    if (!confirm('确认重新处理任务「' + task.title + '」？将清除子任务与产出并重新执行。')) return;
    try {
        await http.post('/api/ai-office/tasks/' + task.id + '/reprocess');
        await loadData();
    } catch (e) {
        error.value = getApiError(e, '重新处理失败');
    }
}

async function deleteTask(task) {
    if (!confirm('确认删除任务「' + task.title + '」？子任务与日志将一并删除，不可恢复。')) return;
    try {
        await http.delete('/api/ai-office/tasks/' + task.id);
        await loadData();
    } catch (e) {
        error.value = getApiError(e, '删除失败');
    }
}
```

表头加「操作」列；每行两个按钮「重新处理」「删除」。

- [ ] **Step 2: AiOfficeTaskView — 同样两个操作**

删除成功：`router.push('/ai-office')`；重跑成功：`loadDetail()`。

需 `useRouter`。

---

### Task 4: 逻辑自检

- [ ] 删父任务后子任务与 logs 不存在
- [ ] reprocess 后 status=QUEUED，retry_count=0，有「任务已重新处理」日志，随后变为执行中
- [ ] 启动日志出现 `[ai-office] resumed N` 或 `no stuck tasks`
- [ ] DONE 任务不会被启动自动重跑

---

## Spec coverage

| Spec 要求 | Task |
|-----------|------|
| DELETE API + cascade | 1, 2 |
| POST reprocess 任意状态 | 1, 2 |
| Boss 清子任务再 QUEUED | 1 |
| 启动 resume 未完成三态 | 2 |
| 启动不动 DONE/FAILED | 2 |
| 前端列表/详情按钮 | 3 |
