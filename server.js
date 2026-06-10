const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const { initDb, queryAll, queryOne, runSql, getModulesWithItems, getModuleProgress, calculateProgress, ensureRecordsForProduct, recalculateProductProgress } = require('./database');
const { importExcel, EXCEL_PATH } = require('./importer');
const sopData = require('./sop-data');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('view cache', true);
app.set('views', path.join(__dirname, 'views'));

// Multer config for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|png|gif|webp|bmp)$/.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('只支持图片格式 (jpg, png, gif, webp, bmp)'));
        }
    }
});

// Initialize database on startup
initDb().then(() => {
    console.log('Database initialized');
}).catch(err => {
    console.error('Database init failed:', err);
    console.error('Check your MySQL connection settings in database.js or .env');
});

// ========== Routes ==========

app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

/**
 * Build a module-name → item-name → table_ref lookup from sop-data.js.
 * Used to enrich DB-sourced items so views can identify the data source of a field.
 */
function buildTableRefMap() {
    const refMap = {};
    for (const mod of sopData.modules) {
        const itemMap = {};
        for (const item of mod.items) {
            if (item.table_ref) {
                itemMap[item.name] = item.table_ref;
            }
        }
        refMap[mod.name] = itemMap;
    }
    return refMap;
}

app.get('/dashboard', async (req, res) => {
    try {
        const { search = '', category = '', status = '' } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = 15;
        const offset = (page - 1) * pageSize;

        const modules = await queryAll('SELECT * FROM sop_modules ORDER BY sort_order');

        const whereParts = ['1=1'];
        const filterParams = [];
        if (search) {
            whereParts.push('(asin LIKE ? OR name LIKE ?)');
            filterParams.push(`%${search}%`, `%${search}%`);
        }
        if (category) {
            whereParts.push('category = ?');
            filterParams.push(category);
        }
        if (status) {
            whereParts.push('status = ?');
            filterParams.push(status);
        }
        const whereSql = whereParts.join(' AND ');

        const totalRow = await queryOne(`SELECT COUNT(*) AS cnt FROM products WHERE ${whereSql}`, filterParams);
        const total = totalRow ? totalRow.cnt : 0;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        // Aggregate stats across the full filtered set, not just the current page
        const statRows = await queryAll(
            `SELECT status, COUNT(*) AS cnt FROM products WHERE ${whereSql} GROUP BY status`,
            filterParams
        );
        const stats = { total, '待处理': 0, '进行中': 0, '已完成': 0, '跳过': 0 };
        for (const r of statRows) {
            if (r.status && Object.prototype.hasOwnProperty.call(stats, r.status)) {
                stats[r.status] = r.cnt;
            }
        }

        let sql = `SELECT id, asin, name, category, status, overall_progress, excel_row FROM products WHERE ${whereSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`;
        let products = await queryAll(sql, [...filterParams, pageSize, offset]);

        // Enrich with module progress
        products = await Promise.all(products.map(async (p) => {
            const p2 = { ...p };
            p2.module_progress = {};
            for (const m of modules) {
                p2.module_progress[m.id] = await getModuleProgress(p.id, m.id);
            }
            return p2;
        }));

        const categories = await queryAll('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');

        const isHtmx = req.headers['hx-request'] === 'true';

        res.render('dashboard', {
            products, modules,
            categories: categories.map(r => r.category),
            current_search: search,
            current_category: category,
            current_status: status,
            page, pageSize, total, totalPages, stats,
            is_htmx: isHtmx,
            title: '产品看板'
        });
    } catch (e) {
        console.error('Dashboard error:', e);
        res.status(500).send('Server error: ' + e.message);
    }
});

