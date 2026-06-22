const XLSX = require('xlsx');
const path = require('path');
const { runSql, queryOne, ensureRecordsForProduct, recalculateProductProgress } = require('./database');
const { ensureEconomicsForProduct } = require('./product-economics');

const TACOS_PATH = path.join(__dirname, 'public', 'TACOS.xlsx');

const COL = {
    NAME: 0,
    ASIN: 2,
    SELLING_PRICE: 3,
    LAST_MILE_FEE: 4,
    COST_USD: 5,
    FIRST_LEG: 6,
    TAX: 7,
    MISC_FEE: 8,
    AD_SPEND: 9,
    ORDER_VELOCITY: 13
};

const HEADER_ROW_INDEX = 2;
const DATA_START_INDEX = 3;

function parseNum(val) {
    if (val === '' || val === null || val === undefined) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
}

function extractExchangeRate(rows) {
    const meta = rows[1] || [];
    for (let i = 0; i < meta.length; i++) {
        if (String(meta[i]).trim() === '汇率' && i + 1 < meta.length) {
            const rate = parseNum(meta[i + 1]);
            if (rate && rate > 0) return rate;
        }
    }
    return null;
}

/** 相同 ASIN 保留最后一行 */
function collectRowsByAsin(rows) {
    const byAsin = new Map();
    for (let i = DATA_START_INDEX; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length) continue;
        const asin = String(row[COL.ASIN] || '').trim();
        if (!asin) continue;
        byAsin.set(asin, { row, rowIndex: i + 1 });
    }
    return byAsin;
}

async function saveExchangeRate(runSql, rate) {
    await runSql(
        `INSERT INTO exchange_rates (pair, rate, fetched_at) VALUES ('USD/CNY', ?, NOW())
         ON DUPLICATE KEY UPDATE rate = VALUES(rate), fetched_at = NOW()`,
        [rate]
    );
}

async function ensureProduct(asin, name) {
    let product = await queryOne('SELECT id, name FROM products WHERE asin = ?', [asin]);
    if (!product) {
        await runSql('INSERT INTO products (asin, name) VALUES (?, ?)', [asin, name || null]);
        product = await queryOne('SELECT id, name FROM products WHERE asin = ?', [asin]);
        await ensureRecordsForProduct(product.id);
        await recalculateProductProgress(product.id);
        return { productId: product.id, created: true };
    }
    if (name && name !== product.name) {
        await runSql('UPDATE products SET name = ?, updated_at = NOW() WHERE id = ?', [name, product.id]);
    }
    return { productId: product.id, created: false };
}

function rowToEconomicsPayload(row, exchangeRate) {
    const costUsd = parseNum(row[COL.COST_USD]);
    const costRmb = costUsd != null && exchangeRate ? Math.round(costUsd * exchangeRate * 100) / 100 : null;

    return {
        selling_price_usd: parseNum(row[COL.SELLING_PRICE]),
        cost_price_rmb: costRmb,
        first_leg_usd: parseNum(row[COL.FIRST_LEG]),
        tax_usd: parseNum(row[COL.TAX]) ?? 0,
        misc_fee_usd: parseNum(row[COL.MISC_FEE]),
        ad_spend_usd: parseNum(row[COL.AD_SPEND]),
        last_mile_fee_usd: parseNum(row[COL.LAST_MILE_FEE]),
        order_velocity: parseNum(row[COL.ORDER_VELOCITY])
    };
}

async function saveEconomicsRow(productId, payload, runSql) {
    await runSql(`
        UPDATE product_economics SET
            selling_price_usd = ?,
            cost_price_rmb = ?,
            first_leg_usd = ?,
            first_leg_manual = 1,
            tax_usd = ?,
            misc_fee_usd = ?,
            ad_spend_usd = ?,
            ad_spend_manual = 1,
            last_mile_fee_usd = ?,
            last_mile_fee_manual = 1,
            order_velocity = ?
        WHERE product_id = ?
    `, [
        payload.selling_price_usd,
        payload.cost_price_rmb,
        payload.first_leg_usd,
        payload.tax_usd,
        payload.misc_fee_usd,
        payload.ad_spend_usd,
        payload.last_mile_fee_usd,
        payload.order_velocity,
        productId
    ]);
}

/**
 * 从 public/TACOS.xlsx 导入利润看盘数据；ASIN 重复时取最后一行。
 */
async function importTacosExcel() {
    const fs = require('fs');
    if (!fs.existsSync(TACOS_PATH)) {
        return { error: `Excel file not found: ${TACOS_PATH}` };
    }

    const wb = XLSX.readFile(TACOS_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (!rows[HEADER_ROW_INDEX] || String(rows[HEADER_ROW_INDEX][COL.ASIN] || '').trim() !== 'ASIN') {
        return { error: 'TACOS.xlsx 表头格式不正确，请使用标准模板' };
    }

    const exchangeRate = extractExchangeRate(rows);
    const byAsin = collectRowsByAsin(rows);

    const stats = {
        total_rows: Math.max(0, rows.length - DATA_START_INDEX),
        unique_asin: byAsin.size,
        products_created: 0,
        economics_updated: 0,
        exchange_rate: exchangeRate,
        errors: []
    };

    if (exchangeRate) {
        try {
            await saveExchangeRate(runSql, exchangeRate);
        } catch (e) {
            stats.errors.push(`汇率保存失败: ${e.message}`);
        }
    }

    for (const [asin, { row, rowIndex }] of byAsin) {
        try {
            const name = String(row[COL.NAME] || '').trim() || null;
            const { productId, created } = await ensureProduct(asin, name);
            if (created) stats.products_created++;

            await ensureEconomicsForProduct(productId, runSql);
            const payload = rowToEconomicsPayload(row, exchangeRate);
            await saveEconomicsRow(productId, payload, runSql);
            stats.economics_updated++;
        } catch (e) {
            stats.errors.push(`第 ${rowIndex} 行 ASIN ${asin}: ${e.message}`);
        }
    }

    return stats;
}

module.exports = { importTacosExcel, TACOS_PATH };
