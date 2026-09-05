require('dotenv').config();
const axios = require('axios');
const { handler } = require('./service/imagediff');
const { perceptualHashCompare } = require('./service/image-phash');

const GPT_API_URL = process.env.GPT_API_URL || 'http://localhost:8000/v1/chat/completions';
const GPT_API_KEY = process.env.GPT_API_KEY || 'eb3bf85f539499df36e2eec15669d57e';
const GPT_MODEL = process.env.GPT_MODEL || 'doubao';

function deriveResponsesApiUrl(chatCompletionsUrl) {
    const url = String(chatCompletionsUrl || '').trim().replace(/\/+$/, '');
    if (url.endsWith('/chat/completions')) return `${url.slice(0, -'/chat/completions'.length)}/responses`;
    return `${url}/responses`;
}

const GPT_RESPONSES_API_URL = String(process.env.GPT_RESPONSES_API_URL || '').trim()
    || deriveResponsesApiUrl(GPT_API_URL);

const COMPARE_PROMPT = '你是一位精通亚马逊店铺（Storefront）视觉分析的专家。我将按顺序提供同一店铺的两张主页截图：第一张是「历史快照」（上次监控），第二张是「最新快照」（本次监控）。请对比二者，判断该商家是否针对大促或特定节日活动进行了店面装修或营销模块调整。\n【分析核心原则：抓大放小】\n1. 严格忽略：由于网络加载延迟、图片或商品元素未完全加载（如发灰/空白占位符）、字体渲染差异、响应式排布微调导致的非实质性视觉差异。\n2. 专注于：实质性的营销视觉物料、大促氛围和模块布局的变动。\n【大促/节日信号侦测重点】\n- 横幅（Banner）变动：是否更换了横幅？是否融入了特定的促销或节日元素（例如：Prime Day 元素、复活节 Easter、黑色星期五 Black Friday 等）。\n- 促销模块增减：是否在店铺首页显著位置增加了促销专区、限时抢购模块或变更了主推品。\n这里客观性非常重要，如果想都是同一个节日元素（如圣诞节），均认为同一种状态\n【输出表述要求】\nchange_details 与 summary 中禁止使用「图A」「图B」等技术代号；如需指代图片，只能使用「历史快照」「最新快照」，或直接描述从历史到最新发生了什么变化。\n【输出格式要求】\n必须直接返回一个标准的 JSON 对象，不要包含任何 Markdown 格式标记（如 ```json）或前后解释性文本。JSON 结构如下：\n{\n  "is_changed": true,\n  "promotion_type": "Prime Day / Easter / None",\n  "change_details": [\n    "具体变动点1（如：最新快照更换了首页顶部横幅，增加了复活节彩蛋与折扣文案）"\n  ],\n  "summary": "此处填写修改内容的精简总结。必须严格控制在 50 个汉字以内。"\n}';

function parseGptJsonContent(content) {
    const raw = String(content || '').trim();
    if (!raw) throw new Error('GPT 返回内容为空');

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = (fenced ? fenced[1] : raw).trim();
    return JSON.parse(jsonText);
}

// api 模式，调用 GPT 的 API 接口
async function compareStorefrontImagesByApi(imageUrlA, imageUrlB) {
    const payload = {
        model: GPT_MODEL,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: COMPARE_PROMPT },
                    { type: 'image_url', image_url: { url: imageUrlA } },
                    { type: 'image_url', image_url: { url: imageUrlB } }
                ]
            }
        ],
        stream: false
    };

    console.log('GPT_API_URL', GPT_API_URL);
    console.log('GPT_API_KEY', GPT_API_KEY);
    console.log('payload', payload);

    const response = await axios.post(GPT_API_URL, payload, {
        headers: {
            Authorization: `Bearer ${GPT_API_KEY}`,
            'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity
    });

    const content = response.data && response.data.choices && response.data.choices[0]
        ? response.data.choices[0].message && response.data.choices[0].message.content
        : null;
    const parsed = parseGptJsonContent(content);

    return {
        is_changed: Boolean(parsed.is_changed),
        promotion_type: String(parsed.promotion_type || 'None'),
        change_details: Array.isArray(parsed.change_details) ? parsed.change_details : [],
        summary: String(parsed.summary || '').trim()
    };
}

/**
 * 破解版模式 sider ai
 * @param {*} imageUrlA 
 * @param {*} imageUrlB 
 */
async function compareStorefrontImagesBySiderAi(imageUrlA, imageUrlB) {
    const result = await handler(imageUrlA, imageUrlB);
    return result;
}

function unchangedResult() {
    return {
        is_changed: false,
        promotion_type: 'None',
        change_details: [],
        summary: ''
    };
}

async function compareStorefrontImages(imageUrlA, imageUrlB) {
    try {
        const threshold = Number(process.env.STOREFRONT_PHASH_THRESHOLD || 10);
        const pre = await perceptualHashCompare(imageUrlA, imageUrlB, { threshold });
        console.log('感知哈希预筛', { distance: pre.distance, threshold: pre.threshold, similar: pre.similar });
        if (pre.similar) {
            return unchangedResult();
        }
    } catch (err) {
        console.warn('感知哈希预筛失败，按无修改处理', err.message || err);
        return unchangedResult();
    }
    return compareStorefrontImagesBySiderAi(imageUrlA, imageUrlB);
}

async function chat(messages, { model = GPT_MODEL } = {}) {
    const payload = {
        model,
        messages,
        stream: false
    };

    const response = await axios.post(GPT_API_URL, payload, {
        headers: {
            Authorization: `Bearer ${GPT_API_KEY}`,
            'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity,
        timeout: Number(process.env.GPT_TIMEOUT_MS || 500000)
    });

    const data = response.data;
    if (data && data.code !== undefined && data.code !== 0) {
        throw new Error(data.message || 'GPT 请求失败');
    }

    const content = data && data.choices && data.choices[0]
        ? data.choices[0].message && data.choices[0].message.content
        : null;
    if (!content) {
        throw new Error('GPT 返回内容为空');
    }
    return content;
}

async function chatCompletionJson(userPrompt, userContent, { model = GPT_MODEL } = {}) {
    const content = await chat([{ role: 'user', content: `${userPrompt}\n\n${userContent}` }], { model });
    return parseGptJsonContent(content);
}

async function chatCompletionText(systemPrompt, userContent, { model = GPT_MODEL } = {}) {
    const content = await chat([{ role: 'user', content: `${systemPrompt}\n\n${userContent}` }], { model });
    return String(content).trim();
}

function getResponsesOutputText(data) {
    if (data?.output_text) return String(data.output_text).trim();
    const text = (Array.isArray(data?.output) ? data.output : [])
        .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
        .filter((item) => item?.type === 'output_text')
        .map((item) => item.text)
        .join('');
    return String(text || '').trim();
}

async function responsesCompletionJson(instructions, input, { model = GPT_MODEL } = {}) {
    const response = await axios.post(GPT_RESPONSES_API_URL, {
        model,
        instructions,
        input: String(input || ''),
        store: false
    }, {
        headers: {
            Authorization: `Bearer ${GPT_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: Number(process.env.GPT_TIMEOUT_MS || 500000)
    });
    const content = getResponsesOutputText(response.data);
    return parseGptJsonContent(content);
}

module.exports = {
    compareStorefrontImages,
    parseGptJsonContent,
    chatCompletionJson,
    chatCompletionText,
    responsesCompletionJson,
    getResponsesOutputText,
    deriveResponsesApiUrl,
    chat
};