app.get('/product/:asin', async (req, res) => {
    try {
        const { asin } = req.params;
        const product = await queryOne('SELECT * FROM products WHERE asin = ?', [asin]);
        if (!product) return res.status(404).send('Product not found');

        const allModules = await getModulesWithItems();
        // Filter out 基础信息 (sort_order=1)
        const modules = allModules.filter(m => m.sort_order > 1);

        // Enrich items with table_ref so views can identify fields by data source
        const refMap = buildTableRefMap();
        for (const mod of modules) {
            const itemRefs = refMap[mod.name] || {};
            mod.sop_items = mod.sop_items.map(item => ({
                ...item,
                table_ref: itemRefs[item.name] || null
            }));
        }

        // Fetch all records for this product
        const records = await queryAll('SELECT * FROM product_sop_records WHERE product_id = ?', [product.id]);
        const recordMap = {};
        for (const r of records) {
            recordMap[r.sop_item_id] = r;
        }

        // Calculate module progress (including 基础信息)
        const moduleProgress = {};
        for (const m of allModules) {
            moduleProgress[m.id] = await getModuleProgress(product.id, m.id);
        }

        res.render('product', {
            product, modules, recordMap, moduleProgress, title: product.name || product.asin
        });
    } catch (e) {
        console.error('Product detail error:', e);
        res.status(500).send('Server error: ' + e.message);
    }
});

app.get('/sop', async (req, res) => {
    try {
        const dbModules = await getModulesWithItems();
        const refMap = buildTableRefMap();

        // Enrich database items with table_ref
        const modules = dbModules
            .filter(m => m.sort_order > 1)
            .map(mod => {
            const itemRefs = refMap[mod.name] || {};
            return {
                ...mod,
                sop_items: mod.sop_items.map(item => ({
                    ...item,
                    table_ref: itemRefs[item.name] || null
                }))
            };
        });

        res.render('sop_template', { modules, title: 'SOP模板' });
    } catch (e) {
        console.error('SOP error:', e);
        res.status(500).send('Server error');
    }
});

app.get('/import', async (req, res) => {
    res.render('import_page', { result: null, import_path: EXCEL_PATH, title: '导入数据' });
});

app.post('/import', async (req, res) => {
    const result = await importExcel();
    res.render('import_page', { result, import_path: EXCEL_PATH, title: '导入数据' });
});

