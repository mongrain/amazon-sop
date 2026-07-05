const XLSX = require('xlsx');
const path = require('path');
const { runSql, queryAll, ensureRecordsForProduct, recalculateProductProgress } = require('./database');
const { enqueueOperatingDaysTask } = require('./service/operating-days-queue');

const EXCEL_PATH = path.join(__dirname, '..', '复核审核表.xlsx');

/**
 * Infer SOP status from cell text.
 */
function inferStatus(text) {
    if (!text || !String(text).trim()) return null;
    text = String(text).trim();

    const completedKeywords = ['已完成', '已注册', '已提交', '已开启', '已优化', '已增加',
        '已收集', '已设置', '已更新', '已切换', '已填写', '已补充',
        '已分析', '已做好', '新增', '已开', '已提高', '已下降'];
    const inProgressKeywords = ['新开', '补充', '进行中', '优化中', '提升中'];
    const skipKeywords = ['先不', '先不做', '跳过', '暂无', '无秒杀', '无站外', '不用'];

    for (const kw of skipKeywords) {
        if (text.includes(kw)) return '跳过';
    }
    for (const kw of completedKeywords) {
        if (text.includes(kw)) return '已完成';
    }
    for (const kw of inProgressKeywords) {
        if (text.includes(kw)) return '进行中';
    }

    return '进行中';
}

/**
 * Import Excel data into database.
 * Returns a Promise with the import result.
 */
async function importExcel() {
    const fs = require('fs');
    if (!fs.existsSync(EXCEL_PATH)) {
        return { error: `Excel file not found: ${EXCEL_PATH}` };
    }

    const wb = XLSX.readFile(EXCEL_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const stats = { products_added: 0, records_created: 0, errors: [] };

    const row2 = json[1] || [];
    const productRows = json.slice(2);

    // Build sop_items lookup: map column index -> sop_item_id
    const allItems = await queryAll('SELECT id, name FROM sop_items ORDER BY sort_order');

    const colToItemId = {};
    for (const item of allItems) {
        const itemName = item.name;
        if (!itemName) continue;
        for (let colIdx = 0; colIdx < (row2.length || 200); colIdx++) {
            const cellVal = row2[colIdx];
            if (cellVal && String(cellVal).includes(itemName)) {
                colToItemId[colIdx] = item.id;
                break;
            }
        }
    }

    // Process each product row
    for (const row of productRows) {
        if (!row || row.length < 3) continue;

        const asin = row[2]; // Column C (index 2)
        if (!asin || !String(asin).trim()) continue;

        const asinStr = String(asin).trim();
        const seq = row[0] || '';
        const name = row[3] || '';
        const category = row[1] || '';

        // Insert or update product (MySQL ON DUPLICATE KEY UPDATE)
        try {
            const productResult = await runSql(`
                INSERT INTO products (seq, asin, name, category, excel_row, operating_started_at)
                VALUES (?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    id = LAST_INSERT_ID(id),
                    name = VALUES(name),
                    category = VALUES(category),
                    excel_row = VALUES(excel_row),
                    operating_started_at = COALESCE(operating_started_at, created_at),
                    updated_at = NOW()
            `, [String(seq), asinStr, String(name), String(category), json.indexOf(row) + 1]);
            stats.products_added++;
            const productId = productResult && productResult.insertId ? productResult.insertId : null;
            const isNewProduct = productResult && productResult.affectedRows === 1;
            if (!productId) {
                stats.errors.push(`ASIN ${asinStr}: 无法获取产品ID`);
                continue;
            }

            // Ensure all SOP records exist for this product
            await ensureRecordsForProduct(productId);
            if (isNewProduct) {
                await enqueueOperatingDaysTask({ productId, asin: asinStr, seq: String(seq) });
            }

            // Read cell values and map to sop_items
            for (const [colIdx, sopItemId] of Object.entries(colToItemId)) {
                const colIndex = parseInt(colIdx, 10);
                const cellVal = row[colIndex];
                if (cellVal !== undefined && cellVal !== '' && String(cellVal).trim()) {
                    const cellText = String(cellVal).trim();
                    const status = inferStatus(cellText);
                    await runSql(`
                        UPDATE product_sop_records SET
                            status = COALESCE(?, status),
                            remark = ?,
                            updated_at = NOW()
                        WHERE product_id = ? AND sop_item_id = ?
                    `, [status, cellText, productId, sopItemId]);
                    stats.records_created++;
                }
            }

            await recalculateProductProgress(productId);
        } catch (e) {
            stats.errors.push(`ASIN ${asinStr}: ${e.message}`);
            continue;
        }
    }

    return stats;
}

module.exports = { importExcel, EXCEL_PATH };
