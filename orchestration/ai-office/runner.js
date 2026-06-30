const aiOffice = require('../../service/ai-office');
const boss = require('./agents/boss');
const supervisor = require('./agents/supervisor');
const { designer, analyst, researcher } = require('./agents/index');

const HANDLERS = { boss, designer, analyst, researcher };

async function runAgentTask(task, agent) {
    const handler = HANDLERS[agent.code];
    if (!handler) throw new Error('未知员工: ' + agent.code);

    if (agent.code === 'boss') {
        await handler.run(task, agent);
        return { type: 'boss' };
    }

    const output = await handler.run(task, agent);
    await aiOffice.updateTaskStatus(task.id, 'PENDING_REVIEW', { output_markdown: output });
    await aiOffice.appendLog(task.id, {
        agent_id: agent.id,
        log_type: 'agent',
        content: output
    });
    return { type: 'executor', output };
}

async function runSupervisorReview(taskId) {
    const detail = await aiOffice.getTaskDetail(taskId);
    if (!detail || !detail.task) return;

    const task = detail.task;
    if (task.status !== 'PENDING_REVIEW') return;

    await aiOffice.refreshAgentStatuses();

    const result = await supervisor.review(task, task.output_markdown);
    const supervisorAgent = await aiOffice.getAgentByCode('supervisor');

    if (result.approved) {
        await aiOffice.updateTaskStatus(taskId, 'DONE', { review_comment: result.comment });
        await aiOffice.appendLog(taskId, {
            agent_id: supervisorAgent ? supervisorAgent.id : null,
            log_type: 'review',
            content: '审核通过: ' + result.comment
        });
        if (task.parent_task_id) {
            await aiOffice.checkParentCompletion(task.parent_task_id);
        }
        return;
    }

    const retry = (Number(task.retry_count) || 0) + 1;
    if (retry >= aiOffice.MAX_RETRIES) {
        await aiOffice.updateTaskStatus(taskId, 'FAILED', {
            error_message: '审核打回次数超限',
            review_comment: result.comment
        });
        await aiOffice.appendLog(taskId, {
            agent_id: supervisorAgent ? supervisorAgent.id : null,
            log_type: 'review',
            content: '审核打回次数超限: ' + result.comment
        });
        return;
    }

    await aiOffice.updateTaskStatus(taskId, 'IN_PROGRESS', {
        review_comment: result.comment,
        retry_count: retry,
        output_markdown: null,
        error_message: null
    });
    await aiOffice.appendLog(taskId, {
        agent_id: supervisorAgent ? supervisorAgent.id : null,
        log_type: 'review',
        content: `打回（第 ${retry} 次）: ${result.comment}`
    });

    const { dispatchAiOfficeTask } = require('./index');
    dispatchAiOfficeTask(taskId);
}

module.exports = { runAgentTask, runSupervisorReview };
