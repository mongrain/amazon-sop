const { queryAll, queryOne, runSql } = require('../database');

const EXECUTABLE_CODES = ['boss', 'designer', 'analyst', 'researcher'];
const MAX_RETRIES = 3;

function parseJsonField(val) {
    if (val == null) return null;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch (e) {
        return null;
    }
}

function enrichTask(row) {
    if (!row) return null;
    return {
        ...row,
        context_json: parseJsonField(row.context_json),
        input_payload: parseJsonField(row.input_payload)
    };
}

async function listAgents() {
    const rows = await queryAll(`
        SELECT a.*,
            (SELECT COUNT(*) FROM ai_office_tasks t
             WHERE t.assigned_agent_id = a.id AND t.status IN ('QUEUED','IN_PROGRESS')) AS active_tasks,
            (SELECT COUNT(*) FROM ai_office_tasks t
             WHERE t.assigned_agent_id = a.id AND t.status = 'PENDING_REVIEW') AS pending_review_tasks
        FROM ai_agents a
        ORDER BY FIELD(a.code, 'boss', 'supervisor', 'designer', 'analyst', 'researcher')
    `);
    return rows.map(row => ({
        ...row,
        active_tasks: Number(row.active_tasks) || 0,
        pending_review_tasks: Number(row.pending_review_tasks) || 0
    }));
}

