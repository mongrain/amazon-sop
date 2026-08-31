const assert = require('assert');
const XLSX = require('xlsx');
const { buildExportFilename, buildWorkbook } = require('../service/data-collection/asin/export');
const { projectExportRow, getExportColumnKeys, EXPORT_COLUMNS } = require('../service/data-collection/asin/export-columns');
const { translateColumnHeader } = require('../service/data-collection/asin/column-labels');

assert.deepStrictEqual(
    EXPORT_COLUMNS.map(c => c.label),
    ['ASIN', '标题', '五点', '价格']
);
assert.deepStrictEqual(getExportColumnKeys(), ['ASIN', '标题', '五点', '价格']);

assert.strictEqual(translateColumnHeader('product.title'), '标题');
assert.strictEqual(buildExportFilename(['B0TEST1234'], 'json'), 'B0TEST1234.json');
assert.strictEqual(buildExportFilename(['A', 'B'], 'xlsx'), 'A_B.xlsx');

const projected = projectExportRow({
    _crawl_asin: 'B0TEST1234',
    'product.title': 'Hello',
    'product.feature_bullets': 'line one\nline two'
    // 故意缺价格
});
assert.deepStrictEqual(projected, {
    ASIN: 'B0TEST1234',
    标题: 'Hello',
    五点: 'line one\nline two',
    价格: ''
});

const columns = getExportColumnKeys();
const columnLabels = Object.fromEntries(columns.map(c => [c, c]));
const wb = buildWorkbook({
    columns,
    rows: [projected],
    columnLabels
});
assert.ok(wb.SheetNames.includes('ASIN数据'));
const sheet = wb.Sheets['ASIN数据'];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
assert.deepStrictEqual(aoa[0], ['ASIN', '标题', '五点', '价格']);
assert.deepStrictEqual(aoa[1], ['B0TEST1234', 'Hello', 'line one\nline two', '']);

console.log('test-asin-crawler-export: PASS');
