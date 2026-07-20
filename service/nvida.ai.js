const OpenAI = require('openai');

const APIKEY = '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';

const openai = new OpenAI({
  apiKey: APIKEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

/**
 * 调用 NVIDIA 视觉模型对比两张图片
 * @param {string} imgUrl1 图A URL
 * @param {string} imgUrl2 图B URL
 * @param {string} prompt 对比提示词
 * @returns {Promise<object>} 解析后的 JSON 结果
 */
async function nvidaAi(imgUrl1, imgUrl2, prompt) {
  const completion = await openai.chat.completions.create({
    model: 'z-ai/glm-5.2',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imgUrl1 } },
          { type: 'image_url', image_url: { url: imgUrl2 } },
        ],
      },
    ],
    temperature: 1,
    top_p: 1,
    max_tokens: 16384,
    stream: false,
  });

  const fullText = completion.choices?.[0]?.message?.content || '';
  if (!fullText.trim()) {
    throw new Error('未收到有效响应');
  }

  const start = fullText.indexOf('{');
  const end = fullText.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('未找到有效 JSON 响应');
  }

  return JSON.parse(fullText.slice(start, end + 1));
}

module.exports = {
  nvidaAi,
};
