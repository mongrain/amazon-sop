const { responsesCompletionJson } = require('../gpt');

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_AI_ATTEMPTS = 3;
const DESKTOP_PET_RESPONSES_MODEL = String(process.env.DESKTOP_PET_RESPONSES_MODEL || process.env.GPT_MODEL || '').trim();

const REVIEW_PROMPT = `你是一位务实的工作复盘助手。根据用户近 7 天的桌宠任务记录，生成一张中文周总结表。
只返回 JSON，不要 Markdown 或额外说明。格式：
{
  "period": "YYYY-MM-DD 至 YYYY-MM-DD",
  "rows": [
    { "topic": "工作主题", "progress": "本周进展（仅依据记录，不要编造）", "status": "进行中/已推进/待跟进", "nextAction": "下周可执行的一步" }
  ]
}
规则：按工作主题合并相近事项，最多 6 行；没有足够证据时写“待跟进”，不要推断完成；每个单元格简洁，限制在 45 个汉字内。`;

function normalizeRow(row = {}) {
    const statuses = new Set(['进行中', '已推进', '待跟进']);
    return {
        topic: String(row.topic || '未分类事项').trim().slice(0, 45),
        progress: String(row.progress || '未提供足够记录').trim().slice(0, 90),
        status: statuses.has(String(row.status || '').trim()) ? String(row.status).trim() : '待跟进',
        nextAction: String(row.nextAction || '确认下一步安排').trim().slice(0, 90)
    };
}

function isRetryableAiError(error) {
    const status = Number(error?.response?.status);
    return RETRYABLE_STATUS_CODES.has(status)
        || error?.code === 'ECONNRESET'
        || error?.code === 'ETIMEDOUT'
        || error?.code === 'ECONNABORTED';
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWeeklyReview(days = [], { chatFn = responsesCompletionJson, waitFn = wait } = {}) {
    const validDays = (Array.isArray(days) ? days : [])
        .map((day) => ({
            date: String(day?.date || '').trim(),
            entries: (Array.isArray(day?.entries) ? day.entries : [])
                .map((entry) => ({ time: String(entry?.time || '').trim(), content: String(entry?.content || '').trim() }))
                .filter((entry) => entry.content)
        }))
        .filter((day) => day.date && day.entries.length);

    if (!validDays.length) throw new Error('近 7 天没有可供 AI 总结的任务记录');

    const period = [validDays[0].date, validDays[validDays.length - 1].date].join(' 至 ');
    let result;
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
        try {
            result = await chatFn(REVIEW_PROMPT, JSON.stringify({ period, days: validDays }, { model: DESKTOP_PET_RESPONSES_MODEL || undefined }));
            break;
        } catch (error) {
            if (!isRetryableAiError(error) || attempt === MAX_AI_ATTEMPTS) {
                if (Number(error?.response?.status) === 503) {
                    throw new Error('AI 服务暂时不可用（503），已自动重试 3 次仍未恢复，请稍后再试');
                }
                throw error;
            }
            await waitFn(500 * attempt);
        }
    }
    const rows = (Array.isArray(result?.rows) ? result.rows : []).map(normalizeRow).filter((row) => row.topic).slice(0, 6);
    if (!rows.length) throw new Error('AI 未返回有效的周总结表格');
    return { period: String(result?.period || period).trim(), rows };
}

module.exports = { generateWeeklyReview, normalizeRow, isRetryableAiError };
