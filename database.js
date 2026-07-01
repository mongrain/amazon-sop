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
        if (!isSafeMigrationError(e)) {}
    }

    // Ensure image_url column exists in product_sop_records (migration)
    try {
        await p.query('ALTER TABLE product_sop_records ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER remark');
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
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
        if (!isSafeMigrationError(e)) {}
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

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS annual_activities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            year INT NOT NULL,
            month TINYINT NOT NULL,
            activity_title VARCHAR(500) DEFAULT NULL,
            action_plan TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_year_month (year, month),
            INDEX idx_year (year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            password_hash VARCHAR(200) DEFAULT NULL,
            must_change_password TINYINT DEFAULT 0 COMMENT '1: 首次登录须改密',
            role ENUM('OPS','DESIGN','MANAGER') NOT NULL DEFAULT 'OPS',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_user_name (name),
            INDEX idx_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query('ALTER TABLE users ADD COLUMN password_hash VARCHAR(200) DEFAULT NULL AFTER name');
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query('ALTER TABLE users ADD COLUMN must_change_password TINYINT DEFAULT 0 COMMENT \'1: 首次登录须改密\' AFTER password_hash');
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS daily_rants (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            content LONGTEXT,
            rant_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_rant_date (rant_date),
            INDEX idx_user_date (user_id, rant_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS sprint_projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            asin VARCHAR(30) NOT NULL,
            owner_id INT DEFAULT NULL,
            status ENUM('ACTIVE','MAINTENANCE','STOPPED') NOT NULL DEFAULT 'ACTIVE',
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            target_cycle_days DECIMAL(10,2) NOT NULL DEFAULT 14.00 COMMENT '目标周期天数(可为小数)',
            current_daily_orders DECIMAL(10,4) DEFAULT NULL COMMENT '当前日均单量(可为小数)',
            target_daily_orders DECIMAL(10,4) DEFAULT NULL COMMENT '目标日均单量(可为小数)',
            current_rank INT DEFAULT NULL,
            target_rank INT DEFAULT NULL,
            promo_tacos_limit DECIMAL(10,2) DEFAULT NULL,
            stable_tacos_target DECIMAL(10,2) DEFAULT NULL,
            max_loss_7d DECIMAL(10,2) DEFAULT NULL,
            inventory_days INT DEFAULT NULL,
            competitor_action TEXT,
            page_ok TINYINT DEFAULT 0,
            exit_conditions TEXT,
            profit_margin DECIMAL(6,2) DEFAULT NULL,
            acos_limit DECIMAL(10,2) DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_sprint_asin (asin),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_status (status),
            INDEX idx_owner (owner_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(
            `ALTER TABLE sprint_projects
             MODIFY COLUMN target_cycle_days DECIMAL(10,2) NOT NULL DEFAULT 14.00 COMMENT '目标周期天数(可为小数)',
             MODIFY COLUMN current_daily_orders DECIMAL(10,4) DEFAULT NULL COMMENT '当前日均单量(可为小数)',
             MODIFY COLUMN target_daily_orders DECIMAL(10,4) DEFAULT NULL COMMENT '目标日均单量(可为小数)'`
        );
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS weekly_reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sprint_id INT NOT NULL,
            week_start_date DATE NOT NULL,
            status ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
            actual_max_loss DECIMAL(10,2) DEFAULT NULL,
            actual_tacos DECIMAL(10,2) DEFAULT NULL,
            decision ENUM('CONTINUE','MAINTENANCE','STOPPED') DEFAULT NULL,
            summary TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_sprint_week (sprint_id, week_start_date),
            FOREIGN KEY (sprint_id) REFERENCES sprint_projects(id) ON DELETE CASCADE,
            INDEX idx_review_status (status),
            INDEX idx_week (week_start_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS daily_asin_metrics (
            id INT AUTO_INCREMENT PRIMARY KEY,
            asin VARCHAR(30) NOT NULL,
            record_date DATE NOT NULL,
            data_source ENUM('MANUAL','RPA_BOT') NOT NULL DEFAULT 'MANUAL',
            sessions INT DEFAULT NULL,
            orders INT DEFAULT NULL,
            impressions INT DEFAULT NULL,
            clicks INT DEFAULT NULL,
            ad_spend DECIMAL(12,2) DEFAULT NULL,
            ad_sales DECIMAL(12,2) DEFAULT NULL,
            total_sales DECIMAL(12,2) DEFAULT NULL,
            ad_orders INT DEFAULT NULL,
            core_kw_rank INT DEFAULT NULL,
            bsr_rank INT DEFAULT NULL,
            acos DECIMAL(10,4) DEFAULT NULL,
            tacos DECIMAL(10,4) DEFAULT NULL,
            ctr DECIMAL(10,6) DEFAULT NULL,
            cvr DECIMAL(10,6) DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_asin_date (asin, record_date),
            INDEX idx_record_date (record_date),
            INDEX idx_source_date (data_source, record_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS metric_insights (
            id INT AUTO_INCREMENT PRIMARY KEY,
            asin VARCHAR(30) NOT NULL,
            record_date DATE NOT NULL,
            insight_type VARCHAR(50) NOT NULL,
            message VARCHAR(500) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_asin_date (asin, record_date),
            INDEX idx_type (insight_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS knowledge_docs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(500) NOT NULL,
            content LONGTEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS knowledge_drafts (
            user_id INT NOT NULL PRIMARY KEY,
            doc_id INT DEFAULT NULL,
            title VARCHAR(500) DEFAULT '',
            content LONGTEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS issue_tickets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sprint_id INT DEFAULT NULL,
            asin VARCHAR(30) NOT NULL,
            ticket_type VARCHAR(50) NOT NULL,
            severity ENUM('S','A','B','C') DEFAULT 'B',
            owner_id INT DEFAULT NULL,
            co_owner_id INT DEFAULT NULL,
            status ENUM('TODO','PENDING_DESIGN','WAITING_VERIFY','RESOLVED','FAILED') NOT NULL DEFAULT 'TODO',
            sla_deadline DATETIME DEFAULT NULL,
            trigger_reason TEXT,
            design_request TEXT,
            design_asset_url VARCHAR(1000) DEFAULT NULL,
            verify_evidence TEXT,
            verify_file_url VARCHAR(1000) DEFAULT NULL,
            resolved_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (sprint_id) REFERENCES sprint_projects(id) ON DELETE SET NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (co_owner_id) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_status_deadline (status, sla_deadline),
            INDEX idx_asin_created (asin, created_at),
            INDEX idx_sprint (sprint_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // Silently skip
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS exchange_rates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pair VARCHAR(20) NOT NULL DEFAULT 'USD/CNY',
            rate DECIMAL(12,6) NOT NULL,
            fetched_at DATETIME NOT NULL,
            UNIQUE KEY uk_pair (pair)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS product_economics (
            product_id INT NOT NULL PRIMARY KEY,
            length_cm DECIMAL(10,2) DEFAULT NULL,
            width_cm DECIMAL(10,2) DEFAULT NULL,
            height_cm DECIMAL(10,2) DEFAULT NULL,
            selling_price_usd DECIMAL(12,2) DEFAULT NULL,
            gross_weight_kg DECIMAL(10,3) DEFAULT NULL,
            units_per_box INT DEFAULT 1,
            cost_price_rmb DECIMAL(12,2) DEFAULT NULL,
            first_leg_usd DECIMAL(12,4) DEFAULT NULL,
            first_leg_manual TINYINT DEFAULT 0,
            tax_usd DECIMAL(12,2) DEFAULT 0,
            misc_fee_usd DECIMAL(12,2) DEFAULT NULL,
            ad_spend_usd DECIMAL(12,4) DEFAULT NULL,
            ad_spend_manual TINYINT DEFAULT 0,
            last_mile_fee_usd DECIMAL(12,4) DEFAULT NULL,
            last_mile_fee_manual TINYINT DEFAULT 0,
            order_velocity DECIMAL(12,2) DEFAULT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS amc_schemas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            translation VARCHAR(255) DEFAULT '',
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query("ALTER TABLE amc_schemas ADD COLUMN translation VARCHAR(255) DEFAULT '' AFTER name");
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS amc_schema_fields (
            id INT AUTO_INCREMENT PRIMARY KEY,
            schema_id INT NOT NULL,
            amazon_field VARCHAR(255) NOT NULL,
            translation VARCHAR(255) DEFAULT '',
            field_type VARCHAR(50) NOT NULL DEFAULT 'string',
            description TEXT,
            agg_threshold VARCHAR(20) NOT NULL DEFAULT 'NONE',
            sort_order INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_schema_sort (schema_id, sort_order),
            FOREIGN KEY (schema_id) REFERENCES amc_schemas(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS amc_sql_scripts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            group_id INT NOT NULL,
            version INT NOT NULL DEFAULT 1,
            name VARCHAR(255) NOT NULL,
            sql_content LONGTEXT NOT NULL,
            schema_id INT DEFAULT NULL,
            selected_fields JSON DEFAULT NULL,
            note TEXT,
            created_by INT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_group_version (group_id, version),
            INDEX idx_created (created_at),
            FOREIGN KEY (schema_id) REFERENCES amc_schemas(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query(
            "ALTER TABLE amc_schema_fields MODIFY COLUMN agg_threshold VARCHAR(20) NOT NULL DEFAULT 'NONE'"
        );
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
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

    try {
        await p.query(`CREATE TABLE IF NOT EXISTS ai_agents (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(32) NOT NULL UNIQUE,
            name VARCHAR(64) NOT NULL,
            avatar_emoji VARCHAR(8) DEFAULT NULL,
            role_description TEXT,
            system_prompt TEXT,
            status ENUM('idle','busy','reviewing') DEFAULT 'idle',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await p.query(`CREATE TABLE IF NOT EXISTS ai_office_tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            context_json JSON DEFAULT NULL,
            created_by INT DEFAULT NULL,
            assigned_agent_id INT DEFAULT NULL,
            parent_task_id INT DEFAULT NULL,
            status ENUM('QUEUED','IN_PROGRESS','PENDING_REVIEW','DONE','REJECTED','FAILED') DEFAULT 'QUEUED',
            priority ENUM('LOW','NORMAL','HIGH') DEFAULT 'NORMAL',
            input_payload JSON DEFAULT NULL,
            output_markdown LONGTEXT DEFAULT NULL,
            review_comment TEXT DEFAULT NULL,
            error_message TEXT DEFAULT NULL,
            retry_count INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at DATETIME DEFAULT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (assigned_agent_id) REFERENCES ai_agents(id) ON DELETE SET NULL,
            FOREIGN KEY (parent_task_id) REFERENCES ai_office_tasks(id) ON DELETE CASCADE,
            INDEX idx_status (status),
            INDEX idx_parent (parent_task_id),
            INDEX idx_agent (assigned_agent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await p.query(`CREATE TABLE IF NOT EXISTS ai_office_task_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            task_id INT NOT NULL,
            agent_id INT DEFAULT NULL,
            log_type ENUM('system','agent','review') DEFAULT 'system',
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES ai_office_tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE SET NULL,
            INDEX idx_task (task_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        if (!isSafeMigrationError(e)) console.error('AI Office migration error:', e);
    }

    try {
        await p.query('ALTER TABLE products ADD COLUMN link_group_id INT DEFAULT NULL COMMENT \'关联 ASIN 组 ID\' AFTER excel_row');
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        await p.query('ALTER TABLE products ADD INDEX idx_link_group (link_group_id)');
    } catch (e) {
        if (!isSafeMigrationError(e)) {}
    }

    try {
        const agentRows = await p.query('SELECT COUNT(*) as cnt FROM ai_agents', { type: QueryTypes.SELECT });
        if (agentRows[0].cnt === 0) {
            const agents = [
                ['boss', '老板', '👔', '拆解任务、定优先级、自动分派', '你是 Amazon 运营团队的老板。收到任务后，将其拆解为可执行的子任务，并指定由 designer、analyst、researcher 中的谁负责。\n必须直接返回 JSON，不要 Markdown 标记。格式：\n{"subtasks":[{"title":"子任务标题","description":"详细说明","agent_code":"designer|analyst|researcher"}]}'],
                ['supervisor', '主管', '📋', '审核所有 AI 产出', '你是 Amazon 运营团队的主管。审核下属 AI 的工作产出，判断是否符合要求。\n必须直接返回 JSON：{"approved":true/false,"comment":"审核意见"}'],
                ['designer', '设计', '🎨', 'Listing 视觉、素材方案', '你是 Amazon Listing 设计专家。根据任务描述输出 Markdown 格式的视觉方案或素材建议，结构清晰、可执行。'],
                ['analyst', '数据分析', '📊', '指标解读、趋势复盘', '你是 Amazon 数据分析专家。根据任务描述输出 Markdown 格式的数据分析报告，包含关键结论与建议。'],
                ['researcher', '竞品调研', '🔍', '竞品分析、选品洞察', '你是 Amazon 竞品调研专家。根据任务描述输出 Markdown 格式的竞品/市场分析报告，包含可行动洞察。']
            ];
            for (const [code, name, emoji, desc, prompt] of agents) {
                await p.query(
                    'INSERT INTO ai_agents (code, name, avatar_emoji, role_description, system_prompt) VALUES (?, ?, ?, ?, ?)',
                    buildQueryOptions([code, name, emoji, desc, prompt])
                );
            }
        }
    } catch (e) {
        if (!isSafeMigrationError(e)) console.error('AI Office seed error:', e);
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
    const [result, metadata] = await pool.query(sql, buildQueryOptions(params));
    // Sequelize 6 INSERT 时 result 为数字 insertId，需归一化为 OkPacket 结构
    if (typeof result === 'number') {
        return { insertId: result, affectedRows: metadata };
    }
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
