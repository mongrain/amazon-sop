const { parseTokenInput, splitNewAndDuplicateTokens, mapTokenRow } = require('../service/data-collection/token-pool');

let passed = 0;
let failed = 0;
function ok(n) { passed += 1; console.log('  ✓', n); }
function fail(n, e) { failed += 1; console.error('  ✗', n, e.message || e); }

try {
    const list = parseTokenInput('  key-a  \n\nkey-b\nkey-a\nkey-c  ');
    if (list.join(',') !== 'key-a,key-b,key-c') throw new Error(list.join(','));
    ok('parseTokenInput 去空行且批次内去重');
} catch (e) { fail('parseTokenInput 去空行且批次内去重', e); }

try {
    const { fresh, duplicates } = splitNewAndDuplicateTokens(
        ['key-a', 'key-b', 'key-c'],
        ['key-b', 'key-c']
    );
    if (fresh.join(',') !== 'key-a') throw new Error(`fresh=${fresh.join(',')}`);
    if (duplicates.join(',') !== 'key-b,key-c') throw new Error(`dup=${duplicates.join(',')}`);
    ok('已存在 token 从待录入中拆出');
} catch (e) { fail('已存在 token 从待录入中拆出', e); }

try {
    const { fresh, duplicates } = splitNewAndDuplicateTokens(['key-a'], ['key-a']);
    if (fresh.length !== 0) throw new Error('fresh 应为空');
    if (duplicates.join(',') !== 'key-a') throw new Error('duplicates');
    ok('全部重复时 fresh 为空');
} catch (e) { fail('全部重复时 fresh 为空', e); }

try {
    const mapped = mapTokenRow({
        id: 1,
        token: 'abcd1234efgh',
        label: 'demo',
        status: 'active',
        success_count: 7,
        fail_count: 2,
        last_used_at: null,
        last_error: null,
        created_at: '2026-08-30',
        updated_at: '2026-08-30'
    });
    if (mapped.success_count !== 7) throw new Error(`success_count=${mapped.success_count}`);
    if (mapped.fail_count !== 2) throw new Error(`fail_count=${mapped.fail_count}`);
    ok('mapTokenRow 包含成功次数');
} catch (e) { fail('mapTokenRow 包含成功次数', e); }

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
