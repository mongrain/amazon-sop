const aiOffice = require('../../service/ai-office');
const { runAgentTask, runSupervisorReview } = require('./runner');

function dispatchAiOfficeTask(taskId) {
    setImmediate(() => executeAiOfficeTask(taskId));
}

async function executeAiOfficeTask(taskId) {
    try {
        const detail = await aiOffice.getTaskDetail(taskId);
        if (!detail || !detail.task) return;

        const task = detail.task;
        if (!['QUEUED', 'IN_PROGRESS'].includes(task.status)) return;

        const agent = await aiOffice.getAgentByCode(task.agent_code);
        if (!agent) throw new Error('指派的员工不存在');

        await aiOffice.updateTaskStatus(taskId, 'IN_PROGRESS');
        await aiOffice.refreshAgentStatuses();

        const result = await runAgentTask(task, agent);

        if (result.type === 'boss') {
            await aiOffice.refreshAgentStatuses();
            return;
        }

        await aiOffice.refreshAgentStatuses();
        await runSupervisorReview(taskId);
    } catch (e) {
        console.error(`[ai-office] task ${taskId} failed:`, e);
        try {
            await aiOffice.updateTaskStatus(taskId, 'FAILED', {
                error_message: String(e.message || e)
            });
            await aiOffice.appendLog(taskId, {
                log_type: 'system',
                content: '执行失败: ' + (e.message || e)
            });
        } catch (updateErr) {
            console.error(`[ai-office] failed to mark task ${taskId} as FAILED:`, updateErr);
        }
    } finally {
        try {
            await aiOffice.refreshAgentStatuses();
        } catch (refreshErr) {
            console.error('[ai-office] refreshAgentStatuses error:', refreshErr);
        }
    }
}

module.exports = { dispatchAiOfficeTask, executeAiOfficeTask };
