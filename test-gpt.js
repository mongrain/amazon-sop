require('dotenv').config();
const { parseGptJsonContent, compareStorefrontImages, chatCompletionJson } = require('./gpt');

let passed = 0;
let failed = 0;

function ok(name) {
    passed += 1;
    console.log(`  ✓ ${name}`);
}

function fail(name, err) {
    failed += 1;
    console.error(`  ✗ ${name}: ${err.message || err}`);
}

function assertEqual(actual, expected, name) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`期望 ${e}，实际 ${a}`);
    }
    ok(name);
}

function runUnitTests() {
    console.log('=== parseGptJsonContent 单元测试 ===\n');

    try {
        assertEqual(
            parseGptJsonContent('{"is_changed":true,"promotion_type":"Prime Day"}'),
            { is_changed: true, promotion_type: 'Prime Day' },
            '纯 JSON 解析'
        );
    } catch (err) {
        fail('纯 JSON 解析', err);
    }

    try {
        assertEqual(
            parseGptJsonContent('```json\n{"is_changed":false,"promotion_type":"None"}\n```'),
            { is_changed: false, promotion_type: 'None' },
            'Markdown 围栏 JSON 解析'
        );
    } catch (err) {
        fail('Markdown 围栏 JSON 解析', err);
    }

    try {
        parseGptJsonContent('');
        fail('空内容应抛出错误', new Error('未抛出异常'));
    } catch (err) {
        if (err.message === 'GPT 返回内容为空') {
            ok('空内容抛出错误');
        } else {
            fail('空内容抛出错误', err);
        }
    }

    try {
        parseGptJsonContent('not-json');
        fail('非法 JSON 应抛出错误', new Error('未抛出异常'));
    } catch (err) {
        if (err instanceof SyntaxError) {
            ok('非法 JSON 抛出 SyntaxError');
        } else {
            fail('非法 JSON 抛出 SyntaxError', err);
        }
    }

    console.log('');
}

async function runLiveTests() {
    const apiUrl = process.env.GPT_API_URL || 'http://localhost:8000/v1/chat/completions';
    const model = process.env.GPT_MODEL || 'doubao';

    console.log('=== GPT API 联调测试 ===\n');
    console.log(`  API:   ${apiUrl}`);
    console.log(`  Model: ${model}\n`);

    try {
        const result = await chatCompletionJson(
            '你是测试助手。必须直接返回 JSON，不要 Markdown 或额外文字。格式：{"status":"ok"}',
            'ping'
        );
        if (!result || typeof result !== 'object') {
            throw new Error('返回结果不是对象');
        }
        ok(`chatCompletionJson 连通（返回字段: ${Object.keys(result).join(', ') || '无'}）`);
        console.log('  响应:', JSON.stringify(result, null, 2));
    } catch (err) {
        fail('chatCompletionJson 连通', err);
    }

    const imageUrlA = process.env.GPT_TEST_IMAGE_A;
    const imageUrlB = process.env.GPT_TEST_IMAGE_B;
    if (imageUrlA && imageUrlB) {
        try {
            const compare = await compareStorefrontImages(imageUrlA, imageUrlB);
            if (typeof compare.is_changed !== 'boolean') {
                throw new Error('is_changed 应为布尔值');
            }
            ok('compareStorefrontImages 图片对比');
            console.log('  响应:', JSON.stringify(compare, null, 2));
        } catch (err) {
            fail('compareStorefrontImages 图片对比', err);
        }
    } else {
        console.log('  - 跳过图片对比（在 .env 中设置 GPT_TEST_IMAGE_A / GPT_TEST_IMAGE_B 可启用）');
    }

    console.log('');
}

async function main() {
    const live = process.argv.includes('--live');

    runUnitTests();

    if (live) {
        await runLiveTests();
    } else {
        console.log('提示: 运行 node test-gpt.js --live 可执行 API 联调测试\n');
    }

    console.log(`结果: ${passed} 通过, ${failed} 失败`);
    if (failed > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('测试脚本异常:', err);
    process.exit(1);
});
