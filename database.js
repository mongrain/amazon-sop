require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
// Database config - override via environment variables
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sop_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool = null;

/**
 * Get the connection pool (singleton).
 */
function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

/**
 * Initialize the database: create tables if not exist, seed data if empty.
 */
async function initDb() {
    const p = getPool();

    // Create tables
    const sqlFile = path.join(__dirname, 'init.sql');
    if (fs.existsSync(sqlFile)) {
        const sql = fs.readFileSync(sqlFile, 'utf-8');
        // Split by semicolons and execute each statement
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
        for (const stmt of statements) {
            try {
                await p.execute(stmt);
            } catch (e) {
                // Ignore "duplicate" errors (table already exists, etc.)
                if (!e.message.includes('Duplicate') && !e.message.includes('ER_TABLE_EXISTS_EXIST')) {
                    // Silently skip known safe errors
                }
            }
        }
    }

    // Verify seed data exists
    const [rows] = await p.execute('SELECT COUNT(*) as cnt FROM sop_modules');
    if (rows[0].cnt === 0) {
        console.log('Seeding SOP template data...');
        await seedSopData(p);
    }

    // Ensure image_url column exists in sop_items (migration)
    try {
        await p.execute('ALTER TABLE sop_items ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER instruction_text');
    } catch (e) {
        if (!e.message.includes('Duplicate column')) {
            // Silently skip
        }
    }

    // Ensure image_url column exists in product_sop_records (migration)
    try {
        await p.execute('ALTER TABLE product_sop_records ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER remark');
    } catch (e) {
        if (!e.message.includes('Duplicate column')) {
            // Silently skip
        }
    }
}

/**
 * Seed SOP template data (fallback if init.sql wasn't used).
 */
async function seedSopData(p) {
    const sopData = require('./sop-data');
    const [result] = await p.execute('SELECT id, name FROM sop_modules ORDER BY sort_order');
    const modMap = {};
    result.forEach(row => { modMap[row.name] = row.id; });

    for (const mod of sopData.modules) {
        const moduleId = modMap[mod.name];
        for (const item of mod.items) {
            await p.execute(
                'INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES (?, ?, ?, ?, ?)',
                [moduleId, item.name, item.instruction_text || null, item.sort_order, item.is_data_column ? 1 : 0]
            );
        }
    }
}

// ========== Helper Functions (promise-based) ==========

async function queryAll(sql, params = []) {
    const pool = getPool();
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

async function runSql(sql, params = []) {
    const pool = getPool();
    await pool.execute(sql, params);
}

async function getModulesWithItems() {
    const modules = await queryAll('SELECT * FROM sop_modules ORDER BY sort_order');
    const result = [];
    for (const m of modules) {
        const items = await queryAll('SELECT * FROM sop_items WHERE module_id = ? ORDER BY sort_order', [m.id]);
        result.push({ ...m, sop_items: items });
    }
    return result;
}

async function calculateProgress(productId, moduleId = null) {
    let sql = `
        SELECT COUNT(*) as total FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id = ? AND si.is_data_column = 0
    `;
    let params = [productId];
    if (moduleId) {
        sql += ' AND si.module_id = ?';
        params.push(moduleId);
    }

    const totalRes = await queryOne(sql, params);
    const total = totalRes ? totalRes.total : 0;
    if (total === 0) return 0;

    let completedSql = `
        SELECT COUNT(*) as cnt FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id = ? AND si.is_data_column = 0 AND psr.status = '已完成'
    `;
    let completedParams = [productId];
    if (moduleId) {
        completedSql += ' AND si.module_id = ?';
        completedParams.push(moduleId);
    }

    const completedRes = await queryOne(completedSql, completedParams);
    const completed = completedRes ? completedRes.cnt : 0;
    return Math.round(completed / total * 10000) / 10000;
}

async function getModuleProgress(productId, moduleId) {
    const total = await queryOne(`
        SELECT COUNT(*) as cnt FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id = ? AND si.module_id = ? AND si.is_data_column = 0
    `, [productId, moduleId]);

    const completed = await queryOne(`
        SELECT COUNT(*) as cnt FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id = ? AND si.module_id = ? AND si.is_data_column = 0
        AND psr.status = '已完成'
    `, [productId, moduleId]);

    const t = total ? total.cnt : 0;
    const c = completed ? completed.cnt : 0;
    return { completed: c, total: t, percentage: t > 0 ? Math.round(c / t * 10000) / 10000 : 0 };
}

async function ensureRecordsForProduct(productId) {
    const items = await queryAll('SELECT id FROM sop_items');
    for (const item of items) {
        await runSql('INSERT IGNORE INTO product_sop_records (product_id, sop_item_id) VALUES (?, ?)', [productId, item.id]);
    }
}

async function recalculateProductProgress(productId) {
    const progress = await calculateProgress(productId);
    await runSql('UPDATE products SET overall_progress = ?, updated_at = NOW() WHERE id = ?', [progress, productId]);
}

module.exports = { initDb, getPool, queryAll, queryOne, runSql, getModulesWithItems, calculateProgress, getModuleProgress, ensureRecordsForProduct, recalculateProductProgress };
