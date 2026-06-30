const { chatCompletionText } = require('../../../gpt');

function buildUserContent(task) {
    const ctx = task.context_json ? JSON.stringify(task.context_json) : '{}';
    return `任务标题：${task.title}\n\n任务描述：${task.description || '（无）'}\n\n上下文：${ctx}`;
}

async function run(task, agent) {
    return chatCompletionText(agent.system_prompt, buildUserContent(task));
}

module.exports = { run, buildUserContent };
