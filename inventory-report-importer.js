const path = require('path');
const { runSql, queryOne, queryAll, ensureRecordsForProduct, recalculateProductProgress } = require('./database');
const { ensureEconomicsForProduct } = require('./product-economics');
const { mapSiteFromLabel } = require('./product-sites');
const { enqueueOperatingDaysTask } = require('./service/operating-days-queue');

const INVENTORY_REPORT_PATH = path.join(__dirname, 'public', '商品库存报告.txt');
const ABANDONED_STATUS = '已放弃';
const ABANDONED_LISTING_STATUSES = new Set(['inactive', 'incomplete']);

const COL = {
    ITEM_NAME: 0,
    SELLER_SKU: 3,
    OPEN_DATE: 6,
    ASIN1: 16,
    STATUS: 28
};

function parseOpenDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const m = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDbDateTime(value) {
    if (!value) return '';
    if (value instanceof Date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
    }
    return String(value).slice(0, 19).replace('T', ' ');
}

function isAbandonedListingStatus(status) {
    return ABANDONED_LISTING_STATUSES.has(String(status || '').trim().toLowerCase());
}

/** 同一 ASIN 存在 Active 等正常刊登时，不标记为已放弃 */
function resolveProductStatus(listingStatuses) {
    const list = [...listingStatuses].filter(Boolean);
    if (!list.length) return null;
    if (list.some(s => !isAbandonedListingStatus(s))) return null;
    return ABANDONED_STATUS;
}

function collectRowsByAsin(lines) {
    const byAsin = new Map();

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split('\t');
        const asin = String(row[COL.ASIN1] || '').trim().toUpperCase();
        if (!asin) continue;

        const name = String(row[COL.ITEM_NAME] || '').trim() || null;
        const sellerSku = String(row[COL.SELLER_SKU] || '').trim();
        const openDate = parseOpenDate(row[COL.OPEN_DATE]);
        const status = String(row[COL.STATUS] || '').trim();
        const site = mapSiteFromLabel(sellerSku);

        const existing = byAsin.get(asin);
        if (!existing) {
            byAsin.set(asin, {
                name,
                sellerSku,
                openDate,
                listingStatus: status,
                listingStatuses: new Set(status ? [status] : []),
                site,
                rowIndex: i + 1
            });
            continue;
        }

        if (status) existing.listingStatuses.add(status);
        if (openDate && (!existing.openDate || openDate < existing.openDate)) {
            existing.openDate = openDate;
        }
        if (name && !existing.name) existing.name = name;
        if (site && !existing.site) existing.site = site;
        if (status && !isAbandonedListingStatus(status)) existing.listingStatus = status;
        existing.rowIndex = i + 1;
    }

    for (const row of byAsin.values()) {
        row.productStatus = resolveProductStatus(row.listingStatuses);
    }

    return byAsin;
}

/**
 * 从 public/商品库存报告.txt 导入产品库，按 open-date 更新 listed_at。
 * 同一 ASIN 多行时取最早的 open-date。
 */
async function importInventoryReportTxt() {
    const fs = require('fs');
    if (!fs.existsSync(INVENTORY_REPORT_PATH)) {
        return { error: `文件不存在: ${INVENTORY_REPORT_PATH}` };
    }

    const text = fs.readFileSync(INVENTORY_REPORT_PATH, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
        return { error: '商品库存报告为空或缺少数据行' };
    }

    const header = lines[0].split('\t').map(h => h.trim().toLowerCase());
    if (!header.includes('asin1') || !header.includes('open-date')) {
        return { error: '商品库存报告表头格式不正确，需包含 asin1、open-date 列' };
    }

    const byAsin = collectRowsByAsin(lines);
    const existingRows = await queryAll('SELECT id, asin, name, seq, status, listed_at FROM products');
    const productMap = new Map(existingRows.map(p => [String(p.asin).toUpperCase(), p]));

    const stats = {
        total_rows: lines.length - 1,
        unique_asin: byAsin.size,
        products_created: 0,
        products_updated: 0,
        listed_at_updated: 0,
        status_set_abandoned: 0,
        products_unchanged: 0,
        skipped_no_date: 0,
        errors: []
    };

    for (const [asin, row] of byAsin) {
        try {
            if (!row.openDate) {
                stats.skipped_no_date++;
                stats.errors.push(`第 ${row.rowIndex} 行 ASIN ${asin}: 无法解析 open-date`);
                continue;
            }

            const product = productMap.get(asin);

            if (!product) {
                const name = row.name || asin;
                const seq = row.site || null;
                const status = row.productStatus || '待处理';
                await runSql(
                    'INSERT INTO products (asin, name, seq, status, listed_at, operating_started_at) VALUES (?, ?, ?, ?, ?, NOW())',
                    [asin, name, seq, status, row.openDate]
                );
                const created = await queryOne(
                    'SELECT id, asin, name, seq, status, listed_at FROM products WHERE asin = ?',
                    [asin]
                );
                productMap.set(asin, created);
                await ensureRecordsForProduct(created.id);
                await ensureEconomicsForProduct(created.id, runSql);
                await recalculateProductProgress(created.id);
                await enqueueOperatingDaysTask({ productId: created.id, asin, seq });
                stats.products_created++;
                stats.listed_at_updated++;
                if (status === ABANDONED_STATUS) stats.status_set_abandoned++;
                continue;
            }

            const nextName = row.name || product.name;
            const nextSeq = product.seq || row.site || null;
            const nextStatus = row.productStatus === ABANDONED_STATUS ? ABANDONED_STATUS : product.status;
            const listedAtChanged = formatDbDateTime(product.listed_at) !== row.openDate;
            const nameChanged = nextName !== product.name;
            const seqChanged = nextSeq !== product.seq;
            const statusChanged = nextStatus !== product.status;

            if (!listedAtChanged && !nameChanged && !seqChanged && !statusChanged) {
                stats.products_unchanged++;
                continue;
            }

            await runSql(
                'UPDATE products SET name = ?, seq = ?, status = ?, listed_at = ?, updated_at = NOW() WHERE id = ?',
                [nextName, nextSeq, nextStatus, row.openDate, product.id]
            );
            product.status = nextStatus;
            stats.products_updated++;
            if (listedAtChanged) stats.listed_at_updated++;
            if (statusChanged && nextStatus === ABANDONED_STATUS) stats.status_set_abandoned++;
        } catch (e) {
            stats.errors.push(`第 ${row.rowIndex} 行 ASIN ${asin}: ${e.message}`);
        }
    }

    return stats;
}

module.exports = { importInventoryReportTxt, INVENTORY_REPORT_PATH, parseOpenDate };
