const assert = require('assert');
const XLSX = require('xlsx');
const {
    EXPORT_COLUMNS,
    buildExportFilename,
    buildWorkbook
} = require('../service/data-collection/asin/export');
const { translateColumnHeader, buildColumnLabels } = require('../service/data-collection/asin/column-labels');

assert.deepStrictEqual(EXPORT_COLUMNS, [
    '_crawl_asin',
    'product.title',
    'product.feature_bullets',
    'product.buybox.price.value'
]);

assert.strictEqual(translateColumnHeader('product.title'), '标题');
assert.strictEqual(translateColumnHeader('product.feature_bullets'), '五点');
assert.strictEqual(translateColumnHeader('product.buybox.price.value'), '价格');
assert.strictEqual(buildExportFilename(['B0TEST1234'], 'json'), 'B0TEST1234.json');
assert.strictEqual(buildExportFilename(['A', 'B'], 'xlsx'), 'A_B.xlsx');

const columnLabels = buildColumnLabels(EXPORT_COLUMNS);
assert.deepStrictEqual(
    EXPORT_COLUMNS.map(c => columnLabels[c]),
    ['ASIN', '标题', '五点', '价格']
);

const wb = buildWorkbook({
    columns: EXPORT_COLUMNS,
    rows: [{
        _crawl_asin: 'B0TEST1234',
        'product.title': 'Hello',
        'product.feature_bullets': 'line one\nline two'
        // 故意缺价格
    }],
    columnLabels
});
assert.ok(wb.SheetNames.includes('ASIN数据'));
const sheet = wb.Sheets['ASIN数据'];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
assert.deepStrictEqual(aoa[0], ['ASIN', '标题', '五点', '价格']);
assert.deepStrictEqual(aoa[1], ['B0TEST1234', 'Hello', 'line one\nline two', '']);

console.log('test-asin-crawler-export: PASS');
