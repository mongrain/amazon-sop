require('dotenv').config();
const { handler } = require('../service/imagediff');

async function main() {
  const imageUrlA = process.env.GPT_TEST_IMAGE_A;
  const imageUrlB = process.env.GPT_TEST_IMAGE_B;

  if (!imageUrlA || !imageUrlB) {
    console.error('请在 .env 中设置 GPT_TEST_IMAGE_A / GPT_TEST_IMAGE_B');
    process.exit(1);
  }

  console.log('=== imagediff (NVIDIA) 图片对比测试 ===\n');
  console.log('图A:', imageUrlA);
  console.log('图B:', imageUrlB);
  console.log('');

  const result = await handler(imageUrlA, imageUrlB);

  if (typeof result.is_changed !== 'boolean') {
    throw new Error('is_changed 应为布尔值');
  }
  if (typeof result.promotion_type !== 'string') {
    throw new Error('promotion_type 应为字符串');
  }
  if (!Array.isArray(result.change_details)) {
    throw new Error('change_details 应为数组');
  }
  if (typeof result.summary !== 'string') {
    throw new Error('summary 应为字符串');
  }

  console.log('✓ 结构校验通过');
  console.log('响应:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('测试失败:', err.message || err);
  process.exit(1);
});
