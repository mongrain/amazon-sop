const { chatCompletionJson } = require('../../../gpt');
const aiOffice = require('../../../service/ai-office');

async function review(task, outputMarkdown) {
    const supervisor = await aiOffice.getAgentByCode('supervisor');
    if (!supervisor) throw new Error('未找到主管员工');

    const userContent = [
        `任务标题：${task.title}`,
        `任务描述：${task.description || '（无）'}`,
        '',
        '--- 待审核产出 ---',
        outputMarkdown || '（无产出）'
    ].join('\n');

    const result = await chatCompletionJson(supervisor.system_prompt, userContent);
    return {
        approved: Boolean(result.approved),
        comment: String(result.comment || '').trim() || (result.approved ? '审核通过' : '需要修改')
    };
}

module.exports = { review };
