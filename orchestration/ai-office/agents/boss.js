const { chatCompletionJson } = require('../../../gpt');
const aiOffice = require('../../../service/ai-office');
const { buildUserContent } = require('./executor');

const VALID_SUB_AGENT_CODES = ['designer', 'analyst', 'researcher'];

async function run(task, agent) {
    const prompt = agent.system_prompt + '\n\n至少拆出 1 个子任务，agent_code 只能是 designer、analyst、researcher 之一。';
    const result = await chatCompletionJson(prompt, buildUserContent(task));
    const subtasks = Array.isArray(result.subtasks) ? result.subtasks : [];

    if (!subtasks.length) {
        throw new Error('老板未拆出任何子任务');
    }

    const { dispatchAiOfficeTask } = require('../index');
    let created = 0;

    for (const sub of subtasks) {
        const agentCode = String(sub.agent_code || '').trim();
        if (!VALID_SUB_AGENT_CODES.includes(agentCode)) continue;

        const child = await aiOffice.createTask({
            title: String(sub.title || '').trim() || task.title,
            description: String(sub.description || '').trim() || task.description,
            assigned_agent_code: agentCode,
            priority: task.priority,
            context_json: {
                ...(task.context_json || {}),
                boss_task_id: task.id
            },
            created_by: task.created_by,
            parent_task_id: task.id
        });
        dispatchAiOfficeTask(child.id);
        created += 1;
    }

    if (!created) {
        throw new Error('老板拆单结果无效，未创建任何子任务');
    }

    await aiOffice.appendLog(task.id, {
        agent_id: agent.id,
        log_type: 'agent',
        content: `已拆分为 ${created} 个子任务并自动分派`
    });
}

module.exports = { run };
