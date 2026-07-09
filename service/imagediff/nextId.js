const { siderAi, getFileId } = require('../service/sider.ai');

async function testSiderAi() {
  const fileId1 = await getFileId('C:/Users/ASUS/Desktop/baadf35d7c9846c5abe8c11a9b01311a.jpg~tplv-a9rns2rl98-24-95-exif_960_960.jpg');
  const fileId2 = await getFileId('C:/Users/ASUS/Desktop/4392a627301948e2b07d69a9ff08657c.jpg~tplv-a9rns2rl98-24-95-exif_960_960.jpg');
  const prompt = `你是一位精通亚马逊店铺（Storefront）视觉分析的专家。我将为你提供两张店铺主页截图的 URL 地址（图A和图B，代表同一店铺的不同状态）。你的任务是读取这两个链接中的图片进行对比，判断该商家是否针对大促或特定节日活动进行了店面装修或营销模块调整。
【分析核心原则：抓大放小】
1. 严格忽略：由于网络加载延迟、图片或商品元素未完全加载（如发灰/空白占位符）、字体渲染差异、响应式排布微调导致的非实质性视觉差异。
2. 专注于：实质性的营销视觉物料、大促氛围和模块布局的变动。
【大促/节日信号侦测重点】
- 横幅（Banner）变动：是否更换了横幅？是否融入了特定的促销或节日元素（例如：Prime Day 元素、复活节 Easter、黑色星期五 Black Friday 等）。
- 促销模块增减：是否在店铺首页显著位置增加了促销专区、限时抢购模块或变更了主推品。
这里客观性非常重要，如果想都是同一个节日元素（如圣诞节），均认为同一种状态。
【输出格式要求】
必须直接返回一个标准的 JSON 对象，不要包含任何 Markdown 格式标记（如 \`\`\`json）或前后解释性文本。JSON 结构如下：
{
  "is_changed": true,
  "promotion_type": "Prime Day / Easter / None",
  "change_details": [
    "具体变动点1（如：更换了首页顶部横幅，增加了复活节彩蛋与折扣文案）"
  ],
  "summary": "此处填写修改内容的精简总结。必须严格控制在 50 个汉字以内。"
}
`;
  const result = await siderAi(fileId1, fileId2, prompt);
  console.log(result);
}

testSiderAi();