app.get('/competitors', async (req, res) => {
    try {
        const keyword = String(req.query.keyword || '').trim();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = 15;
        const offset = (page - 1) * pageSize;

        const whereSql = keyword ? 'WHERE brand_name LIKE ?' : '';
        const countParams = keyword ? [`%${keyword}%`] : [];
        const totalRow = await queryOne(`SELECT COUNT(*) AS cnt FROM competitors ${whereSql}`, countParams);
        const total = totalRow ? totalRow.cnt : 0;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        const params = keyword ? [`%${keyword}%`, pageSize, offset] : [pageSize, offset];
        const competitors = await queryAll(
            `SELECT * FROM competitors ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
            params
        );
        const recentActions = {};
        if (competitors.length > 0) {
            const ids = competitors.map(c => c.id);
            const placeholders = ids.map(() => '?').join(',');
            const actions = await queryAll(
                `SELECT id, competitor_id, action_text, created_at FROM competitor_actions WHERE competitor_id IN (${placeholders}) ORDER BY competitor_id ASC, created_at DESC, id DESC`,
                ids
            );
            for (const a of actions) {
                const cid = a.competitor_id;
                if (!recentActions[cid]) recentActions[cid] = [];
                if (recentActions[cid].length < 2) recentActions[cid].push(a);
            }
        }
        const actionTotals = {};
        if (competitors.length > 0) {
            const ids = competitors.map(c => c.id);
            const placeholders = ids.map(() => '?').join(',');
            const rows = await queryAll(
                `SELECT competitor_id, COUNT(*) AS cnt FROM competitor_actions WHERE competitor_id IN (${placeholders}) GROUP BY competitor_id`,
                ids
            );
            for (const r of rows) actionTotals[r.competitor_id] = r.cnt;
        }
        res.render('competitors', {
            competitors, recentActions, actionTotals, keyword,
            page, pageSize, total, totalPages,
            title: '竞品库'
        });
    } catch (e) {
        console.error('Competitors page error:', e);
        res.status(500).send('Server error: ' + e.message);
    }
});

// ========== API Endpoints ==========

app.patch('/api/record/:recordId', async (req, res) => {
    try {
        const { recordId } = req.params;
        const { status, remark } = req.body;

        const fields = [];
        const params = [];
        if (status !== undefined) {
            fields.push('status = ?');
            params.push(status);
        }
        if (remark !== undefined) {
            fields.push('remark = ?');
            params.push(remark);
        }
        if (fields.length > 0) {
            fields.push('updated_at = NOW()');
            params.push(recordId);
            await runSql(`UPDATE product_sop_records SET ${fields.join(', ')} WHERE id = ?`, params);
        }

        // Get product_id for progress recalculation
        const rec = await queryOne('SELECT product_id FROM product_sop_records WHERE id = ?', [recordId]);
        if (rec) {
            const progress = await calculateProgress(rec.product_id);
            await runSql('UPDATE products SET overall_progress = ?, updated_at = NOW() WHERE id = ?', [progress, rec.product_id]);
            // Also update all records' updated_at to NOW() for this product so "更新时间" reflects accurately
            await runSql('UPDATE product_sop_records SET updated_at = NOW() WHERE product_id = ?', [rec.product_id]);
        }

        res.json({ status: 'ok' });
    } catch (e) {
        console.error('API record update error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ========== Competitors CRUD ==========

function normalizeUrl(url) {
    if (!url) return null;
    const trimmed = String(url).trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
}

function decodeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim();
}

const COMPETITOR_IMPORT_PATH = path.join(__dirname, 'public', '竞对信息.xlsx');

app.post('/api/competitors/import', async (req, res) => {
    try {
        if (!fs.existsSync(COMPETITOR_IMPORT_PATH)) {
            return res.status(404).json({ error: '未找到 public/竞对信息.xlsx' });
        }

        const wb = XLSX.readFile(COMPETITOR_IMPORT_PATH);
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        let inserted = 0;
        let updated = 0;
        let actions_added = 0;
        let skipped = 0;
        const errors = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const brand_name = String(row[0] || '').trim();
            const brand_category = String(row[1] || '').trim();
            const amazon_store_url = decodeHtml(row[2] || '');
            const recent_action = String(row[3] || '').trim();

            if (!brand_name) { skipped++; continue; }
            if (brand_name.length > 200) { errors.push({ row: i + 1, error: '品牌名过长' }); continue; }
            if (brand_category && brand_category.length > 200) { errors.push({ row: i + 1, error: '品牌分类过长' }); continue; }

            const url = normalizeUrl(amazon_store_url);
            if (url && url.length > 1000) { errors.push({ row: i + 1, error: '链接过长' }); continue; }

            const existing = await queryOne('SELECT id FROM competitors WHERE brand_name = ? ORDER BY id DESC LIMIT 1', [brand_name]);
            let competitorId;

            if (existing) {
                competitorId = existing.id;
                const sets = [];
                const params = [];
                if (brand_category) { sets.push('brand_category = ?'); params.push(brand_category); }
                if (url) { sets.push('amazon_store_url = ?'); params.push(url); }
                if (sets.length > 0) {
                    sets.push('updated_at = NOW()');
                    params.push(competitorId);
                    await runSql(`UPDATE competitors SET ${sets.join(', ')} WHERE id = ?`, params);
                }
                updated++;
            } else {
                const r = await runSql(
                    'INSERT INTO competitors (brand_name, brand_category, amazon_store_url) VALUES (?, ?, ?)',
                    [brand_name, brand_category || null, url]
                );
                competitorId = r && r.insertId ? r.insertId : null;
                inserted++;
            }

            if (competitorId && recent_action) {
                if (recent_action.length > 2000) {
                    errors.push({ row: i + 1, error: '近期活动/动作过长' });
                } else {
                    await runSql(
                        'INSERT INTO competitor_actions (competitor_id, action_text) VALUES (?, ?)',
                        [competitorId, recent_action]
                    );
                    await runSql('UPDATE competitors SET updated_at = NOW() WHERE id = ?', [competitorId]);
                    actions_added++;
                }
            }
        }

        res.json({ status: 'ok', sheet: sheetName, inserted, updated, actions_added, skipped, errors });
    } catch (e) {
        console.error('Competitors import error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/competitor', async (req, res) => {
    try {
        const { brand_name, brand_category, amazon_store_url } = req.body;
        const bn = (brand_name || '').trim();
        if (!bn) return res.status(400).json({ error: '品牌名为必填项' });
        if (bn.length > 200) return res.status(400).json({ error: '品牌名过长（最多 200 字符）' });

        const bc = (brand_category || '').trim() || null;
        if (bc && bc.length > 200) return res.status(400).json({ error: '品牌分类过长（最多 200 字符）' });

        const url = normalizeUrl(amazon_store_url);
        if (url && url.length > 1000) return res.status(400).json({ error: '链接过长（最多 1000 字符）' });

        await runSql(
            'INSERT INTO competitors (brand_name, brand_category, amazon_store_url) VALUES (?, ?, ?)',
            [bn, bc, url]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Competitor create error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/competitor/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await queryOne('SELECT id FROM competitors WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: '竞品不存在' });

        const { brand_name, brand_category, amazon_store_url } = req.body;
        const sets = [];
        const params = [];

        if (brand_name !== undefined) {
            const bn = (brand_name || '').trim();
            if (!bn) return res.status(400).json({ error: '品牌名为必填项' });
            if (bn.length > 200) return res.status(400).json({ error: '品牌名过长（最多 200 字符）' });
            sets.push('brand_name = ?');
            params.push(bn);
        }

        if (brand_category !== undefined) {
            const bc = (brand_category || '').trim() || null;
            if (bc && bc.length > 200) return res.status(400).json({ error: '品牌分类过长（最多 200 字符）' });
            sets.push('brand_category = ?');
            params.push(bc);
        }

        if (amazon_store_url !== undefined) {
            const url = normalizeUrl(amazon_store_url);
            if (url && url.length > 1000) return res.status(400).json({ error: '链接过长（最多 1000 字符）' });
            sets.push('amazon_store_url = ?');
            params.push(url);
        }

        if (sets.length === 0) return res.json({ status: 'ok' });

        sets.push('updated_at = NOW()');
        params.push(id);
        await runSql(`UPDATE competitors SET ${sets.join(', ')} WHERE id = ?`, params);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Competitor update error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/competitor/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await runSql('DELETE FROM competitors WHERE id = ?', [id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Competitor delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/competitor/:id/action', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await queryOne('SELECT id FROM competitors WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: '竞品不存在' });

        const { action_text } = req.body;
        const at = (action_text || '').trim();
        if (!at) return res.status(400).json({ error: '动作内容为必填项' });
        if (at.length > 2000) return res.status(400).json({ error: '动作内容过长（最多 2000 字符）' });

        await runSql(
            'INSERT INTO competitor_actions (competitor_id, action_text) VALUES (?, ?)',
            [id, at]
        );
        await runSql('UPDATE competitors SET updated_at = NOW() WHERE id = ?', [id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Competitor action create error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/competitor/:id/actions', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await queryOne('SELECT id, brand_name FROM competitors WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: '竞品不存在' });
        const actions = await queryAll(
            'SELECT id, action_text, created_at FROM competitor_actions WHERE competitor_id = ? ORDER BY created_at DESC, id DESC',
            [id]
        );
        res.json({ brand_name: existing.brand_name, actions });
    } catch (e) {
        console.error('Competitor actions list error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/competitor/action/:actionId', async (req, res) => {
    try {
        const { actionId } = req.params;
        const action = await queryOne('SELECT competitor_id FROM competitor_actions WHERE id = ?', [actionId]);
        if (!action) return res.status(404).json({ error: '动作不存在' });
        await runSql('DELETE FROM competitor_actions WHERE id = ?', [actionId]);
        await runSql('UPDATE competitors SET updated_at = NOW() WHERE id = ?', [action.competitor_id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Competitor action delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/product/:asin', async (req, res) => {
    try {
        const { asin } = req.params;
        const { status } = req.body;
        await runSql('UPDATE products SET status = ?, updated_at = NOW() WHERE asin = ?', [status, asin]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('API product update error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/product', async (req, res) => {
    try {
        const { asin, name, category } = req.body;
        if (!asin) return res.status(400).json({ error: 'ASIN 必填' });

        const existing = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        if (existing) {
            return res.status(409).json({ error: '该 ASIN 已存在' });
        }

        await runSql(
            'INSERT INTO products (asin, name, category) VALUES (?, ?, ?)',
            [asin, name || null, category || null]
        );
        const product = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        await ensureRecordsForProduct(product.id);
        await recalculateProductProgress(product.id);

        res.json({ status: 'ok', asin });
    } catch (e) {
        console.error('API product create error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/product/:asin', async (req, res) => {
    try {
        const { asin } = req.params;
        const { name, category } = req.body;
        await runSql(
            'UPDATE products SET name = COALESCE(?, name), category = COALESCE(?, category), updated_at = NOW() WHERE asin = ?',
            [name || null, category || null, asin]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('API product update error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/product/:asin/delete', async (req, res) => {
    try {
        const { asin } = req.params;
        const product = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        if (product) {
            await runSql('DELETE FROM product_sop_records WHERE product_id = ?', [product.id]);
            await runSql('DELETE FROM products WHERE id = ?', [product.id]);
        }
        res.json({ status: 'ok', redirect: '/dashboard' });
    } catch (e) {
        console.error('API delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/progress/:productId/:moduleId', async (req, res) => {
    try {
        const { productId, moduleId } = req.params;
        const mp = await getModuleProgress(parseInt(productId), parseInt(moduleId));
        res.json({
            ...mp,
            percentage: mp.percentage,
            text: `${mp.completed}/${mp.total}`
        });
    } catch (e) {
        console.error('API progress error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ========== SOP Template CRUD ==========

app.post('/api/sop/item', async (req, res) => {
    try {
        const { module_id, name, instruction_text, is_data_column } = req.body;
        if (!module_id || !name) return res.status(400).json({ error: '模块和名称为必填' });

        const maxOrder = await queryOne('SELECT MAX(sort_order) as mx FROM sop_items WHERE module_id = ?', [module_id]);
        const nextOrder = (maxOrder?.mx || 0) + 1;

        await runSql(
            'INSERT INTO sop_items (module_id, name, instruction_text, image_url, sort_order, is_data_column) VALUES (?, ?, ?, NULL, ?, ?)',
            [module_id, name, instruction_text || null, nextOrder, is_data_column ? 1 : 0]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('SOP item create error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/sop/item/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, instruction_text } = req.body;
        const sets = [];
        const params = [];
        if (name !== undefined) { sets.push('name = ?'); params.push(name); }
        if (instruction_text !== undefined) { sets.push('instruction_text = ?'); params.push(instruction_text); }
        if (sets.length > 0) { params.push(id); await runSql(`UPDATE sop_items SET ${sets.join(', ')} WHERE id = ?`, params); }
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('SOP item update error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Find a record by product ASIN + item ID
app.get('/api/record/find/:asin/:itemId', async (req, res) => {
    try {
        const { asin, itemId } = req.params;
        const product = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        if (!product) return res.status(404).json({ error: '产品不存在' });
        const rec = await queryOne('SELECT * FROM product_sop_records WHERE product_id = ? AND sop_item_id = ?', [product.id, itemId]);
        res.json(rec || null);
    } catch (e) {
        console.error('API find record error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sop/item/:id/image', upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ error: '未选择图片' });
        const imageUrl = '/uploads/' + req.file.filename;
        await runSql('UPDATE sop_items SET image_url = ? WHERE id = ?', [imageUrl, id]);
        res.json({ status: 'ok', image_url: imageUrl });
    } catch (e) {
        console.error('SOP image upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sop/item/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const item = await queryOne('SELECT id, image_url FROM sop_items WHERE id = ?', [id]);
        if (!item) return res.status(404).json({ error: 'SOP项不存在' });
        await runSql('DELETE FROM sop_items WHERE id = ?', [id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('SOP item delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Upload image for a product SOP record (action item) - supports multiple images stored as JSON array
app.post('/api/record/:recordId/image', upload.single('image'), async (req, res) => {
    try {
        const { recordId } = req.params;
        if (!req.file) return res.status(400).json({ error: '未选择图片' });
        const imageUrl = '/uploads/' + req.file.filename;
        const rec = await queryOne('SELECT image_url FROM product_sop_records WHERE id = ?', [recordId]);
        let images = [];
        if (rec && rec.image_url) {
            try { images = JSON.parse(rec.image_url); } catch (e) { images = [rec.image_url]; }
        }
        images.push(imageUrl);
        await runSql('UPDATE product_sop_records SET image_url = ? WHERE id = ?', [JSON.stringify(images), recordId]);
        res.json({ status: 'ok', image_url: imageUrl });
    } catch (e) {
        console.error('Record image upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Delete a specific image from a product SOP record
app.post('/api/record/:recordId/image/delete', async (req, res) => {
    try {
        const { recordId } = req.params;
        const { image_url } = req.body;
        const rec = await queryOne('SELECT image_url FROM product_sop_records WHERE id = ?', [recordId]);
        if (rec && rec.image_url) {
            let images = [];
            try { images = JSON.parse(rec.image_url); } catch (e) { images = [rec.image_url]; }
            images = images.filter(u => u !== image_url);
            await runSql('UPDATE product_sop_records SET image_url = ? WHERE id = ?', [images.length > 0 ? JSON.stringify(images) : null, recordId]);
        }
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Record image delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ========== Product Version (Snapshot) APIs ==========

// Create a new version snapshot of the current product state
app.post('/api/product/:asin/version', async (req, res) => {
    try {
        const { asin } = req.params;
        const { version_name } = req.body;
        const product = await queryOne('SELECT * FROM products WHERE asin = ?', [asin]);
        if (!product) return res.status(404).json({ error: '产品不存在' });

        const allModules = await getModulesWithItems();
        const records = await queryAll('SELECT * FROM product_sop_records WHERE product_id = ?', [product.id]);
        const recordMap = {};
        for (const r of records) recordMap[r.sop_item_id] = r;

        // Enrich items with table_ref so the version view can identify fields by data source
        const refMap = buildTableRefMap();
        const modulesData = allModules.map(m => {
            const itemRefs = refMap[m.name] || {};
            return {
                id: m.id,
                name: m.name,
                sort_order: m.sort_order,
                sop_items: m.sop_items.map(it => ({
                    id: it.id,
                    name: it.name,
                    instruction_text: it.instruction_text,
                    sort_order: it.sort_order,
                    is_data_column: it.is_data_column,
                    image_url: it.image_url,
                    table_ref: itemRefs[it.name] || null,
                    record: recordMap[it.id] ? {
                        status: recordMap[it.id].status,
                        remark: recordMap[it.id].remark || '',
                        image_url: recordMap[it.id].image_url || null
                    } : { status: '待处理', remark: '', image_url: null }
                }))
            };
        });

        const snapshot = {
            product: {
                name: product.name,
                category: product.category,
                status: product.status,
                overall_progress: product.overall_progress
            },
            modules: modulesData
        };

        // Determine next version number
        const maxRow = await queryOne(
            'SELECT MAX(version_number) as mx FROM product_versions WHERE product_id = ?',
            [product.id]
        );
        const nextVersion = (maxRow && maxRow.mx ? maxRow.mx : 0) + 1;

        await runSql(
            'INSERT INTO product_versions (product_id, version_number, version_name, snapshot_data) VALUES (?, ?, ?, ?)',
            [product.id, nextVersion, version_name || null, JSON.stringify(snapshot)]
        );
        const newVer = await queryOne(
            'SELECT id, version_number, version_name, created_at FROM product_versions WHERE product_id = ? ORDER BY version_number DESC LIMIT 1',
            [product.id]
        );
        res.json({ status: 'ok', version: newVer });
    } catch (e) {
        console.error('Version create error:', e);
        res.status(500).json({ error: e.message });
    }
});

// List all versions of a product
app.get('/api/product/:asin/versions', async (req, res) => {
    try {
        const { asin } = req.params;
        const product = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        if (!product) return res.status(404).json({ error: '产品不存在' });
        const versions = await queryAll(
            'SELECT id, version_number, version_name, created_at, updated_at FROM product_versions WHERE product_id = ? ORDER BY version_number DESC',
            [product.id]
        );
        res.json({ versions });
    } catch (e) {
        console.error('Version list error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Delete a version
app.delete('/api/version/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await runSql('DELETE FROM product_versions WHERE id = ?', [id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Version delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Rename a version
app.patch('/api/version/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { version_name } = req.body;
        await runSql('UPDATE product_versions SET version_name = ?, updated_at = NOW() WHERE id = ?', [version_name || null, id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Version rename error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Render a single version as a page
app.get('/product/:asin/version/:versionId', async (req, res) => {
    try {
        const { asin, versionId } = req.params;
        const product = await queryOne('SELECT * FROM products WHERE asin = ?', [asin]);
        if (!product) return res.status(404).send('Product not found');

        const version = await queryOne(
            'SELECT * FROM product_versions WHERE id = ? AND product_id = ?',
            [versionId, product.id]
        );
        if (!version) return res.status(404).send('版本不存在');

        let snapshot;
        try { snapshot = JSON.parse(version.snapshot_data); } catch (e) { snapshot = { modules: [] }; }

        // Filter out 基础信息 (sort_order=1) from rendering, like the regular product page
        const modules = (snapshot.modules || []).filter(m => m.sort_order > 1);

        // Re-build recordMap from snapshot for template compatibility
        const recordMap = {};
        for (const m of snapshot.modules || []) {
            for (const it of m.sop_items || []) {
                recordMap[it.id] = {
                    id: 'v_' + version.id + '_' + it.id, // synthetic id, prefixed so it can't clash
                    status: it.record?.status || '待处理',
                    remark: it.record?.remark || '',
                    image_url: it.record?.image_url || null
                };
            }
        }

        // Calculate module progress based on snapshot
        const moduleProgress = {};
        for (const m of snapshot.modules || []) {
            let total = 0, completed = 0;
            for (const it of m.sop_items || []) {
                if (!it.is_data_column) {
                    total++;
                    if ((it.record?.status) === '已完成') completed++;
                }
            }
            moduleProgress[m.id] = {
                completed, total,
                percentage: total > 0 ? Math.round(completed / total * 10000) / 10000 : 0
            };
        }

        // Build a virtual product object reflecting snapshot
        const virtualProduct = {
            ...product,
            name: snapshot.product?.name ?? product.name,
            category: snapshot.product?.category ?? product.category,
            status: snapshot.product?.status ?? product.status,
            overall_progress: snapshot.product?.overall_progress ?? product.overall_progress
        };

        res.render('product_version', {
            product: virtualProduct,
            originalProduct: product,
            modules, recordMap, moduleProgress,
            version: {
                id: version.id,
                version_number: version.version_number,
                version_name: version.version_name,
                created_at: version.created_at,
                updated_at: version.updated_at
            },
            title: `${product.name || product.asin} - 版本 V${version.version_number}`
        });
    } catch (e) {
        console.error('Version view error:', e);
        res.status(500).send('Server error: ' + e.message);
    }
});

// Update a record inside a version snapshot
app.patch('/api/version/:versionId/item/:itemId', async (req, res) => {
    try {
        const { versionId, itemId } = req.params;
        const { status, remark, image_url } = req.body;

        const ver = await queryOne('SELECT * FROM product_versions WHERE id = ?', [versionId]);
        if (!ver) return res.status(404).json({ error: '版本不存在' });

        let snapshot;
        try { snapshot = JSON.parse(ver.snapshot_data); } catch (e) { snapshot = { modules: [] }; }

        let found = false;
        for (const m of snapshot.modules || []) {
            for (const it of m.sop_items || []) {
                if (String(it.id) === String(itemId)) {
                    it.record = it.record || { status: '待处理', remark: '', image_url: null };
                    if (status !== undefined) it.record.status = status;
                    if (remark !== undefined) it.record.remark = remark;
                    if (image_url !== undefined) it.record.image_url = image_url;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        if (!found) return res.status(404).json({ error: 'SOP项不存在' });

        await runSql(
            'UPDATE product_versions SET snapshot_data = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(snapshot), versionId]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Version record update error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('  Amazon 运营SOP管理系统');
    console.log(`  http://localhost:${PORT}`);
    console.log('='.repeat(50) + '\n');
});
