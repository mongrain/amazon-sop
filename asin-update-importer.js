const XLSX = require('xlsx');
const path = require('path');
const { runSql, queryOne } = require('./database');
const { parseOpenDate } = require('./inventory-report-importer');

const ASIN_UPDATE_PATH = path.join(__dirname, 'public', 'asin更新.xlsx');

const COL = {
    ASIN: 0,
    LISTED_AT: 1
};

const HEADER_ROW_INDEX = 0;
const DATA_START_INDEX = 1;

function parseListedDate(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
    return parseOpenDate(value);
}

function formatDbDateTime(value) {
    if (!value) return '';
    if (value instanceof Date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
    }
    return String(value).slice(0, 19).replace('T', ' ');
}

/** 相同 ASIN 保留最后一行 */
function collectRowsByAsin(rows) {
    const byAsin = new Map();

    for (let i = DATA_START_INDEX; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length) continue;

        const asin = String(row[COL.ASIN] || '').trim().toUpperCase();
        if (!asin) continue;

        byAsin.set(asin, {
            listedAt: parseListedDate(row[COL.LISTED_AT]),
            rowIndex: i + 1
        });
    }

    return byAsin;
}

/**
 * 从 public/asin更新.xlsx 更新产品库上架日期；ASIN 重复时取最后一行。
 * 上架日期为空时跳过该行，不覆盖已有值。
 */
async function importAsinUpdateExcel() {
    const fs = require('fs');
    if (!fs.existsSync(ASIN_UPDATE_PATH)) {
        return { error: `Excel file not found: ${ASIN_UPDATE_PATH}` };
    }

    const wb = XLSX.readFile(ASIN_UPDATE_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const header = rows[HEADER_ROW_INDEX] || [];
    if (String(header[COL.ASIN] || '').trim().toUpperCase() !== 'ASIN'
        || !String(header[COL.LISTED_AT] || '').includes('上架')) {
        return { error: 'asin更新.xlsx 表头格式不正确，需包含 ASIN、上架时间 列' };
    }

    const byAsin = collectRowsByAsin(rows);
    const stats = {
        total_rows: Math.max(0, rows.length - DATA_START_INDEX),
        unique_asin: byAsin.size,
        listed_at_updated: 0,
        products_not_found: 0,
        skipped_no_date: 0,
        products_unchanged: 0,
        errors: []
    };

    for (const [asin, { listedAt, rowIndex }] of byAsin) {
        try {
            if (!listedAt) {
                stats.skipped_no_date++;
                continue;
            }

            const product = await queryOne('SELECT id, listed_at FROM products WHERE asin = ?', [asin]);
            if (!product) {
                stats.products_not_found++;
                stats.errors.push(`第 ${rowIndex} 行 ASIN ${asin}: 产品库中不存在`);
                continue;
            }

            if (formatDbDateTime(product.listed_at) === listedAt) {
                stats.products_unchanged++;
                continue;
            }

            await runSql(
                'UPDATE products SET listed_at = ?, updated_at = NOW() WHERE id = ?',
                [listedAt, product.id]
            );
            stats.listed_at_updated++;
        } catch (e) {
            stats.errors.push(`第 ${rowIndex} 行 ASIN ${asin}: ${e.message}`);
        }
    }

    return stats;
}

module.exports = { importAsinUpdateExcel, ASIN_UPDATE_PATH };
