/**
 * Excel 导出固定列（仅这些，顺序固定）。
 * sources: 按优先级从 flat_json 取值的字段路径。
 */
const EXPORT_COLUMNS = [
    { label: 'ASIN', sources: ['_crawl_asin', 'product.asin', 'product.product_information.asin'] },
    { label: '标题', sources: ['product.title', 'product.name'] },
    { label: '五点', sources: ['product.feature_bullets'] },
    { label: '价格', sources: ['product.buybox.price.value'] }
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
