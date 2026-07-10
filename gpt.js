require('dotenv').config();
const axios = require('axios');
const { handler } = require('./service/imagediff');

const GPT_API_URL = process.env.GPT_API_URL || 'http://localhost:8000/v1/chat/completions';
const GPT_API_KEY = process.env.GPT_API_KEY || 'eb3bf85f539499df36e2eec15669d57e';
const GPT_MODEL = process.env.GPT_MODEL || 'doubao';

const COMPARE_PROMPT = '你是一位精通亚马逊店铺（Storefront）视觉分析的专家。我将为你提供两张店铺主页截图的 URL 地址（图A和图B，代表同一店铺的不同状态）。你的任务是读取这两个链接中的图片进行对比，判断该商家是否针对大促或特定节日活动进行了店面装修或营销模块调整。\n【分析核心原则：抓大放小】\n1. 严格忽略：由于网络加载延迟、图片或商品元素未完全加载（如发灰/空白占位符）、字体渲染差异、响应式排布微调导致的非实质性视觉差异。\n2. 专注于：实质性的营销视觉物料、大促氛围和模块布局的变动。\n【大促/节日信号侦测重点】\n- 横幅（Banner）变动：是否更换了横幅？是否融入了特定的促销或节日元素（例如：Prime Day 元素、复活节 Easter、黑色星期五 Black Friday 等）。\n- 促销模块增减：是否在店铺首页显著位置增加了促销专区、限时抢购模块或变更了主推品。\n这里客观性非常重要，如果想都是同一个节日元素（如圣诞节），均认为同一种状态\n【输出格式要求】\n必须直接返回一个标准的 JSON 对象，不要包含任何 Markdown 格式标记（如 ```json）或前后解释性文本。JSON 结构如下：\n{\n  "is_changed": true,\n  "promotion_type": "Prime Day / Easter / None",\n  "change_details": [\n    "具体变动点1（如：更换了首页顶部横幅，增加了复活节彩蛋与折扣文案）"\n  ],\n  "summary": "此处填写修改内容的精简总结。必须严格控制在 50 个汉字以内。"\n}';

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

async function chatCompletionJson(userPrompt, userContent, { model = GPT_MODEL } = {}) {
    const payload = {
        model,
        messages: [
            { role: 'user', content: `${userPrompt}\n\n${userContent}` }
        ],
        stream: false
    };

    const response = await axios.post(GPT_API_URL, payload, {
        headers: {
            Authorization: `Bearer ${GPT_API_KEY}`,
            'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity,
        timeout: Number(process.env.GPT_TIMEOUT_MS || 120000)
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
    return parseGptJsonContent(content);
}

async function chatCompletionText(systemPrompt, userContent, { model = GPT_MODEL } = {}) {
    const payload = {
        model,
        messages: [
            { role: 'user', content: `${systemPrompt}\n\n${userContent}` }
        ],
        stream: false
    };

    const response = await axios.post(GPT_API_URL, payload, {
        headers: {
            Authorization: `Bearer ${GPT_API_KEY}`,
            'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity,
        timeout: Number(process.env.GPT_TIMEOUT_MS || 120000)
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
    return String(content).trim();
}

module.exports = { compareStorefrontImages: compareStorefrontImagesBySiderAi, parseGptJsonContent, chatCompletionJson, chatCompletionText };
