const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const {
    initDb,
    queryAll,
    queryOne,
    runSql,
    getModulesWithItems,
    getProductModuleProgressMap,
    getModuleProgress,
    calculateProgress,
    ensureRecordsForProduct,
    recalculateProductProgress
} = require('./database');
const { importExcel, EXCEL_PATH } = require('./importer');
const { importTacosExcel, TACOS_PATH } = require('./tacos-importer');
const sopData = require('./sop-data');
const { upload: uploadToRemote } = require('./service/upload');
const { compareStorefrontImages } = require('./gpt');
const {
    hashPassword,
    verifyPassword,
    createSession,
    destroySession,
    setSessionCookie,
    clearSessionCookie,
    requireLogin,
    attachCurrentUser,
    requirePasswordChanged,
    updateSessionUser,
    ensureDefaultAdmin
} = require('./auth');

const { PRODUCT_SITES, isValidProductSite } = require('./product-sites');
const { ensureEconomicsForProduct } = require('./product-economics');
const { registerPublicPageApi, registerProtectedPageApi } = require('./routes/page-api');

const app = express();
const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'dist');
const INDEX_HTML = fs.existsSync(path.join(DIST_DIR, 'index.html'))
    ? path.join(DIST_DIR, 'index.html')
    : path.join(PUBLIC_DIR, 'index.html');

// Middleware（年度活动保存含 12 个月 Markdown，默认 100kb 易超限导致连接被重置）
const BODY_LIMIT = '5mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(express.static(PUBLIC_DIR));
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
}

app.use(attachCurrentUser);

registerPublicPageApi(app, {
    queryOne,
    verifyPassword,
    createSession,
    setSessionCookie
});

app.post('/logout', (req, res) => {
    destroySession(req);
    clearSessionCookie(res);
    res.redirect('/login');
});

app.use(requireLogin);
app.use(requirePasswordChanged);

function getPageApiCtx() {
    return {
        queryAll,
        queryOne,
        runSql,
        getModulesWithItems,
        getProductModuleProgressMap,
        buildTableRefMap,
        importExcel,
        EXCEL_PATH,
        importTacosExcel,
        TACOS_PATH,
        hashPassword,
        verifyPassword,
        destroySession,
        clearSessionCookie,
        updateSessionUser,
        ensureWeeklyReviewsForActiveSprints,
        toDateString,
        getMondayStart,
        parseYmd,
        addDays,
        normalizeMonitorImageUrl,
        resetDesignUserCache: () => { cachedDefaultDesignUserId = null; }
    };
}

registerProtectedPageApi(app, getPageApiCtx());

/** multer/busboy 将 multipart 文件名按 latin1 解析，中文需转回 UTF-8 */
function decodeUploadFilename(name) {
    if (!name || typeof name !== 'string') return name || '';
    try {
        return Buffer.from(name, 'latin1').toString('utf8');
    } catch (e) {
        return name;
    }
}

// Multer config for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
    filename: (req, file, cb) => {
        const ext = path.extname(decodeUploadFilename(file.originalname));
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

const fileUpload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok =
            /^image\//.test(file.mimetype) ||
            /^video\//.test(file.mimetype) ||
            [
                'application/pdf',
                'application/zip',
                'application/x-zip-compressed',
                'text/plain',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ].includes(file.mimetype);
        if (ok) cb(null, true);
        else cb(new Error('不支持的文件类型'));
    }
});

const knowledgeFileUpload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }
});

