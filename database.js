require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sop_system'
};

let sequelize = null;

function getPool() {
    if (!sequelize) {
        sequelize = new Sequelize(dbConfig.database, dbConfig.user, dbConfig.password, {
            host: dbConfig.host,
            port: dbConfig.port,
            dialect: 'mysql',
            logging: false,
            benchmark: false,
            dialectOptions: {
                connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
            },
            pool: {
                max: Number(process.env.DB_POOL_MAX || 15),
                min: Number(process.env.DB_POOL_MIN || 0),
                acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
                idle: Number(process.env.DB_POOL_IDLE || 10000),
                evict: Number(process.env.DB_POOL_EVICT || 1000)
            }
        });
    }
    return sequelize;
}

function buildQueryOptions(params = [], options = {}) {
    return {
        replacements: params,
        raw: true,
        ...options
    };
}

function buildInClause(values) {
    return values.map(() => '?').join(', ');
}

function isSafeMigrationError(error) {
    const message = error && error.message ? error.message : '';
    return [
        'Duplicate',
        'ER_TABLE_EXISTS_ERROR',
        'Duplicate column',
        'Duplicate key name',
        'already exists'
    ].some(text => message.includes(text));
}

/**
 * Initialize the database: create tables if not exist, seed data if empty.
 */
