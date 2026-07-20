const assert = require('assert');
const { buildExportFilename, buildWorkbook } = require('../service/data-collection/asin/export');
const { translateColumnHeader } = require('../service/data-collection/asin/column-labels');

assert.strictEqual(translateColumnHeader('product.title'), '标题');
assert.strictEqual(buildExportFilename(['B0TEST1234'], 'json'), 'B0TEST1234.json');
assert.strictEqual(buildExportFilename(['A', 'B'], 'xlsx'), 'A_B.xlsx');

const wb = buildWorkbook({
    columns: ['_crawl_asin', 'product.title', 'product.feature_bullets'],
    rows: [{
        _crawl_asin: 'B0TEST1234',
        'product.title': 'Hello',
        'product.feature_bullets': 'line one\nline two'
    }],
    columnLabels: {
        _crawl_asin: 'ASIN',
        'product.title': '标题',
        'product.feature_bullets': '卖点'
    }
});
assert.ok(wb.SheetNames.includes('ASIN数据'));

console.log('test-asin-crawler-export: PASS');