let dbReady = false;
initDb()
    .then(() => ensureDefaultAdmin({ queryOne, runSql }))
    .then(() => {
        dbReady = true;
        console.log('Database initialized');
    })
    .catch(err => {
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

function toDateString(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function addDays(d, days) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + days);
    return x;
}

function getMondayStart(d) {
    const x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
}

async function getSetting(key, defaultValue) {
    const row = await queryOne('SELECT value FROM app_settings WHERE `key` = ?', [key]);
    if (!row || row.value === null || row.value === undefined || String(row.value).trim() === '') return defaultValue;
    return row.value;
}

async function setSetting(key, value) {
    await runSql(
        'INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, String(value)]
    );
}

let cachedDefaultDesignUserId = null;
async function getDefaultDesignUserId() {
    if (cachedDefaultDesignUserId !== null) return cachedDefaultDesignUserId;
    const row = await queryOne("SELECT id FROM users WHERE role = 'DESIGN' ORDER BY id ASC LIMIT 1");
    cachedDefaultDesignUserId = row ? row.id : null;
    return cachedDefaultDesignUserId;
}

async function ensureWeeklyReviewsForActiveSprints(weekStartStr) {
    await runSql(
        `INSERT IGNORE INTO weekly_reviews (sprint_id, week_start_date, status)
         SELECT id, ?, 'PENDING' FROM sprint_projects WHERE status = 'ACTIVE'`,
        [weekStartStr]
    );
}

async function ticketExists(asin, ticketType, dateStr) {
    const row = await queryOne(
        'SELECT id FROM issue_tickets WHERE asin = ? AND ticket_type = ? AND DATE(created_at) = ? LIMIT 1',
        [asin, ticketType, dateStr]
    );
    return !!row;
}

async function createTicket(payload) {
    const {
        sprint_id,
        asin,
        ticket_type,
        severity = 'B',
        owner_id = null,
        co_owner_id = null,
        status = 'TODO',
        sla_deadline = null,
        trigger_reason = null
    } = payload;
    await runSql(
        `INSERT INTO issue_tickets
         (sprint_id, asin, ticket_type, severity, owner_id, co_owner_id, status, sla_deadline, trigger_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sprint_id, asin, ticket_type, severity, owner_id, co_owner_id, status, sla_deadline, trigger_reason]
    );
}

async function ensureInsight(asin, recordDateStr, insightType, message) {
    const row = await queryOne(
        'SELECT id FROM metric_insights WHERE asin = ? AND record_date = ? AND insight_type = ? LIMIT 1',
        [asin, recordDateStr, insightType]
    );
    if (row) return;
    await runSql(
        'INSERT INTO metric_insights (asin, record_date, insight_type, message) VALUES (?, ?, ?, ?)',
        [asin, recordDateStr, insightType, message]
    );
}

async function runPostIngestionRules(asins, recordDateStr) {
    for (const asin of asins) {
        try {
            const sprint = await queryOne('SELECT * FROM sprint_projects WHERE asin = ?', [asin]);
            if (!sprint) continue;

            const end = parseYmd(recordDateStr);
            if (!end) continue;
            const startStr = toDateString(addDays(end, -6));
            const rows = await queryAll(
                `SELECT record_date, orders, ad_spend, total_sales, tacos
                 FROM daily_asin_metrics
                 WHERE asin = ? AND record_date BETWEEN ? AND ?
                 ORDER BY record_date ASC`,
                [asin, startStr, recordDateStr]
            );
            const adSpend7d = rows.reduce((sum, r) => sum + Number(r.ad_spend || 0), 0);
            const totalSales7d = rows.reduce((sum, r) => sum + Number(r.total_sales || 0), 0);
            const profitMargin = sprint.profit_margin === null ? null : Number(sprint.profit_margin);
            const maxLoss7d = sprint.max_loss_7d === null ? null : Number(sprint.max_loss_7d);
            if (profitMargin !== null && maxLoss7d !== null) {
                const estProfit = totalSales7d * profitMargin / 100;
                const loss = adSpend7d - estProfit;
                if (loss > maxLoss7d) {
                    const exists = await queryOne(
                        `SELECT id FROM issue_tickets
                         WHERE asin = ? AND ticket_type = 'EXIT_EVAL'
                           AND status IN ('TODO','PENDING_DESIGN','WAITING_VERIFY')
                           AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                         LIMIT 1`,
                        [asin]
                    );
                    if (!exists) {
                        const reason = `近7天广告花费=${adSpend7d.toFixed(2)}, 预估利润=${estProfit.toFixed(2)}, 差额=${loss.toFixed(2)}, 7天止损线=${maxLoss7d.toFixed(2)}`;
                        const deadline = new Date();
                        deadline.setDate(deadline.getDate() + 1);
                        await createTicket({
                            sprint_id: sprint.id,
                            asin,
                            ticket_type: 'EXIT_EVAL',
                            severity: 'S',
                            owner_id: sprint.owner_id || null,
                            co_owner_id: null,
                            status: 'TODO',
                            sla_deadline: deadline.toISOString().slice(0, 19).replace('T', ' '),
                            trigger_reason: reason
                        });
                    }
                }
            }

            const promoLimit = sprint.promo_tacos_limit === null ? null : Number(sprint.promo_tacos_limit);
            if (promoLimit !== null) {
                const today = rows.find(r => String(r.record_date) === recordDateStr) || null;
                const todayTacos = today && today.tacos !== null && today.tacos !== undefined ? Number(today.tacos) : null;
                if (todayTacos !== null && todayTacos < promoLimit && rows.length >= 6) {
                    const orders = rows.map(r => Number(r.orders || 0));
                    const first3 = (orders[0] + orders[1] + orders[2]) / 3;
                    const last3 = (orders[orders.length - 3] + orders[orders.length - 2] + orders[orders.length - 1]) / 3;
                    if (last3 > first3) {
                        await ensureInsight(
                            asin,
                            recordDateStr,
                            'GOOD_PERF',
                            `TACOS(${todayTacos.toFixed(2)}%) 低于红线(${promoLimit.toFixed(2)}%) 且单量上升，可向中大词扩展`
                        );
                    }
                }
            }
        } catch (e) {
            console.error('Post ingestion rule error:', asin, e);
        }
    }
}

app.post('/api/annual-activities/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file || !req.file.path) {
            return res.status(400).json({ error: '未找到图片文件' });
        }
        const localPath = req.file.path;
        const result = await uploadToRemote(localPath, { uploadPrefix: 'annual-activities' });
        try {
            fs.unlinkSync(localPath);
        } catch (e) {}
        res.json({ url: result.public_url, key: result.key });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== 知识库 ==========

app.post('/api/knowledge/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file || !req.file.filename) {
            return res.status(400).json({ error: '未找到图片文件' });
        }
        res.json({ url: '/uploads/' + req.file.filename });
    } catch (e) {
        console.error('Knowledge image upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/knowledge/file', knowledgeFileUpload.single('file'), async (req, res) => {
    try {
        if (!req.file || !req.file.filename) {
            return res.status(400).json({ error: '未找到文件' });
        }
        const storedName = req.file.filename;
        const originalName = decodeUploadFilename(req.file.originalname) || storedName;
        const downloadUrl = '/api/knowledge/download/' + encodeURIComponent(storedName)
            + '?name=' + encodeURIComponent(originalName);
        res.json({
            filename: originalName,
            storedName,
            downloadUrl
        });
    } catch (e) {
        console.error('Knowledge file upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/knowledge/download/:filename', (req, res) => {
    try {
        const storedName = path.basename(req.params.filename);
        const filePath = path.join(__dirname, 'public', 'uploads', storedName);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return res.status(404).send('文件不存在');
        }
        const displayName = path.basename(String(req.query.name || storedName));
        res.download(filePath, displayName);
    } catch (e) {
        console.error('Knowledge file download error:', e);
        res.status(500).send('下载失败');
    }
});

app.get('/api/knowledge/draft', async (req, res) => {
    try {
        const draft = await queryOne(
            'SELECT doc_id, title, content, updated_at FROM knowledge_drafts WHERE user_id = ?',
            [req.currentUser.id]
        );
        res.json({ draft: draft || null });
    } catch (e) {
        console.error('Knowledge draft get error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/knowledge/draft', async (req, res) => {
    try {
        const title = String(req.body.title || '');
        const content = String(req.body.content || '');
        const docIdRaw = parseInt(req.body.doc_id);
        const doc_id = Number.isFinite(docIdRaw) ? docIdRaw : null;

        if (title.length > 500) return res.status(400).json({ error: '标题过长（最多 500 字符）' });
        if (content.length > 500000) return res.status(400).json({ error: '正文过长（最多 500000 字符）' });

        await runSql(
            `INSERT INTO knowledge_drafts (user_id, doc_id, title, content)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE doc_id = VALUES(doc_id), title = VALUES(title), content = VALUES(content), updated_at = NOW()`,
            [req.currentUser.id, doc_id, title, content]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Knowledge draft save error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/knowledge/draft', async (req, res) => {
    try {
        await runSql('DELETE FROM knowledge_drafts WHERE user_id = ?', [req.currentUser.id]);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Knowledge draft delete error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ========== 每日吐槽 ==========

app.post('/api/daily-rants/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file || !req.file.path) {
            return res.status(400).json({ error: '未找到图片文件' });
        }
        const localPath = req.file.path;
        const result = await uploadToRemote(localPath, { uploadPrefix: 'daily-rants' });
        try {
            fs.unlinkSync(localPath);
        } catch (e) {}
        res.json({ url: result.public_url, key: result.key });
    } catch (e) {
        console.error('Daily rant image upload error:', e);
        res.status(500).json({ error: e.message });
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

function normalizeMonitorImageUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return null;
    // sellersprite.com 域名的不需要修改
    if (normalized.includes('sellersprite.com')) {
        // url 中 http 和 https 均需要修改为 https
        return normalized.replace(/^https?:\/\//i, 'https://');
    }
    return normalized.replace(/^https:\/\//i, 'http://');
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

function parseBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return null;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return null;
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

app.post('/api/external/competitor-monitor', async (req, res) => {
    try {
        const competitorId = req.body.competitor_id;
        const brandName = String(req.body.brand_name || '').trim();
        if (!competitorId && !brandName) {
            return res.status(400).json({ error: 'competitor_id 或 brand_name 至少传一个' });
        }

        let competitor = null;
        if (competitorId) {
            competitor = await queryOne(
                'SELECT id, brand_name, status FROM competitors WHERE id = ?',
                [competitorId]
            );
        } else {
            competitor = await queryOne(
                'SELECT id, brand_name, status FROM competitors WHERE brand_name = ? ORDER BY id DESC LIMIT 1',
                [brandName]
            );
        }
        if (!competitor) {
            return res.status(404).json({ error: '竞品不存在' });
        }
        if (Number(competitor.status) !== 0) {
            return res.status(400).json({ error: '当前竞品不是跟踪状态，不能接收监控回传' });
        }

        const imageUrl = normalizeMonitorImageUrl(req.body.image_url);
        if (!imageUrl) return res.status(400).json({ error: 'image_url 为必填项' });
        if (imageUrl.length > 1000) return res.status(400).json({ error: 'image_url 过长（最多 1000 字符）' });

        const previousRecord = await queryOne(
            `SELECT image_url FROM competitor_monitor_records
             WHERE competitor_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1`,
            [competitor.id]
        );

        let hasChange = false;
        let actionText = null;
        if (previousRecord && previousRecord.image_url) {
            const previousImageUrl = normalizeMonitorImageUrl(previousRecord.image_url);
            const compareResult = await compareStorefrontImages(previousImageUrl, imageUrl);
            hasChange = compareResult.is_changed;
            actionText = compareResult.summary || null;
            if (actionText && actionText.length > 2000) {
                actionText = actionText.slice(0, 2000);
            }
        }

        const monitorResult = await runSql(
            'INSERT INTO competitor_monitor_records (competitor_id, image_url, has_change, action_text) VALUES (?, ?, ?, ?)',
            [competitor.id, imageUrl, hasChange ? 1 : 0, actionText || null]
        );

        let actionAdded = false;
        if (hasChange) {
            await runSql(
                'INSERT INTO competitor_actions (competitor_id, action_text) VALUES (?, ?)',
                [competitor.id, actionText || '检测到店铺变化']
            );
            actionAdded = true;
        }

        await runSql('UPDATE competitors SET updated_at = NOW() WHERE id = ?', [competitor.id]);

        res.json({
            status: 'ok',
            competitor_id: competitor.id,
            brand_name: competitor.brand_name,
            monitor_record_id: monitorResult && monitorResult.insertId ? monitorResult.insertId : null,
            has_change: hasChange,
            action_text: actionText,
            action_added: actionAdded
        });
    } catch (e) {
        console.error('External competitor monitor error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/competitor/:id/monitor-records', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await queryOne('SELECT id, brand_name FROM competitors WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: '竞品不存在' });
        const records = await queryAll(
            `SELECT id, image_url, has_change, action_text, created_at
             FROM competitor_monitor_records
             WHERE competitor_id = ?
             ORDER BY created_at DESC, id DESC`,
            [id]
        );
        for (const record of records) {
            record.image_url = normalizeMonitorImageUrl(record.image_url);
        }
        res.json({ brand_name: existing.brand_name, records });
    } catch (e) {
        console.error('Competitor monitor records list error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/product/:asin', async (req, res) => {
    try {
        const { asin } = req.params;
        const { status, site, category } = req.body;
        const sets = [];
        const params = [];
        if (status !== undefined) {
            sets.push('status = ?');
            params.push(status);
        }
        if (site !== undefined) {
            const siteVal = site ? String(site).trim() : null;
            if (siteVal && !isValidProductSite(siteVal)) {
                return res.status(400).json({ error: '无效的站点' });
            }
            sets.push('seq = ?');
            params.push(siteVal);
        }
        if (category !== undefined) {
            const categoryVal = category ? String(category).trim() : null;
            sets.push('category = ?');
            params.push(categoryVal);
        }
        if (!sets.length) return res.status(400).json({ error: '无更新字段' });
        sets.push('updated_at = NOW()');
        params.push(asin);
        await runSql(`UPDATE products SET ${sets.join(', ')} WHERE asin = ?`, params);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('API product update error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/product', async (req, res) => {
    try {
        const { asin, name, category, site } = req.body;
        if (!asin) return res.status(400).json({ error: 'ASIN 必填' });

        const siteVal = site ? String(site).trim() : null;
        if (siteVal && !isValidProductSite(siteVal)) {
            return res.status(400).json({ error: '无效的站点' });
        }

        const existing = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        if (existing) {
            return res.status(409).json({ error: '该 ASIN 已存在' });
        }

        await runSql(
            'INSERT INTO products (asin, name, category, seq) VALUES (?, ?, ?, ?)',
            [asin, name || null, category || null, siteVal]
        );
        const product = await queryOne('SELECT id FROM products WHERE asin = ?', [asin]);
        await ensureRecordsForProduct(product.id);
        await ensureEconomicsForProduct(product.id, runSql);
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
        const { name, category, site } = req.body;
        const sets = ['name = COALESCE(?, name)', 'category = COALESCE(?, category)'];
        const params = [name || null, category || null];
        if (site !== undefined) {
            const siteVal = site ? String(site).trim() : null;
            if (siteVal && !isValidProductSite(siteVal)) {
                return res.status(400).json({ error: '无效的站点' });
            }
            sets.push('seq = ?');
            params.push(siteVal);
        }
        sets.push('updated_at = NOW()');
        params.push(asin);
        await runSql(`UPDATE products SET ${sets.join(', ')} WHERE asin = ?`, params);
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
        const localPath = req.file.path;
        const result = await uploadToRemote(localPath, { uploadPrefix: 'sop-template' });
        try {
            fs.unlinkSync(localPath);
        } catch (e) {}
        const imageUrl = result.public_url;
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
        const localPath = req.file.path;
        const result = await uploadToRemote(localPath, { uploadPrefix: 'product-sop-record' });
        try {
            fs.unlinkSync(localPath);
        } catch (e) {}
        const imageUrl = result.public_url;
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














app.post('/api/v1/metrics/upload', async (req, res) => {
    try {
        const source = String(req.body.source || '').trim();
        const dateStr = String(req.body.date || '').trim();
        const data = Array.isArray(req.body.data) ? req.body.data : null;
        if (!['MANUAL', 'RPA_BOT'].includes(source)) return res.status(400).json({ error: 'source 不合法' });
        if (!parseYmd(dateStr)) return res.status(400).json({ error: 'date 不合法，需 YYYY-MM-DD' });
        if (!data || data.length === 0) return res.status(400).json({ error: 'data 不能为空' });

        const asins = [];
        for (const row of data) {
            const asin = String(row.asin || '').trim();
            if (!asin) continue;
            const sessions = row.sessions !== undefined ? Number(row.sessions) : null;
            const orders = row.orders !== undefined ? Number(row.orders) : null;
            const impressions = row.impressions !== undefined ? Number(row.impressions) : null;
            const clicks = row.clicks !== undefined ? Number(row.clicks) : null;
            const ad_spend = row.ad_spend !== undefined ? Number(row.ad_spend) : null;
            const ad_sales = row.ad_sales !== undefined ? Number(row.ad_sales) : null;
            const total_sales = row.total_sales !== undefined ? Number(row.total_sales) : null;
            const ad_orders = row.ad_orders !== undefined ? Number(row.ad_orders) : null;
            const core_kw_rank = row.core_kw_rank !== undefined ? Number(row.core_kw_rank) : null;
            const bsr_rank = row.bsr_rank !== undefined ? Number(row.bsr_rank) : null;

            const acos = ad_sales && Number(ad_sales) > 0 && ad_spend !== null ? Number(ad_spend) / Number(ad_sales) * 100 : null;
            const tacos = total_sales && Number(total_sales) > 0 && ad_spend !== null ? Number(ad_spend) / Number(total_sales) * 100 : null;
            const ctr = impressions && Number(impressions) > 0 && clicks !== null ? Number(clicks) / Number(impressions) : null;
            const cvr = clicks && Number(clicks) > 0 && orders !== null ? Number(orders) / Number(clicks) : null;

            await runSql(
                `INSERT INTO daily_asin_metrics
                 (asin, record_date, data_source, sessions, orders, impressions, clicks, ad_spend, ad_sales, total_sales, ad_orders, core_kw_rank, bsr_rank, acos, tacos, ctr, cvr)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 data_source = VALUES(data_source),
                 sessions = VALUES(sessions),
                 orders = VALUES(orders),
                 impressions = VALUES(impressions),
                 clicks = VALUES(clicks),
                 ad_spend = VALUES(ad_spend),
                 ad_sales = VALUES(ad_sales),
                 total_sales = VALUES(total_sales),
                 ad_orders = VALUES(ad_orders),
                 core_kw_rank = VALUES(core_kw_rank),
                 bsr_rank = VALUES(bsr_rank),
                 acos = VALUES(acos),
                 tacos = VALUES(tacos),
                 ctr = VALUES(ctr),
                 cvr = VALUES(cvr),
                 updated_at = NOW()`,
                [
                    asin,
                    dateStr,
                    source,
                    sessions !== null && Number.isFinite(sessions) ? Math.trunc(sessions) : null,
                    orders !== null && Number.isFinite(orders) ? Math.trunc(orders) : null,
                    impressions !== null && Number.isFinite(impressions) ? Math.trunc(impressions) : null,
                    clicks !== null && Number.isFinite(clicks) ? Math.trunc(clicks) : null,
                    ad_spend !== null && Number.isFinite(ad_spend) ? ad_spend : null,
                    ad_sales !== null && Number.isFinite(ad_sales) ? ad_sales : null,
                    total_sales !== null && Number.isFinite(total_sales) ? total_sales : null,
                    ad_orders !== null && Number.isFinite(ad_orders) ? Math.trunc(ad_orders) : null,
                    core_kw_rank !== null && Number.isFinite(core_kw_rank) ? Math.trunc(core_kw_rank) : null,
                    bsr_rank !== null && Number.isFinite(bsr_rank) ? Math.trunc(bsr_rank) : null,
                    acos !== null && Number.isFinite(acos) ? acos : null,
                    tacos !== null && Number.isFinite(tacos) ? tacos : null,
                    ctr !== null && Number.isFinite(ctr) ? ctr : null,
                    cvr !== null && Number.isFinite(cvr) ? cvr : null
                ]
            );
            asins.push(asin);
        }

        setImmediate(() => {
            runPostIngestionRules(Array.from(new Set(asins)), dateStr).catch(e => console.error('Async rules error', e));
        });

        res.json({ status: 'ok', processed: asins.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/tickets/:id/design-asset', fileUpload.single('file'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!req.file) throw new Error('请上传文件');
        const url = '/uploads/' + req.file.filename;
        await runSql(
            "UPDATE issue_tickets SET design_asset_url = ?, status = 'WAITING_VERIFY', updated_at = NOW() WHERE id = ?",
            [url, id]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/tickets/:id/verify', fileUpload.single('file'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const result = String(req.body.result || '').trim();
        const verify_evidence = String(req.body.verify_evidence || '').trim();
        const verify_file_url = req.file ? '/uploads/' + req.file.filename : null;
        if (!['RESOLVED', 'FAILED'].includes(result)) throw new Error('验收结果不合法');
        if (!verify_evidence && !verify_file_url) throw new Error('必须填写验收指标或上传凭证');

        await runSql(
            `UPDATE issue_tickets SET
             verify_evidence = ?, verify_file_url = COALESCE(?, verify_file_url),
             status = ?, resolved_at = NOW(), updated_at = NOW()
             WHERE id = ?`,
            [verify_evidence || null, verify_file_url, result, id]
        );
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

async function runDailyTicketScan(targetDateStr) {
    const ctrBenchmark = Number(await getSetting('ctr_benchmark', '0.003'));
    const cvrBenchmark = Number(await getSetting('cvr_benchmark', '0.08'));
    const bsrDropThreshold = Number(await getSetting('bsr_drop_threshold', '10'));
    const designUserId = await getDefaultDesignUserId();

    const rows = await queryAll(
        `SELECT m.*, sp.id AS sprint_id, sp.owner_id, sp.acos_limit
         FROM daily_asin_metrics m
         JOIN sprint_projects sp ON sp.asin = m.asin
         WHERE m.record_date = ? AND sp.status IN ('ACTIVE','MAINTENANCE')`,
        [targetDateStr]
    );

    for (const r of rows) {
        const asin = r.asin;
        const sprintId = r.sprint_id;
        const ownerId = r.owner_id || null;

        if (Number(r.impressions || 0) > 1000 && r.ctr !== null && r.ctr !== undefined && Number(r.ctr) < ctrBenchmark) {
            if (!(await ticketExists(asin, 'CTR_LOW', targetDateStr))) {
                const deadline = toDateString(addDays(parseYmd(targetDateStr), 3)) + ' 23:59:59';
                await createTicket({
                    sprint_id: sprintId,
                    asin,
                    ticket_type: 'CTR_LOW',
                    severity: 'B',
                    owner_id: ownerId,
                    co_owner_id: designUserId,
                    status: 'TODO',
                    sla_deadline: deadline,
                    trigger_reason: `曝光=${r.impressions}, CTR=${Number(r.ctr).toFixed(4)} < 标准=${ctrBenchmark}`
                });
            }
        }

        if (Number(r.clicks || 0) > 50 && r.cvr !== null && r.cvr !== undefined && Number(r.cvr) < cvrBenchmark) {
            if (!(await ticketExists(asin, 'CVR_LOW', targetDateStr))) {
                const deadline = toDateString(addDays(parseYmd(targetDateStr), 7)) + ' 23:59:59';
                await createTicket({
                    sprint_id: sprintId,
                    asin,
                    ticket_type: 'CVR_LOW',
                    severity: 'B',
                    owner_id: ownerId,
                    co_owner_id: designUserId,
                    status: 'TODO',
                    sla_deadline: deadline,
                    trigger_reason: `点击=${r.clicks}, CVR=${Number(r.cvr).toFixed(4)} < 标准=${cvrBenchmark}`
                });
            }
        }

        if (r.acos !== null && r.acos !== undefined && r.acos_limit !== null && r.acos_limit !== undefined) {
            if (Number(r.acos) > Number(r.acos_limit)) {
                if (!(await ticketExists(asin, 'ACOS_HIGH', targetDateStr))) {
                    const deadline = targetDateStr + ' 23:59:59';
                    await createTicket({
                        sprint_id: sprintId,
                        asin,
                        ticket_type: 'ACOS_HIGH',
                        severity: 'A',
                        owner_id: ownerId,
                        co_owner_id: null,
                        status: 'TODO',
                        sla_deadline: deadline,
                        trigger_reason: `昨日ACOS=${Number(r.acos).toFixed(2)}% > 上限=${Number(r.acos_limit).toFixed(2)}%`
                    });
                }
            }
        }

        if (Number(r.ad_orders || 0) > 3 && r.bsr_rank !== null && r.bsr_rank !== undefined) {
            const end = addDays(parseYmd(targetDateStr), -1);
            const start = addDays(end, -6);
            const avgRow = await queryOne(
                `SELECT AVG(bsr_rank) AS avg_bsr
                 FROM daily_asin_metrics
                 WHERE asin = ? AND record_date BETWEEN ? AND ? AND bsr_rank IS NOT NULL`,
                [asin, toDateString(start), toDateString(end)]
            );
            const avgBsr = avgRow && avgRow.avg_bsr !== null && avgRow.avg_bsr !== undefined ? Number(avgRow.avg_bsr) : null;
            if (avgBsr !== null) {
                const drop = Number(r.bsr_rank) - avgBsr;
                if (drop >= bsrDropThreshold) {
                    if (!(await ticketExists(asin, 'RANK_DROP', targetDateStr))) {
                        const deadline = toDateString(addDays(parseYmd(targetDateStr), 7)) + ' 23:59:59';
                        await createTicket({
                            sprint_id: sprintId,
                            asin,
                            ticket_type: 'RANK_DROP',
                            severity: 'B',
                            owner_id: ownerId,
                            co_owner_id: null,
                            status: 'TODO',
                            sla_deadline: deadline,
                            trigger_reason: `广告单量=${r.ad_orders}, BSR=${r.bsr_rank}, 近7日均值=${avgBsr.toFixed(2)}, 变差=${drop.toFixed(2)} >= 阈值=${bsrDropThreshold}`
                        });
                    }
                }
            }
        }
    }
}

async function schedulerTick() {
    if (!dbReady) return;
    const now = new Date();
    const weekStartStr = toDateString(getMondayStart(now));
    const currentWeekKey = await getSetting('weekly_review_generated_week', '');
    if (currentWeekKey !== weekStartStr) {
        await ensureWeeklyReviewsForActiveSprints(weekStartStr);
        await setSetting('weekly_review_generated_week', weekStartStr);
    }

    const targetDateStr = toDateString(addDays(now, -1));
    const lastScan = await getSetting('daily_ticket_scan_date', '');
    if (lastScan !== targetDateStr && (now.getHours() > 0 || now.getMinutes() >= 10)) {
        await runDailyTicketScan(targetDateStr);
        await setSetting('daily_ticket_scan_date', targetDateStr);
    }
}

setInterval(() => {
    schedulerTick().catch(e => console.error('Scheduler error:', e));
}, 60 * 1000);

schedulerTick().catch(e => console.error('Scheduler error:', e));

app.get('*', (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
        return next();
    }
    res.sendFile(INDEX_HTML);
});

app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).send('提交内容过大，请精简后重试（单月「开展时需要做什么」最多 20000 字符）');
    }
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).send(err.message || 'Server error');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('  Amazon 运营SOP管理系统');
    console.log(`  http://localhost:${PORT}`);
    console.log('='.repeat(50) + '\n');
});
