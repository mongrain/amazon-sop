const XLSX = require('xlsx');
const path = require('path');
const { runSql, queryOne, queryAll, ensureRecordsForProduct, recalculateProductProgress } = require('./database');
const { ensureEconomicsForProduct } = require('./product-economics');
const { mapSiteFromLabel, PRODUCT_SITES } = require('./product-sites');
const { enqueueOperatingDaysTask } = require('./service/operating-days-queue');

const PRODUCT_LIST_PATH = path.join(__dirname, 'public', '产品清单.xlsx');

const COL = {
    SITE: 0,
    NAME: 1,
    ASIN: 2
};

const HEADER_ROW_INDEX = 0;
const DATA_START_INDEX = 1;

/** 相同 ASIN 保留最后一行；空站点列继承上一行站点 */
function collectRowsByAsin(rows) {
    const byAsin = new Map();
    let currentSiteLabel = '';

    for (let i = DATA_START_INDEX; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length) continue;

        const siteLabel = String(row[COL.SITE] || '').trim();
        if (siteLabel) currentSiteLabel = siteLabel;

        const asin = String(row[COL.ASIN] || '').trim();
        if (!asin) continue;

        const name = String(row[COL.NAME] || '').trim() || null;
        const site = mapSiteFromLabel(currentSiteLabel);
        byAsin.set(asin, { name, site, siteLabel: currentSiteLabel, rowIndex: i + 1 });
    }

    return byAsin;
}

/**
 * 从 public/产品清单.xlsx 更新或新建产品的站点（seq）与产品名称；ASIN 重复时取最后一行。
 */
async function importProductListExcel() {
    const fs = require('fs');
    if (!fs.existsSync(PRODUCT_LIST_PATH)) {
        return { error: `Excel file not found: ${PRODUCT_LIST_PATH}` };
    }

    const wb = XLSX.readFile(PRODUCT_LIST_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const header = rows[HEADER_ROW_INDEX] || [];
    if (String(header[COL.SITE] || '').trim() !== '站点'
        || !String(header[COL.NAME] || '').includes('产品名称')
        || String(header[COL.ASIN] || '').trim() !== '标橙色没有变体') {
        return { error: '产品清单.xlsx 表头格式不正确，请使用标准模板' };
    }

    const byAsin = collectRowsByAsin(rows);
    const stats = {
        total_rows: Math.max(0, rows.length - DATA_START_INDEX),
        unique_asin: byAsin.size,
        products_updated: 0,
        products_created: 0,
        products_unchanged: 0,
        errors: []
    };

    for (const [asin, { name, site, siteLabel, rowIndex }] of byAsin) {
        try {
            if (!site) {
                stats.errors.push(`第 ${rowIndex} 行 ASIN ${asin}: 站点「${siteLabel}」无法匹配系统站点（${PRODUCT_SITES.join('、')}）`);
                continue;
            }

            const product = await queryOne('SELECT id, name, seq FROM products WHERE asin = ?', [asin]);
            if (!product) {
                await runSql(
                    'INSERT INTO products (asin, name, seq) VALUES (?, ?, ?)',
                    [asin, name, site]
                );
                const created = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
                await ensureRecordsForProduct(created.id);
                await ensureEconomicsForProduct(created.id, runSql);
                await recalculateProductProgress(created.id);
                await enqueueOperatingDaysTask({ productId: created.id, asin, seq: site });
                stats.products_created++;
                continue;
            }

            const nextName = name || product.name;
            const nextSite = site;
            const changed = nextName !== product.name || nextSite !== product.seq;

            if (!changed) {
                stats.products_unchanged++;
                continue;
            }

            await runSql(
                'UPDATE products SET name = ?, seq = ?, updated_at = NOW() WHERE id = ?',
                [nextName, nextSite, product.id]
            );
            stats.products_updated++;
        } catch (e) {
            stats.errors.push(`第 ${rowIndex} 行 ASIN ${asin}: ${e.message}`);
        }
    }

    return stats;
}

module.exports = { importProductListExcel, PRODUCT_LIST_PATH };
