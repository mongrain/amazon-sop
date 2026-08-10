/**
 * Excel 导出固定列（仅这些，顺序固定）。
 * sources: 按优先级从 flat_json 取值的字段路径。
 */
const EXPORT_COLUMNS = [
    { label: 'ASIN', sources: ['_crawl_asin', 'product.asin', 'product.product_information.asin'] },
    { label: '品牌', sources: ['product.brand'] },
    { label: '类目', sources: ['product.categories', 'product.product_category'] },
    { label: '卖点', sources: ['product.feature_bullets'] },
    { label: '详细描述', sources: ['product.full_description'] },
    { label: '图片', sources: ['product.images'] },
    { label: '主图', sources: ['product.main_image'] },
    { label: '名称', sources: ['product.name', 'product.title'] },
    { label: '畅销榜排名', sources: ['product.best_sellers_rank', 'product.product_information.best_sellers_rank'] },
    { label: '品牌名称', sources: ['product.brand_name', 'product.product_information.brand', 'product.brand'] },
    { label: '重量', sources: ['product.weight', 'product.product_information.item_weight'] },
    { label: '制造商', sources: ['product.manufacturer', 'product.product_information.manufacturer'] },
    { label: '材质类型', sources: ['product.material_type', 'product.product_information.material'] },
    { label: '型号编号', sources: ['product.model_number', 'product.product_information.item_model_number', 'product.model'] },
    { label: '发货方', sources: ['product.ships_from'] },
    { label: '销售方', sources: ['product.sold_by'] },
    { label: '标题', sources: ['product.title', 'product.name'] },
    { label: '是否有A+', sources: ['product.aplus_present'] },
    { label: '库存数量', sources: ['product.stock_quantity', 'product.buybox.maximum_order_quantity'] },
    { label: '库存状态', sources: ['product.availability', 'product.buybox.availability'] },
    { label: '卖家ID', sources: ['product.seller_id'] },
    { label: '卖家名称', sources: ['product.seller_name', 'product.sold_by'] },
    { label: '总评论数', sources: ['product.review_count', 'product.reviews'] }
];

function pickFlatValue(flat, sources) {
    const row = flat && typeof flat === 'object' ? flat : {};
    for (const key of sources) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        const value = row[key];
        if (value == null) continue;
        if (value === '') continue;
        return value;
    }
    return '';
}

function projectExportRow(flat) {
    const out = {};
    for (const col of EXPORT_COLUMNS) {
        out[col.label] = pickFlatValue(flat, col.sources);
    }
    return out;
}

function getExportColumnLabels() {
    const labels = {};
    for (const col of EXPORT_COLUMNS) {
        labels[col.label] = col.label;
    }
    return labels;
}

function getExportColumnKeys() {
    return EXPORT_COLUMNS.map(col => col.label);
}

module.exports = {
    EXPORT_COLUMNS,
    pickFlatValue,
    projectExportRow,
    getExportColumnLabels,
    getExportColumnKeys
};
