const assert = require('assert');
const { buildExportFilename, buildWorkbook } = require('../service/data-collection/asin/export');
const { projectExportRow, getExportColumnKeys } = require('../service/data-collection/asin/export-columns');
const { mapAmazonProduct } = require('../service/data-collection/amazon-map');
const { flattenForCsv } = require('../service/data-collection/asin/flatten');
const { translateColumnHeader } = require('../service/data-collection/asin/column-labels');

assert.strictEqual(translateColumnHeader('product.title'), '标题');
assert.strictEqual(buildExportFilename(['B0TEST1234'], 'json'), 'B0TEST1234.json');
assert.strictEqual(buildExportFilename(['A', 'B'], 'xlsx'), 'A_B.xlsx');

const mapped = mapAmazonProduct({
    name: 'Demo Product',
    brand: 'Visit the Demo Store',
    feature_bullets: ['a', 'b'],
    images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
    product_category: 'Home›Kitchen',
    full_description: 'long text',
    ships_from: 'Amazon',
    sold_by: 'DemoSeller',
    aplus_present: true,
    total_reviews: 128,
    availability: 'In Stock',
    seller_id: 'A1SELLER',
    product_information: {
        asin: 'B0TEST1234',
        brand: 'DemoBrand',
        material: 'Stainless Steel',
        manufacturer: 'DemoMfg',
        item_weight: '1 pound',
        item_model_number: 'M-001',
        best_sellers_rank: ['#1 in Kitchen', '#2 in Cookers']
    }
});
const flat = flattenForCsv(mapped);
const projected = projectExportRow({ _crawl_asin: 'B0TEST1234', ...flat });
const columns = getExportColumnKeys();

assert.deepStrictEqual(columns, [
    'ASIN', '品牌', '类目', '卖点', '详细描述', '图片', '主图', '名称', '畅销榜排名',
    '品牌名称', '重量', '制造商', '材质类型', '型号编号', '发货方', '销售方', '标题',
    '是否有A+', '库存数量', '库存状态', '卖家ID', '卖家名称', '总评论数'
]);
assert.strictEqual(projected.ASIN, 'B0TEST1234');
assert.strictEqual(projected['品牌名称'], 'DemoBrand');
assert.strictEqual(projected['材质类型'], 'Stainless Steel');
assert.strictEqual(projected['总评论数'], 128);
assert.strictEqual(projected['是否有A+'], true);
assert.strictEqual(Object.keys(projected).length, columns.length);

const wb = buildWorkbook({
    columns,
    rows: [projected],
    columnLabels: Object.fromEntries(columns.map(c => [c, c]))
});
assert.ok(wb.SheetNames.includes('ASIN数据'));
const sheet = wb.Sheets['ASIN数据'];
assert.strictEqual(sheet.A1.v, 'ASIN');
assert.strictEqual(sheet.B1.v, '品牌');
assert.strictEqual(sheet.W1.v, '总评论数');

console.log('test-asin-crawler-export: PASS');