async function initDb() {
    const p = getPool();
    await p.authenticate();

    // Create tables
    const sqlFile = path.join(__dirname, 'init.sql');
    if (fs.existsSync(sqlFile)) {
        const sql = fs.readFileSync(sqlFile, 'utf-8');
        // Split by semicolons and execute each statement
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
        for (const stmt of statements) {
            try {
                await p.query(stmt);
            } catch (e) {
                // Ignore "duplicate" errors (table already exists, etc.)
                if (!isSafeMigrationError(e)) {
                    // Silently skip known safe errors
                }
            }
        }
    }

    // Verify seed data exists
    const rows = await p.query('SELECT COUNT(*) as cnt FROM sop_modules', {
        type: QueryTypes.SELECT
    });
    if (rows[0].cnt === 0) {
        console.log('Seeding SOP template data...');
        await seedSopData(p);
    }

    // Ensure image_url column exists in sop_items (migration)
    try {
        await p.query('ALTER TABLE sop_items ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER instruction_text');
    } catch (e) {
        if (!isSafeMigrationError(e)) {
            // Silently skip
        }
    }

    // Ensure image_url column exists in product_sop_records (migration)
    try {
        await p.query('ALTER TABLE product_sop_records ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER remark');
    } catch (e) {
        if (!isSafeMigrationError(e)) {
            // Silently skip
        }
    }

    // Ensure product_versions table exists (migration)
    try {
        await p.query(`CREATE TABLE IF NOT EXISTS product_versions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_id INT NOT NULL,
            version_number INT NOT NULL,
            version_name VARCHAR(200) DEFAULT NULL,
            snapshot_data LONGTEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE KEY uk_product_version (product_id, version_number),
            INDEX idx_product (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    // Ensure competitors table has brand_category (migration)
    try {
        await p.query('ALTER TABLE competitors ADD COLUMN brand_category VARCHAR(200) DEFAULT NULL AFTER brand_name');
    } catch (e) {
        if (!isSafeMigrationError(e)) {
            // Silently skip
        }
    }

    // Ensure competitor_actions table exists (migration)
    try {
        await p.query(`CREATE TABLE IF NOT EXISTS competitor_actions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            competitor_id INT NOT NULL,
            action_text TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
            INDEX idx_competitor_created (competitor_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    // Ensure competitor_monitor_records table exists (migration)
    try {
        await p.query(`CREATE TABLE IF NOT EXISTS competitor_monitor_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            competitor_id INT NOT NULL,
            image_url VARCHAR(1000) NOT NULL,
            has_change TINYINT DEFAULT 0 COMMENT '0: 无变化, 1: 有变化',
            action_text TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
            INDEX idx_competitor_monitor_created (competitor_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    // Add composite indexes that match the hot query paths.
    try {
        await p.query('ALTER TABLE sop_items ADD INDEX idx_module_sort (module_id, sort_order)');
    } catch (e) {
        if (!isSafeMigrationError(e)) {
            // Silently skip
        }
    }

    try {
        await p.query('ALTER TABLE product_sop_records ADD INDEX idx_product_status_item (product_id, status, sop_item_id)');
    } catch (e) {
        if (!isSafeMigrationError(e)) {
            // Silently skip
        }
    }

    // Migration: unify "更新日期" / 站外推广"日期" to "更新时间"
    // The display name must match the field that auto-tracks product_sop_records.updated_at
    try {
        const legacy = await p.query(
            "SELECT si.id, si.module_id FROM sop_items si JOIN sop_modules sm ON si.module_id = sm.id " +
            "WHERE (si.name = '更新日期') OR (si.name = '日期' AND sm.name = '站外推广')",
            { type: QueryTypes.SELECT }
        );
        for (const row of legacy) {
            // Only rename if the module doesn't already have a "更新时间" item (avoid duplicates)
            const exists = await p.query(
                "SELECT id FROM sop_items WHERE module_id = ? AND name = '更新时间'",
                buildQueryOptions([row.module_id], { type: QueryTypes.SELECT })
            );
            if (exists.length === 0) {
                await p.query(
                    "UPDATE sop_items SET name = '更新时间' WHERE id = ?",
                    buildQueryOptions([row.id])
                );
            }
        }
    } catch (e) {
        // Silently skip migration errors
    }
}

/**
 * Seed SOP template data (fallback if init.sql wasn't used).
 */
async function seedSopData(p) {
    const sopData = require('./sop-data');
    const result = await p.query('SELECT id, name FROM sop_modules ORDER BY sort_order', {
        type: QueryTypes.SELECT
    });
    const modMap = {};
    result.forEach(row => { modMap[row.name] = row.id; });

    for (const mod of sopData.modules) {
        const moduleId = modMap[mod.name];
        for (const item of mod.items) {
            await p.query(
                'INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES (?, ?, ?, ?, ?)',
                buildQueryOptions([moduleId, item.name, item.instruction_text || null, item.sort_order, item.is_data_column ? 1 : 0])
            );
        }
    }
}

// ========== Helper Functions (promise-based) ==========

async function queryAll(sql, params = []) {
    const pool = getPool();
    return pool.query(sql, buildQueryOptions(params, { type: QueryTypes.SELECT }));
}

async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

async function runSql(sql, params = []) {
    const pool = getPool();
    const [result] = await pool.query(sql, buildQueryOptions(params));
    return result;
}

async function getModulesWithItems() {
    const [modules, items] = await Promise.all([
        queryAll('SELECT * FROM sop_modules ORDER BY sort_order'),
        queryAll('SELECT * FROM sop_items ORDER BY module_id ASC, sort_order ASC')
    ]);
    const itemMap = new Map();
    for (const item of items) {
        if (!itemMap.has(item.module_id)) {
            itemMap.set(item.module_id, []);
        }
        itemMap.get(item.module_id).push(item);
    }
    return modules.map(module => ({
        ...module,
        sop_items: itemMap.get(module.id) || []
    }));
}

function buildProgress(total, completed) {
    const safeTotal = Number(total) || 0;
    const safeCompleted = Number(completed) || 0;
    return {
        completed: safeCompleted,
        total: safeTotal,
        percentage: safeTotal > 0 ? Math.round(safeCompleted / safeTotal * 10000) / 10000 : 0
    };
}

async function getProductModuleProgressMap(productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
        return {};
    }

    const placeholders = buildInClause(productIds);
    const rows = await queryAll(`
        SELECT
            psr.product_id,
            si.module_id,
            SUM(CASE WHEN si.is_data_column = 0 THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN si.is_data_column = 0 AND psr.status = '已完成' THEN 1 ELSE 0 END) AS completed
        FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id IN (${placeholders})
        GROUP BY psr.product_id, si.module_id
    `, productIds);

    const progressMap = {};
    for (const row of rows) {
        if (!progressMap[row.product_id]) {
            progressMap[row.product_id] = {};
        }
        progressMap[row.product_id][row.module_id] = buildProgress(row.total, row.completed);
    }
    return progressMap;
}

async function calculateProgress(productId, moduleId = null) {
    let sql = `
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN psr.status = '已完成' THEN 1 ELSE 0 END) AS completed
        FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id = ? AND si.is_data_column = 0
    `;
    let params = [productId];
    if (moduleId) {
        sql += ' AND si.module_id = ?';
        params.push(moduleId);
    }

    const totalRes = await queryOne(sql, params);
    const total = totalRes ? Number(totalRes.total) : 0;
    if (total === 0) return 0;
    const completed = totalRes ? Number(totalRes.completed) : 0;
    return Math.round(completed / total * 10000) / 10000;
}

async function getModuleProgress(productId, moduleId) {
    const progress = await queryOne(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN psr.status = '已完成' THEN 1 ELSE 0 END) AS completed
        FROM product_sop_records psr
        JOIN sop_items si ON psr.sop_item_id = si.id
        WHERE psr.product_id = ? AND si.module_id = ? AND si.is_data_column = 0
    `, [productId, moduleId]);

    return buildProgress(progress ? progress.total : 0, progress ? progress.completed : 0);
}

async function ensureRecordsForProduct(productId) {
    await runSql(`
        INSERT IGNORE INTO product_sop_records (product_id, sop_item_id)
        SELECT ?, si.id
        FROM sop_items si
        LEFT JOIN product_sop_records psr
            ON psr.product_id = ? AND psr.sop_item_id = si.id
        WHERE psr.id IS NULL
    `, [productId, productId]);
}

async function recalculateProductProgress(productId) {
    const progress = await calculateProgress(productId);
    await runSql('UPDATE products SET overall_progress = ?, updated_at = NOW() WHERE id = ?', [progress, productId]);
}

module.exports = {
    initDb,
    getPool,
    queryAll,
    queryOne,
    runSql,
    getModulesWithItems,
    getProductModuleProgressMap,
    calculateProgress,
    getModuleProgress,
    ensureRecordsForProduct,
    recalculateProductProgress
};
