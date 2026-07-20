const XLSX = require('xlsx');
const { queryAll } = require('../../../database');
const { buildColumnLabels } = require('./column-labels');

function buildExportFilename(asins, ext = 'xlsx') {
    const list = (asins || []).map(a => String(a || '').trim().toUpperCase()).filter(Boolean);
    const suffix = ext.startsWith('.') ? ext : `.${ext}`;
    if (!list.length) return `asin-crawl${suffix}`;
    if (list.length === 1) return `${list[0]}${suffix}`;
    const joined = list.join('_');
    if (joined.length <= 180) return `${joined}${suffix}`;
    return `${list[0]}_等${list.length}个${suffix}`;
}

async function buildExportData(jobId) {
    const items = await queryAll(
        `SELECT asin, flat_json FROM asin_crawl_items
         WHERE job_id = ? AND status = 'success' AND flat_json IS NOT NULL
         ORDER BY id ASC`,
        [Number(jobId)]
    );
    const asins = items.map(item => item.asin);

    if (!items.length) {
        const columns = ['_crawl_asin'];
        return {
            columns,
            rows: [],
            columnLabels: buildColumnLabels(columns),
            asins
        };
    }

    const rows = items.map(item => {
        const flat = typeof item.flat_json === 'string'
            ? JSON.parse(item.flat_json)
            : (item.flat_json || {});
        return { _crawl_asin: item.asin, ...flat };
    });

    const columnSet = new Set(['_crawl_asin']);
    for (const row of rows) {
        Object.keys(row).forEach(k => columnSet.add(k));
    }
    const columns = [...columnSet].sort((a, b) => {
        if (a === '_crawl_asin') return -1;
        if (b === '_crawl_asin') return 1;
        return a.localeCompare(b);
    });
    const columnLabels = buildColumnLabels(columns);
    return { columns, rows, columnLabels, asins };
}

function buildWorkbook({ columns, rows, columnLabels }) {
    const headerRow = columns.map(col => columnLabels[col] || col);
    const dataRows = rows.map(row => columns.map(col => {
        const value = row[col];
        return value == null ? '' : value;
    }));
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ASIN数据');
    return wb;
}

async function exportJobToXlsx(jobId) {
    const data = await buildExportData(jobId);
    const wb = buildWorkbook(data);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return {
        buffer,
        filename: buildExportFilename(data.asins, 'xlsx')
    };
}

async function exportJobToJson(jobId) {
    const items = await queryAll(
        `SELECT asin, raw_json FROM asin_crawl_items
         WHERE job_id = ? AND status = 'success' AND raw_json IS NOT NULL
         ORDER BY id ASC`,
        [Number(jobId)]
    );
    const asins = items.map(item => item.asin);
    const payload = {
        job_id: Number(jobId),
        exported_at: new Date().toISOString(),
        count: items.length,
        items: items.map(item => ({
            asin: item.asin,
            data: typeof item.raw_json === 'string'
                ? JSON.parse(item.raw_json)
                : item.raw_json
        }))
    };
    return {
        buffer: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
        filename: buildExportFilename(asins, 'json')
    };
}

module.exports = {
    buildExportFilename,
    buildExportData,
    buildWorkbook,
    exportJobToXlsx,
    exportJobToJson
};
