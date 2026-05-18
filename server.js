const express = require('express');
const path = require('path');
const multer = require('multer');
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

app.get('/dashboard', async (req, res) => {
    try {
        const { search = '', category = '', status = '' } = req.query;
        const modules = await queryAll('SELECT * FROM sop_modules ORDER BY sort_order');

        let sql = 'SELECT * FROM products WHERE 1=1';
        const params = [];
        if (search) {
            sql += " AND (asin LIKE ? OR name LIKE ?)";
            params.push(`%${search}%`, `%${search}%`);
        }
        if (category) {
            sql += " AND category = ?";
            params.push(category);
        }
        if (status) {
            sql += " AND status = ?";
            params.push(status);
        }
        sql += " ORDER BY updated_at DESC";

        let products = await queryAll(sql, params);

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

        // Build table_ref lookup: module name → item name → table_ref
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('  Amazon 运营SOP管理系统');
    console.log(`  http://localhost:${PORT}`);
    console.log('='.repeat(50) + '\n');
});