async function listTasks(filters = {}) {
    const where = [];
    const params = [];

    if (filters.status) {
        where.push('t.status = ?');
        params.push(filters.status);
    }
    if (filters.agent_id) {
        where.push('t.assigned_agent_id = ?');
        params.push(Number(filters.agent_id));
    }
    if (filters.parent_task_id !== undefined) {
        if (filters.parent_task_id === null) {
            where.push('t.parent_task_id IS NULL');
        } else {
            where.push('t.parent_task_id = ?');
            params.push(Number(filters.parent_task_id));
        }
    } else if (!filters.include_subtasks) {
        where.push('t.parent_task_id IS NULL');
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await queryAll(`
        SELECT t.*,
            a.code AS agent_code,
            a.name AS agent_name,
            a.avatar_emoji AS agent_emoji
        FROM ai_office_tasks t
        LEFT JOIN ai_agents a ON t.assigned_agent_id = a.id
        ${whereSql}
        ORDER BY t.created_at DESC
        LIMIT 200
    `, params);
    return rows.map(enrichTask);
}

async function getTaskById(taskId) {
    const row = await queryOne(`
        SELECT t.*,
            a.code AS agent_code,
            a.name AS agent_name,
            a.avatar_emoji AS agent_emoji
        FROM ai_office_tasks t
        LEFT JOIN ai_agents a ON t.assigned_agent_id = a.id
        WHERE t.id = ?
    `, [taskId]);
    return enrichTask(row);
}

function buildSubtasksSummaryMarkdown(subs) {
    return subs.map((s, i) => {
        const who = [s.agent_emoji, s.agent_name || s.agent_code || '员工'].filter(Boolean).join(' ');
        const body = s.output_markdown && String(s.output_markdown).trim()
            ? String(s.output_markdown).trim()
            : '（无产出）';
        return `## ${i + 1}. ${who} — ${s.title}\n\n${body}`;
    }).join('\n\n---\n\n');
}

async function finalizeParentTask(parentId, subs) {
    const summary = buildSubtasksSummaryMarkdown(subs);
    await updateTaskStatus(parentId, 'DONE', { output_markdown: summary });
    await appendLog(parentId, { log_type: 'system', content: '所有子任务已完成，已汇总产出并关闭父任务' });
    return getTaskById(parentId);
}

async function getTaskDetail(taskId) {
    let task = await getTaskById(taskId);
    if (!task) return null;

    let subtasks = await listTasks({ parent_task_id: taskId, include_subtasks: true });

    // 父任务：子任务已全部完成但未汇总时，补写产出并标记 DONE（兼容历史卡住数据）
    if (
        !task.parent_task_id &&
        subtasks.length > 0 &&
        subtasks.every(t => t.status === 'DONE') &&
        (task.status !== 'DONE' || !task.output_markdown)
    ) {
        task = await finalizeParentTask(task.id, subtasks);
        subtasks = await listTasks({ parent_task_id: taskId, include_subtasks: true });
    }

    const logs = await queryAll(`
        SELECT l.*, a.name AS agent_name, a.avatar_emoji AS agent_emoji
        FROM ai_office_task_logs l
        LEFT JOIN ai_agents a ON l.agent_id = a.id
        WHERE l.task_id = ?
        ORDER BY l.created_at ASC, l.id ASC
    `, [taskId]);

    return { task, agent: task.assigned_agent_id ? {
        id: task.assigned_agent_id,
        code: task.agent_code,
        name: task.agent_name,
        avatar_emoji: task.agent_emoji
    } : null, logs, subtasks };
}

async function getAgentByCode(code) {
    return queryOne('SELECT * FROM ai_agents WHERE code = ?', [String(code || '').trim()]);
}

async function createTask({
    title,
    description,
    assigned_agent_code,
    priority = 'NORMAL',
    context_json = { source: 'manual' },
    created_by = null,
    parent_task_id = null
}) {
    const code = String(assigned_agent_code || '').trim();
    if (!code) throw new Error('请选择指派的员工');
    if (code === 'supervisor') throw new Error('主管不接受普通任务指派，请指派给其他员工');

    const agent = await getAgentByCode(code);
    if (!agent) throw new Error('员工不存在: ' + code);
    if (!EXECUTABLE_CODES.includes(code)) throw new Error('该员工不可接收执行任务');

    const safeTitle = String(title || '').trim();
    if (!safeTitle) throw new Error('请填写任务标题');

    const safePriority = ['LOW', 'NORMAL', 'HIGH'].includes(priority) ? priority : 'NORMAL';
    const contextStr = JSON.stringify(context_json || { source: 'manual' });

    const result = await runSql(`
        INSERT INTO ai_office_tasks
            (title, description, context_json, created_by, assigned_agent_id, parent_task_id, status, priority)
        VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?)
    `, [
        safeTitle,
        description ? String(description).trim() : null,
        contextStr,
        created_by,
        agent.id,
        parent_task_id,
        safePriority
    ]);

    const taskId = result.insertId;
    await appendLog(taskId, { log_type: 'system', content: `任务已创建，指派给 ${agent.name}` });
    return getTaskById(taskId);
}

async function updateTaskStatus(taskId, status, extra = {}) {
    const fields = ['status = ?', 'updated_at = NOW()'];
    const params = [status];

    if (extra.output_markdown !== undefined) {
        fields.push('output_markdown = ?');
        params.push(extra.output_markdown);
    }
    if (extra.review_comment !== undefined) {
        fields.push('review_comment = ?');
        params.push(extra.review_comment);
    }
    if (extra.error_message !== undefined) {
        fields.push('error_message = ?');
        params.push(extra.error_message);
    }
    if (extra.retry_count !== undefined) {
        fields.push('retry_count = ?');
        params.push(extra.retry_count);
    }
    if (status === 'DONE' || status === 'FAILED') {
        fields.push('completed_at = NOW()');
    }

    params.push(taskId);
    await runSql(`UPDATE ai_office_tasks SET ${fields.join(', ')} WHERE id = ?`, params);
}

async function appendLog(taskId, { agent_id = null, log_type = 'system', content }) {
    await runSql(
        'INSERT INTO ai_office_task_logs (task_id, agent_id, log_type, content) VALUES (?, ?, ?, ?)',
        [taskId, agent_id, log_type, String(content || '')]
    );
}

async function refreshAgentStatuses() {
    const agents = await queryAll('SELECT id, code FROM ai_agents');
    for (const agent of agents) {
        let status = 'idle';
        if (agent.code === 'supervisor') {
            const reviewing = await queryOne(
                "SELECT COUNT(*) AS cnt FROM ai_office_tasks WHERE status = 'PENDING_REVIEW'"
            );
            status = Number(reviewing.cnt) > 0 ? 'reviewing' : 'idle';
        } else {
            const busy = await queryOne(
                "SELECT COUNT(*) AS cnt FROM ai_office_tasks WHERE assigned_agent_id = ? AND status IN ('QUEUED','IN_PROGRESS')",
                [agent.id]
            );
            status = Number(busy.cnt) > 0 ? 'busy' : 'idle';
        }
        await runSql('UPDATE ai_agents SET status = ?, updated_at = NOW() WHERE id = ?', [status, agent.id]);
    }
}

async function checkParentCompletion(parentId) {
    if (!parentId) return;
    const parent = await getTaskById(parentId);
    if (!parent) return;
    const subs = await listTasks({ parent_task_id: parentId, include_subtasks: true });
    if (subs.length > 0 && subs.every(t => t.status === 'DONE')) {
        if (parent.status !== 'DONE' || !parent.output_markdown) {
            await finalizeParentTask(parentId, subs);
        }
    }
}

async function deleteTask(taskId) {
    const task = await getTaskById(taskId);
    if (!task) return false;
    await runSql('DELETE FROM ai_office_tasks WHERE id = ?', [taskId]);
    await refreshAgentStatuses();
    return true;
}

async function resetTaskForReprocess(taskId) {
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
}

/**
 * 重新处理任务。
 * - 叶子任务：重置自身并返回待派发 id
 * - 有子任务的父任务：保留已 DONE 的子任务，仅重置并重派未完成子任务
 * @returns {{ task: object, dispatchIds: number[] } | null}
 */
async function reprocessTask(taskId) {
    const task = await getTaskById(taskId);
    if (!task) return null;

    const subs = await listTasks({ parent_task_id: taskId, include_subtasks: true });

    if (subs.length > 0) {
        const toRetry = subs.filter(s => s.status !== 'DONE');
        if (!toRetry.length) {
            await checkParentCompletion(taskId);
            await appendLog(taskId, { log_type: 'system', content: '子任务均已完成，无需重新处理' });
            await refreshAgentStatuses();
            return { task: await getTaskById(taskId), dispatchIds: [] };
        }

        const dispatchIds = [];
        for (const child of toRetry) {
            await resetTaskForReprocess(child.id);
            await appendLog(child.id, { log_type: 'system', content: '任务已重新处理' });
            dispatchIds.push(child.id);
        }

        await runSql(`
            UPDATE ai_office_tasks SET
                status = 'IN_PROGRESS',
                output_markdown = NULL,
                review_comment = NULL,
                error_message = NULL,
                completed_at = NULL,
                updated_at = NOW()
            WHERE id = ?
        `, [taskId]);
        await appendLog(taskId, {
            log_type: 'system',
            content: `已重新处理 ${dispatchIds.length} 个未完成子任务，已完成子任务保留`
        });
        await refreshAgentStatuses();
        return { task: await getTaskById(taskId), dispatchIds };
    }

    await resetTaskForReprocess(taskId);
    await appendLog(taskId, { log_type: 'system', content: '任务已重新处理' });
    await refreshAgentStatuses();
    return { task: await getTaskById(taskId), dispatchIds: [taskId] };
}

module.exports = {
    listAgents,
    listTasks,
    getTaskById,
    getTaskDetail,
    getAgentByCode,
    createTask,
    updateTaskStatus,
    appendLog,
    refreshAgentStatuses,
    checkParentCompletion,
    deleteTask,
    reprocessTask,
    EXECUTABLE_CODES,
    MAX_RETRIES,
    parseJsonField
};
