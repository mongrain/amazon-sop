const { hammingDistance, perceptualHashCompare } = require('../service/image-phash');

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
    if (actual !== expected) {
        throw new Error(`期望 ${expected}，实际 ${actual}`);
    }
    ok(name);
}

async function main() {
    console.log('=== image-phash 单元测试 ===\n');

    try {
        assertEqual(hammingDistance('ff00', 'ff00'), 0, '相同 hash 距离为 0');
    } catch (err) {
        fail('相同 hash 距离为 0', err);
    }

    try {
        // ff00 vs fe00：最低字节差 1 bit（按 hex 位展开后距离应为 1）
        const d = hammingDistance('ff00', 'fe00');
        if (d !== 1) throw new Error(`期望距离 1，实际 ${d}`);
        ok('差 1 bit 的 hash 距离为 1');
    } catch (err) {
        fail('差 1 bit 的 hash 距离为 1', err);
    }

    try {
        await perceptualHashCompare('http://invalid.local/a.png', 'http://invalid.local/b.png');
        fail('无效 URL 应抛错', new Error('未抛错'));
    } catch (err) {
        if (String(err && err.message).includes('未抛错')) {
            // already failed
        } else {
            ok('无效 URL 抛错');
        }
    }

    console.log(`\n通过 ${passed}，失败 ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
