/**
 * Vue 前端：公开路由（登录）
 */
function registerPublicPageApi(app, ctx) {
    const { queryOne, verifyPassword, createSession, setSessionCookie } = ctx;

    app.get('/api/auth/login-hint', async (req, res) => {
        if (req.currentUser) {
            return res.json({ loggedIn: true, user: req.currentUser });
        }
        let defaultAdminHint = null;
        try {
            const adminName = String(process.env.ADMIN_NAME || 'admin').trim() || 'admin';
            const admin = await queryOne(
                'SELECT must_change_password FROM users WHERE name = ? AND password_hash IS NOT NULL',
                [adminName]
            );
            if (admin && Number(admin.must_change_password) === 1) {
                defaultAdminHint = {
                    name: adminName,
                    password: String(process.env.ADMIN_PASSWORD || 'admin123')
                };
            }
        } catch (e) {}
        res.json({ loggedIn: false, defaultAdminHint });
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const name = String(req.body.name || '').trim();
            const password = String(req.body.password || '');
            const nextUrl = String(req.body.next || '/dashboard').trim();
            const safeNext = nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/dashboard';

            if (!name || !password) {
                return res.status(400).json({ error: '请输入账号和密码' });
            }

            const user = await queryOne(
                'SELECT id, name, role, password_hash, must_change_password FROM users WHERE name = ?',
                [name]
            );
            if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
                return res.status(401).json({ error: '账号或密码错误' });
            }

            const token = createSession(user);
            setSessionCookie(res, token);
            res.json({
                status: 'ok',
                mustChangePassword: !!user.must_change_password,
                redirect: user.must_change_password ? '/account/change-password' : safeNext
            });
        } catch (e) {
            console.error('Login API error:', e);
            res.status(500).json({ error: '登录失败，请稍后重试' });
        }
    });
}

/**
 * Vue 前端：需登录的路由
 */
function registerProtectedPageApi(app, ctx) {
    const {
        queryAll,
        queryOne,
        runSql,
        getModulesWithItems,
        getProductModuleProgressMap,
        buildTableRefMap,
        importExcel,
        EXCEL_PATH,
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
        resetDesignUserCache
    } = ctx;

    app.get('/api/auth/me', (req, res) => {
        if (!req.currentUser) return res.status(401).json({ error: '未登录' });
        res.json({ user: req.currentUser });
    });

    app.post('/api/auth/logout', (req, res) => {
        destroySession(req);
        clearSessionCookie(res);
        res.json({ status: 'ok' });
    });

    app.post('/api/auth/change-password', async (req, res) => {
        try {
            const currentPassword = String(req.body.current_password || '');
            const newPassword = String(req.body.new_password || '');
            const confirmPassword = String(req.body.confirm_password || '');

            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.status(400).json({ error: '请填写所有密码字段' });
            }
            if (newPassword.length < 4) {
                return res.status(400).json({ error: '新密码至少 4 位' });
            }
            if (newPassword !== confirmPassword) {
                return res.status(400).json({ error: '两次输入的新密码不一致' });
            }

            const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.currentUser.id]);
            if (!user || !verifyPassword(currentPassword, user.password_hash)) {
                return res.status(400).json({ error: '当前密码不正确' });
            }
            if (verifyPassword(newPassword, user.password_hash)) {
                return res.status(400).json({ error: '新密码不能与当前密码相同' });
            }

            await runSql(
                'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = NOW() WHERE id = ?',
                [hashPassword(newPassword), req.currentUser.id]
            );
            updateSessionUser(req, { mustChangePassword: false }, res);
            res.json({ status: 'ok', redirect: '/dashboard?password_changed=1' });
        } catch (e) {
            console.error('Change password API error:', e);
            res.status(500).json({ error: '修改失败，请稍后重试' });
        }
    });

    // ========== Page Data API ==========

    app.get('/api/dashboard', async (req, res) => {
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

            let products = await queryAll(
                `SELECT id, asin, name, category, status, overall_progress, excel_row FROM products WHERE ${whereSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
                [...filterParams, pageSize, offset]
            );

            const progressMap = await getProductModuleProgressMap(products.map(product => product.id));
            products = products.map(product => {
                const moduleProgress = progressMap[product.id] || {};
                const fullProgress = {};
                for (const module of modules) {
                    fullProgress[module.id] = moduleProgress[module.id] || {
                        completed: 0,
                        total: 0,
                        percentage: 0
                    };
                }
                return { ...product, module_progress: fullProgress };
            });

            const categories = await queryAll('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');

            res.json({
                products,
                modules,
                categories: categories.map(r => r.category),
                current_search: search,
                current_category: category,
                current_status: status,
                page,
                pageSize,
                total,
                totalPages,
                stats
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/product/:asin', async (req, res) => {
        try {
            const { asin } = req.params;
            const product = await queryOne('SELECT * FROM products WHERE asin = ?', [asin]);
            if (!product) return res.status(404).json({ error: 'Product not found' });

            const allModules = await getModulesWithItems();
            const modules = allModules.filter(m => m.sort_order > 1);
            const refMap = buildTableRefMap();
            for (const mod of modules) {
                const itemRefs = refMap[mod.name] || {};
                mod.sop_items = mod.sop_items.map(item => ({
                    ...item,
                    table_ref: itemRefs[item.name] || null
                }));
            }

            const records = await queryAll('SELECT * FROM product_sop_records WHERE product_id = ?', [product.id]);
            const recordMap = {};
            for (const r of records) recordMap[r.sop_item_id] = r;

            const progressMap = await getProductModuleProgressMap([product.id]);
            const moduleProgress = {};
            for (const m of allModules) {
                moduleProgress[m.id] = (progressMap[product.id] && progressMap[product.id][m.id]) || {
                    completed: 0,
                    total: 0,
                    percentage: 0
                };
            }

            res.json({ product, modules, recordMap, moduleProgress });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/product/:asin/version/:versionId', async (req, res) => {
        try {
            const { asin, versionId } = req.params;
            const product = await queryOne('SELECT * FROM products WHERE asin = ?', [asin]);
            if (!product) return res.status(404).json({ error: 'Product not found' });

            const version = await queryOne(
                'SELECT * FROM product_versions WHERE id = ? AND product_id = ?',
                [versionId, product.id]
            );
            if (!version) return res.status(404).json({ error: '版本不存在' });

            let snapshot;
            try { snapshot = JSON.parse(version.snapshot_data); } catch (e) { snapshot = { modules: [] }; }

            const modules = (snapshot.modules || []).filter(m => m.sort_order > 1);
            const recordMap = {};
            for (const m of snapshot.modules || []) {
                for (const it of m.sop_items || []) {
                    recordMap[it.id] = {
                        id: 'v_' + version.id + '_' + it.id,
                        status: it.record?.status || '待处理',
                        remark: it.record?.remark || '',
                        image_url: it.record?.image_url || null
                    };
                }
            }

            const moduleProgress = {};
            for (const m of snapshot.modules || []) {
                let total = 0;
                let completed = 0;
                for (const it of m.sop_items || []) {
                    if (!it.is_data_column) {
                        total++;
                        if ((it.record?.status) === '已完成') completed++;
                    }
                }
                moduleProgress[m.id] = {
                    completed,
                    total,
                    percentage: total > 0 ? Math.round(completed / total * 10000) / 10000 : 0
                };
            }

            const virtualProduct = {
                ...product,
                name: snapshot.product?.name ?? product.name,
                category: snapshot.product?.category ?? product.category,
                status: snapshot.product?.status ?? product.status,
                overall_progress: snapshot.product?.overall_progress ?? product.overall_progress
            };

            res.json({
                product: virtualProduct,
                originalProduct: product,
                modules,
                recordMap,
                moduleProgress,
                version: {
                    id: version.id,
                    version_number: version.version_number,
                    version_name: version.version_name,
                    created_at: version.created_at,
                    updated_at: version.updated_at
                }
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/sop', async (req, res) => {
        try {
            const dbModules = await getModulesWithItems();
            const refMap = buildTableRefMap();
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
            res.json({ modules });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/import', (req, res) => {
        res.json({ import_path: EXCEL_PATH, result: null });
    });

    app.post('/api/import', async (req, res) => {
        try {
            const result = await importExcel();
            res.json({ import_path: EXCEL_PATH, result });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/users', async (req, res) => {
        try {
            const users = await queryAll('SELECT id, name, role, created_at, updated_at FROM users ORDER BY id ASC');
            res.json({ users });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/users', async (req, res) => {
        try {
            const name = String(req.body.name || '').trim();
            const role = String(req.body.role || '').trim();
            const password = String(req.body.password || '');
            if (!name) return res.status(400).json({ error: '姓名不能为空' });
            if (!['OPS', 'DESIGN', 'MANAGER'].includes(role)) return res.status(400).json({ error: '角色不合法' });
            if (!password || password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
            await runSql('INSERT INTO users (name, password_hash, role) VALUES (?, ?, ?)', [name, hashPassword(password), role]);
            resetDesignUserCache();
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/users/:id/password', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const password = String(req.body.password || '');
            if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
            if (!password || password.length < 4) return res.status(400).json({ error: '新密码至少 4 位' });
            const existing = await queryOne('SELECT id FROM users WHERE id = ?', [id]);
            if (!existing) return res.status(404).json({ error: '用户不存在' });
            await runSql('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hashPassword(password), id]);
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/users/:id/delete', async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id) return res.status(400).json({ error: '无效 ID' });
            await runSql('DELETE FROM users WHERE id = ?', [id]);
            resetDesignUserCache();
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/sprints', async (req, res) => {
        try {
            const sprints = await queryAll(
                `SELECT sp.*, u.name AS owner_name
                 FROM sprint_projects sp
                 LEFT JOIN users u ON sp.owner_id = u.id
                 ORDER BY sp.id DESC`
            );
            res.json({ sprints });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/sprints/form', async (req, res) => {
        try {
            const id = req.query.id ? Number(req.query.id) : null;
            const users = await queryAll('SELECT * FROM users ORDER BY id ASC');
            let sprint = null;
            if (id) {
                sprint = await queryOne('SELECT * FROM sprint_projects WHERE id = ?', [id]);
                if (!sprint) return res.status(404).json({ error: '项目不存在' });
            }
            res.json({ sprint, users });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const numOrNull = v => {
        const s = String(v || '').trim();
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    };
    const intOrNull = v => {
        const n = numOrNull(v);
        return n === null ? null : Math.trunc(n);
    };

    async function saveSprint(body, id) {
        const asin = String(body.asin || '').trim();
        const owner_id = body.owner_id ? Number(body.owner_id) : null;
        const status = String(body.status || 'ACTIVE').trim();
        const start_date = String(body.start_date || '').trim();
        const end_date = String(body.end_date || '').trim();
        const target_cycle_days = Number(body.target_cycle_days || 14);
        if (!asin) throw new Error('ASIN 不能为空');
        const sd = parseYmd(start_date);
        const ed = parseYmd(end_date);
        if (!sd || !ed) throw new Error('开始/结束日期不合法');
        if (ed.getTime() < sd.getTime()) throw new Error('结束日期不能早于开始日期');
        if (!Number.isFinite(target_cycle_days) || target_cycle_days <= 0) throw new Error('目标周期不合法');
        if (!['ACTIVE', 'MAINTENANCE', 'STOPPED'].includes(status)) throw new Error('状态不合法');

        const values = [
            owner_id || null,
            status,
            start_date,
            end_date,
            target_cycle_days,
            numOrNull(body.current_daily_orders),
            numOrNull(body.target_daily_orders),
            intOrNull(body.current_rank),
            intOrNull(body.target_rank),
            numOrNull(body.promo_tacos_limit),
            numOrNull(body.stable_tacos_target),
            numOrNull(body.max_loss_7d),
            intOrNull(body.inventory_days),
            String(body.competitor_action || '').trim() || null,
            body.page_ok ? 1 : 0,
            String(body.exit_conditions || '').trim() || null,
            numOrNull(body.profit_margin),
            numOrNull(body.acos_limit)
        ];

        if (id) {
            await runSql(
                `UPDATE sprint_projects SET
                 asin = ?, owner_id = ?, status = ?, start_date = ?, end_date = ?, target_cycle_days = ?,
                 current_daily_orders = ?, target_daily_orders = ?, current_rank = ?, target_rank = ?,
                 promo_tacos_limit = ?, stable_tacos_target = ?, max_loss_7d = ?, inventory_days = ?,
                 competitor_action = ?, page_ok = ?, exit_conditions = ?, profit_margin = ?, acos_limit = ?,
                 updated_at = NOW()
                 WHERE id = ?`,
                [asin, ...values, id]
            );
        } else {
            await runSql(
                `INSERT INTO sprint_projects
                 (asin, owner_id, status, start_date, end_date, target_cycle_days,
                  current_daily_orders, target_daily_orders, current_rank, target_rank,
                  promo_tacos_limit, stable_tacos_target, max_loss_7d, inventory_days,
                  competitor_action, page_ok, exit_conditions, profit_margin, acos_limit)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [asin, ...values]
            );
        }
    }

    app.post('/api/sprints', async (req, res) => {
        try {
            await saveSprint(req.body, null);
            res.json({ status: 'ok', redirect: '/sprints' });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/sprints/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const sprint = await queryOne('SELECT * FROM sprint_projects WHERE id = ?', [id]);
            if (!sprint) return res.status(404).json({ error: '项目不存在' });
            await saveSprint(req.body, id);
            res.json({ status: 'ok', redirect: '/sprints' });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.get('/api/reviews', async (req, res) => {
        try {
            const sprint_id = req.query.sprint_id ? Number(req.query.sprint_id) : null;
            const status = String(req.query.status || '').trim();
            const weekStartStr = toDateString(getMondayStart(new Date()));
            await ensureWeeklyReviewsForActiveSprints(weekStartStr);

            const where = ['1=1'];
            const params = [];
            if (sprint_id) {
                where.push('wr.sprint_id = ?');
                params.push(sprint_id);
            }
            if (status) {
                where.push('wr.status = ?');
                params.push(status);
            }
            const reviews = await queryAll(
                `SELECT wr.*, sp.asin
                 FROM weekly_reviews wr
                 JOIN sprint_projects sp ON wr.sprint_id = sp.id
                 WHERE ${where.join(' AND ')}
                 ORDER BY wr.week_start_date DESC, wr.id DESC`,
                params
            );
            const sprints = await queryAll('SELECT id, asin, status FROM sprint_projects ORDER BY id DESC');
            res.json({
                reviews,
                sprints,
                current_sprint_id: sprint_id ? String(sprint_id) : '',
                current_status: status || ''
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/reviews/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const review = await queryOne(
                `SELECT wr.*, sp.asin
                 FROM weekly_reviews wr
                 JOIN sprint_projects sp ON wr.sprint_id = sp.id
                 WHERE wr.id = ?`,
                [id]
            );
            if (!review) return res.status(404).json({ error: '复盘不存在' });
            res.json({ review });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/reviews/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const review = await queryOne('SELECT * FROM weekly_reviews WHERE id = ?', [id]);
            if (!review) return res.status(404).json({ error: '复盘不存在' });

            const actual_max_loss = Number(req.body.actual_max_loss);
            const actual_tacos = Number(req.body.actual_tacos);
            const decision = String(req.body.decision || '').trim();
            const status = String(req.body.status || '').trim();
            const summary = String(req.body.summary || '').trim();

            if (!Number.isFinite(actual_max_loss)) throw new Error('本周实际最大亏损不合法');
            if (!Number.isFinite(actual_tacos)) throw new Error('当前实际TACOS不合法');
            if (!['CONTINUE', 'MAINTENANCE', 'STOPPED'].includes(decision)) throw new Error('决策不合法');
            if (!['PENDING', 'COMPLETED'].includes(status)) throw new Error('复盘状态不合法');
            if (!summary) throw new Error('复盘结论不能为空');

            await runSql(
                `UPDATE weekly_reviews SET
                 actual_max_loss = ?, actual_tacos = ?, decision = ?, status = ?, summary = ?, updated_at = NOW()
                 WHERE id = ?`,
                [actual_max_loss, actual_tacos, decision, status, summary, id]
            );

            if (decision === 'MAINTENANCE') {
                await runSql("UPDATE sprint_projects SET status = 'MAINTENANCE', updated_at = NOW() WHERE id = ?", [review.sprint_id]);
            } else if (decision === 'STOPPED') {
                await runSql("UPDATE sprint_projects SET status = 'STOPPED', updated_at = NOW() WHERE id = ?", [review.sprint_id]);
            } else if (decision === 'CONTINUE') {
                await runSql("UPDATE sprint_projects SET status = 'ACTIVE', updated_at = NOW() WHERE id = ?", [review.sprint_id]);
            }

            res.json({ status: 'ok', redirect: '/reviews?sprint_id=' + review.sprint_id });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.get('/api/metrics/manual', async (req, res) => {
        try {
            const current_date = toDateString(new Date());
            const prefill = await queryAll("SELECT id, asin FROM sprint_projects WHERE status IN ('ACTIVE','MAINTENANCE') ORDER BY id DESC");
            res.json({ current_date, prefill });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/knowledge', async (req, res) => {
        try {
            const keyword = String(req.query.keyword || '').trim();
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const pageSize = 20;
            const offset = (page - 1) * pageSize;

            let whereSql = '';
            const params = [];
            if (keyword) {
                whereSql = 'WHERE title LIKE ? OR content LIKE ?';
                const like = `%${keyword}%`;
                params.push(like, like);
            }

            const totalRow = await queryOne(`SELECT COUNT(*) AS cnt FROM knowledge_docs ${whereSql}`, params);
            const total = totalRow ? Number(totalRow.cnt) : 0;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));

            const docs = await queryAll(
                `SELECT id, title, LEFT(content, 120) AS excerpt, updated_at FROM knowledge_docs ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
                [...params, pageSize, offset]
            );

            res.json({ docs, keyword, page, pageSize, total, totalPages });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/knowledge/doc', async (req, res) => {
        try {
            const idRaw = parseInt(req.query.id);
            const id = Number.isFinite(idRaw) ? idRaw : null;
            const loadDraft = String(req.query.load_draft || '') === '1';

            if (id) {
                const doc = await queryOne('SELECT * FROM knowledge_docs WHERE id = ?', [id]);
                if (!doc) return res.status(404).json({ error: '文档不存在' });
                return res.json({
                    doc,
                    isNew: false,
                    published: String(req.query.published || '') === '1',
                    draftAvailable: false,
                    loadDraft: false
                });
            }

            const draft = await queryOne(
                'SELECT title, content FROM knowledge_drafts WHERE user_id = ?',
                [req.currentUser.id]
            );
            const draftAvailable = !!(draft && (String(draft.title || '').trim() || String(draft.content || '').trim()));
            res.json({
                doc: null,
                isNew: true,
                published: false,
                draftAvailable,
                loadDraft
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/knowledge/save', async (req, res) => {
        try {
            const idRaw = parseInt(req.body.id);
            const id = Number.isFinite(idRaw) ? idRaw : null;
            const title = String(req.body.title || '').trim();
            const content = String(req.body.content || '');

            if (!title) return res.status(400).json({ error: '标题不能为空' });
            if (title.length > 500) return res.status(400).json({ error: '标题过长（最多 500 字符）' });
            if (content.length > 500000) return res.status(400).json({ error: '正文过长（最多 500000 字符）' });

            if (id) {
                const existing = await queryOne('SELECT id FROM knowledge_docs WHERE id = ?', [id]);
                if (!existing) return res.status(404).json({ error: '文档不存在' });
                await runSql(
                    'UPDATE knowledge_docs SET title = ?, content = ?, updated_at = NOW() WHERE id = ?',
                    [title, content, id]
                );
                await runSql('DELETE FROM knowledge_drafts WHERE user_id = ?', [req.currentUser.id]);
                return res.json({ status: 'ok', redirect: `/knowledge/${id}?published=1` });
            }

            const result = await runSql('INSERT INTO knowledge_docs (title, content) VALUES (?, ?)', [title, content]);
            const newId = result && result.insertId ? result.insertId : null;
            if (!newId) return res.status(500).json({ error: '发布失败' });
            await runSql('DELETE FROM knowledge_drafts WHERE user_id = ?', [req.currentUser.id]);
            res.json({ status: 'ok', redirect: `/knowledge/${newId}?published=1` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/knowledge/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return res.status(400).json({ error: '无效的文档 ID' });
            const existing = await queryOne('SELECT id FROM knowledge_docs WHERE id = ?', [id]);
            if (!existing) return res.status(404).json({ error: '文档不存在' });
            await runSql('DELETE FROM knowledge_docs WHERE id = ?', [id]);
            res.json({ status: 'ok', redirect: '/knowledge' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/daily-rants', async (req, res) => {
        try {
            const keyword = String(req.query.keyword || '').trim();
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const pageSize = 20;
            const offset = (page - 1) * pageSize;
            const isManager = req.currentUser.role === 'MANAGER';

            const conditions = [];
            const params = [];
            if (!isManager) {
                conditions.push('dr.user_id = ?');
                params.push(req.currentUser.id);
            }
            if (keyword) {
                conditions.push('(dr.content LIKE ? OR u.name LIKE ?)');
                const like = `%${keyword}%`;
                params.push(like, like);
            }
            const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

            const totalRow = await queryOne(
                `SELECT COUNT(*) AS cnt FROM daily_rants dr JOIN users u ON dr.user_id = u.id ${whereSql}`,
                params
            );
            const total = totalRow ? Number(totalRow.cnt) : 0;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));

            const rants = await queryAll(
                `SELECT dr.id, dr.rant_date, dr.content, dr.created_at, dr.updated_at, dr.user_id,
                        u.name AS author_name
                 FROM daily_rants dr
                 JOIN users u ON dr.user_id = u.id
                 ${whereSql}
                 ORDER BY dr.rant_date DESC, dr.id DESC
                 LIMIT ? OFFSET ?`,
                [...params, pageSize, offset]
            );

            res.json({
                rants,
                keyword,
                page,
                pageSize,
                total,
                totalPages,
                isManager,
                currentUser: req.currentUser
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/daily-rants/doc', async (req, res) => {
        try {
            const idRaw = parseInt(req.query.id);
            const id = Number.isFinite(idRaw) ? idRaw : null;

            if (!id) {
                return res.json({
                    rant: null,
                    isNew: true,
                    saved: false,
                    canEdit: true,
                    currentUser: req.currentUser
                });
            }

            const rant = await queryOne(
                `SELECT dr.*, u.name AS author_name
                 FROM daily_rants dr
                 JOIN users u ON dr.user_id = u.id
                 WHERE dr.id = ?`,
                [id]
            );
            if (!rant) return res.status(404).json({ error: '吐槽不存在' });

            const isManager = req.currentUser.role === 'MANAGER';
            if (!isManager && rant.user_id !== req.currentUser.id) {
                return res.status(403).json({ error: '无权查看他人的吐槽' });
            }

            res.json({
                rant,
                isNew: false,
                saved: String(req.query.saved || '') === '1',
                canEdit: rant.user_id === req.currentUser.id || isManager,
                currentUser: req.currentUser
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/daily-rants/save', async (req, res) => {
        try {
            const idRaw = parseInt(req.body.id);
            const id = Number.isFinite(idRaw) ? idRaw : null;
            const content = String(req.body.content || '');

            if (!content.trim()) return res.status(400).json({ error: '内容不能为空' });
            if (content.length > 50000) return res.status(400).json({ error: '内容过长（最多 50000 字符）' });

            if (id) {
                const existing = await queryOne('SELECT id, user_id FROM daily_rants WHERE id = ?', [id]);
                if (!existing) return res.status(404).json({ error: '吐槽不存在' });
                if (existing.user_id !== req.currentUser.id && req.currentUser.role !== 'MANAGER') {
                    return res.status(403).json({ error: '无权编辑他人的吐槽' });
                }
                await runSql('UPDATE daily_rants SET content = ?, updated_at = NOW() WHERE id = ?', [content, id]);
                return res.json({ status: 'ok', redirect: `/daily-rants/${id}?saved=1` });
            }

            const rantDate = toDateString(new Date());
            const result = await runSql(
                'INSERT INTO daily_rants (user_id, content, rant_date) VALUES (?, ?, ?)',
                [req.currentUser.id, content, rantDate]
            );
            const newId = result && result.insertId ? result.insertId : null;
            if (!newId) return res.status(500).json({ error: '保存失败' });
            res.json({ status: 'ok', redirect: `/daily-rants/${newId}?saved=1` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/daily-rants/:id/delete', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return res.status(400).json({ error: '无效的 ID' });
            const existing = await queryOne('SELECT id, user_id FROM daily_rants WHERE id = ?', [id]);
            if (!existing) return res.status(404).json({ error: '吐槽不存在' });
            if (existing.user_id !== req.currentUser.id && req.currentUser.role !== 'MANAGER') {
                return res.status(403).json({ error: '无权删除他人的吐槽' });
            }
            await runSql('DELETE FROM daily_rants WHERE id = ?', [id]);
            res.json({ status: 'ok', redirect: '/daily-rants' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/annual-activities', async (req, res) => {
        try {
            const now = new Date();
            const currentYear = now.getFullYear();
            const year = Math.min(2100, Math.max(2000, parseInt(req.query.year) || currentYear));
            const saved = String(req.query.saved || '') === '1';
            const syncedFromYearRaw = parseInt(req.query.synced_from);
            const syncedFromYear = Number.isFinite(syncedFromYearRaw) ? syncedFromYearRaw : null;

            const rows = await queryAll(
                'SELECT year, month, activity_title, action_plan FROM annual_activities WHERE year = ? ORDER BY month ASC',
                [year]
            );
            const activitiesMap = {};
            for (const row of rows) activitiesMap[row.month] = row;

            res.json({ year, saved, syncedFromYear, activitiesMap });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/annual-activities/save', async (req, res) => {
        try {
            const year = Math.min(2100, Math.max(2000, parseInt(req.body.year) || new Date().getFullYear()));

            for (let month = 1; month <= 12; month++) {
                const activity_title = String(req.body['title_' + month] || '').trim() || null;
                const action_plan = String(req.body['plan_' + month] || '').trim() || null;

                if (activity_title && activity_title.length > 500) {
                    return res.status(400).json({ error: `第 ${month} 月主要活动过长（最多 500 字符）` });
                }
                if (action_plan && action_plan.length > 20000) {
                    return res.status(400).json({ error: `第 ${month} 月“开展时需要做什么”过长（最多 20000 字符）` });
                }

                if (!activity_title && !action_plan) {
                    await runSql('DELETE FROM annual_activities WHERE year = ? AND month = ?', [year, month]);
                    continue;
                }

                await runSql(
                    `INSERT INTO annual_activities (year, month, activity_title, action_plan)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        activity_title = VALUES(activity_title),
                        action_plan = VALUES(action_plan),
                        updated_at = NOW()`,
                    [year, month, activity_title, action_plan]
                );
            }

            res.json({ status: 'ok', redirect: `/annual-activities?year=${year}&saved=1` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/annual-activities/sync', async (req, res) => {
        try {
            const fromYearRaw = parseInt(req.body.from_year);
            const toYearRaw = parseInt(req.body.to_year);
            const from_year = Math.min(2100, Math.max(2000, Number.isFinite(fromYearRaw) ? fromYearRaw : new Date().getFullYear() - 1));
            const to_year = Math.min(2100, Math.max(2000, Number.isFinite(toYearRaw) ? toYearRaw : new Date().getFullYear()));

            if (from_year === to_year) {
                return res.status(400).json({ error: '源年份与目标年份不能相同' });
            }

            await runSql('DELETE FROM annual_activities WHERE year = ?', [to_year]);
            await runSql(
                `INSERT INTO annual_activities (year, month, activity_title, action_plan, created_at, updated_at)
                 SELECT ?, month, activity_title, action_plan, NOW(), NOW()
                 FROM annual_activities WHERE year = ?`,
                [to_year, from_year]
            );

            res.json({
                status: 'ok',
                redirect: `/annual-activities?year=${to_year}&saved=1&synced_from=${from_year}`
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/competitors', async (req, res) => {
        try {
            const keyword = String(req.query.keyword || '').trim();
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const pageSize = 15;
            const offset = (page - 1) * pageSize;

            const actionPreset = String(req.query.action_preset || '').trim();
            let actionFrom = parseYmd(req.query.action_from);
            let actionTo = parseYmd(req.query.action_to);
            if (actionPreset === 'week') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                actionFrom = addDays(today, -6);
                actionTo = today;
            }
            if (actionFrom && actionTo && actionFrom.getTime() > actionTo.getTime()) {
                const tmp = actionFrom;
                actionFrom = actionTo;
                actionTo = tmp;
            }
            const hasActionDateFilter = Boolean(actionFrom || actionTo);

            const conditions = [];
            const countParams = [];
            if (keyword) {
                conditions.push('brand_name LIKE ?');
                countParams.push(`%${keyword}%`);
            }
            if (hasActionDateFilter) {
                let actionExistsSql = `EXISTS (
                    SELECT 1 FROM competitor_actions ca
                    WHERE ca.competitor_id = competitors.id`;
                if (actionFrom) {
                    actionExistsSql += ' AND ca.created_at >= ?';
                    countParams.push(`${toDateString(actionFrom)} 00:00:00`);
                }
                if (actionTo) {
                    actionExistsSql += ' AND ca.created_at < ?';
                    countParams.push(`${toDateString(addDays(actionTo, 1))} 00:00:00`);
                }
                actionExistsSql += ')';
                conditions.push(actionExistsSql);
            }
            const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

            const totalRow = await queryOne(`SELECT COUNT(*) AS cnt FROM competitors ${whereSql}`, countParams);
            const total = totalRow ? totalRow.cnt : 0;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));

            const listParams = [...countParams, pageSize, offset];
            const orderBy = hasActionDateFilter ? 'updated_at DESC, id DESC' : 'created_at DESC, id DESC';
            const competitors = await queryAll(
                `SELECT * FROM competitors ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
                listParams
            );

            let actionDateSql = '';
            const actionDateParams = [];
            if (hasActionDateFilter) {
                if (actionFrom) {
                    actionDateSql += ' AND created_at >= ?';
                    actionDateParams.push(`${toDateString(actionFrom)} 00:00:00`);
                }
                if (actionTo) {
                    actionDateSql += ' AND created_at < ?';
                    actionDateParams.push(`${toDateString(addDays(actionTo, 1))} 00:00:00`);
                }
            }

            const recentActions = {};
            if (competitors.length > 0) {
                const ids = competitors.map(c => c.id);
                const placeholders = ids.map(() => '?').join(',');
                const actions = await queryAll(
                    `SELECT id, competitor_id, action_text, created_at FROM competitor_actions WHERE competitor_id IN (${placeholders})${actionDateSql} ORDER BY competitor_id ASC, created_at DESC, id DESC`,
                    [...ids, ...actionDateParams]
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
                    `SELECT competitor_id, COUNT(*) AS cnt FROM competitor_actions WHERE competitor_id IN (${placeholders})${actionDateSql} GROUP BY competitor_id`,
                    [...ids, ...actionDateParams]
                );
                for (const r of rows) actionTotals[r.competitor_id] = r.cnt;
            }
            const latestMonitorRecords = {};
            const recentMonitorRecords = {};
            if (competitors.length > 0) {
                const ids = competitors.map(c => c.id);
                const placeholders = ids.map(() => '?').join(',');
                const records = await queryAll(
                    `SELECT id, competitor_id, image_url, has_change, action_text, created_at
                     FROM competitor_monitor_records
                     WHERE competitor_id IN (${placeholders})
                     ORDER BY competitor_id ASC, created_at DESC, id DESC`,
                    ids
                );
                for (const record of records) {
                    record.image_url = normalizeMonitorImageUrl(record.image_url);
                    const cid = record.competitor_id;
                    if (!latestMonitorRecords[cid]) latestMonitorRecords[cid] = record;
                    if (!recentMonitorRecords[cid]) recentMonitorRecords[cid] = [];
                    if (recentMonitorRecords[cid].length < 2) recentMonitorRecords[cid].push(record);
                }
            }
            const monitorTotals = {};
            if (competitors.length > 0) {
                const ids = competitors.map(c => c.id);
                const placeholders = ids.map(() => '?').join(',');
                const rows = await queryAll(
                    `SELECT competitor_id, COUNT(*) AS cnt
                     FROM competitor_monitor_records
                     WHERE competitor_id IN (${placeholders})
                     GROUP BY competitor_id`,
                    ids
                );
                for (const r of rows) monitorTotals[r.competitor_id] = r.cnt;
            }

            res.json({
                competitors,
                recentActions,
                actionTotals,
                latestMonitorRecords,
                recentMonitorRecords,
                monitorTotals,
                keyword,
                page,
                pageSize,
                total,
                totalPages,
                actionPreset,
                actionFrom: actionFrom ? toDateString(actionFrom) : '',
                actionTo: actionTo ? toDateString(actionTo) : '',
                hasActionDateFilter
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    async function fetchTicket(id) {
        const ticket = await queryOne(
            `SELECT t.*,
                    u1.name AS owner_name,
                    u2.name AS co_owner_name,
                    DATE_FORMAT(t.sla_deadline, '%Y-%m-%d %H:%i:%s') AS sla_deadline_fmt
             FROM issue_tickets t
             LEFT JOIN users u1 ON t.owner_id = u1.id
             LEFT JOIN users u2 ON t.co_owner_id = u2.id
             WHERE t.id = ?`,
            [id]
        );
        if (ticket) ticket.sla_deadline = ticket.sla_deadline_fmt || null;
        return ticket;
    }

    app.get('/api/tickets', async (req, res) => {
        try {
            const asin = String(req.query.asin || '').trim();
            const status = String(req.query.status || '').trim();
            const owner_id = req.query.owner_id ? Number(req.query.owner_id) : null;
            const where = ['1=1'];
            const params = [];
            if (asin) {
                where.push('t.asin LIKE ?');
                params.push(`%${asin}%`);
            }
            if (status) {
                where.push('t.status = ?');
                params.push(status);
            }
            if (owner_id) {
                where.push('t.owner_id = ?');
                params.push(owner_id);
            }
            const tickets = await queryAll(
                `SELECT t.*,
                        u1.name AS owner_name,
                        u2.name AS co_owner_name,
                        DATE_FORMAT(t.sla_deadline, '%Y-%m-%d %H:%i:%s') AS sla_deadline_fmt
                 FROM issue_tickets t
                 LEFT JOIN users u1 ON t.owner_id = u1.id
                 LEFT JOIN users u2 ON t.co_owner_id = u2.id
                 WHERE ${where.join(' AND ')}
                 ORDER BY FIELD(t.status,'TODO','PENDING_DESIGN','WAITING_VERIFY','FAILED','RESOLVED'), t.sla_deadline IS NULL, t.sla_deadline ASC, t.id DESC`,
                params
            );
            const now = new Date();
            for (const t of tickets) {
                t.sla_deadline = t.sla_deadline_fmt || null;
                t.is_overdue = t.sla_deadline && new Date(t.sla_deadline.replace(' ', 'T')).getTime() < now.getTime();
            }
            const users = await queryAll('SELECT * FROM users ORDER BY id ASC');
            res.json({
                tickets,
                users,
                current_asin: asin,
                current_status: status,
                current_owner_id: owner_id ? String(owner_id) : ''
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/tickets/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const ticket = await fetchTicket(id);
            if (!ticket) return res.status(404).json({ error: '工单不存在' });
            const users = await queryAll('SELECT * FROM users ORDER BY id ASC');
            res.json({ ticket, users });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/tickets/:id/assign', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const owner_id = req.body.owner_id ? Number(req.body.owner_id) : null;
            const co_owner_id = req.body.co_owner_id ? Number(req.body.co_owner_id) : null;
            await runSql('UPDATE issue_tickets SET owner_id = ?, co_owner_id = ?, updated_at = NOW() WHERE id = ?', [
                owner_id || null,
                co_owner_id || null,
                id
            ]);
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/tickets/:id/status', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const status = String(req.body.status || '').trim();
            if (!['TODO', 'PENDING_DESIGN', 'WAITING_VERIFY', 'RESOLVED', 'FAILED'].includes(status)) {
                throw new Error('状态不合法');
            }
            if (status === 'RESOLVED' || status === 'FAILED') {
                const row = await queryOne('SELECT verify_evidence, verify_file_url FROM issue_tickets WHERE id = ?', [id]);
                const hasEvidence = row && ((row.verify_evidence && String(row.verify_evidence).trim()) || row.verify_file_url);
                if (!hasEvidence) throw new Error('结单必须填写验收指标或上传凭证');
                await runSql('UPDATE issue_tickets SET status = ?, resolved_at = NOW(), updated_at = NOW() WHERE id = ?', [status, id]);
            } else {
                await runSql('UPDATE issue_tickets SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
            }
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/tickets/:id/design-request', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const design_request = String(req.body.design_request || '').trim();
            if (!design_request) throw new Error('修改意见不能为空');
            await runSql(
                "UPDATE issue_tickets SET design_request = ?, status = 'PENDING_DESIGN', updated_at = NOW() WHERE id = ?",
                [design_request, id]
            );
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    const {
        createAnalysis: createProductSelectionAnalysis,
        getAnalysisById: getProductSelectionAnalysis,
        listAnalyses: listProductSelectionAnalyses
    } = require('../service/product-selection');

    app.get('/api/product-selection/analyses', async (req, res) => {
        try {
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const pageSize = Math.min(50, Math.max(1, parseInt(req.query.page_size) || 20));
            const data = await listProductSelectionAnalyses({ page, pageSize });
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/product-selection/analyses/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const analysis = await getProductSelectionAnalysis(id);
            if (!analysis) return res.status(404).json({ error: '分析任务不存在' });
            res.json({ analysis });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/product-selection/analyses', async (req, res) => {
        try {
            const analysis = await createProductSelectionAnalysis(req.currentUser && req.currentUser.id, req.body);
            res.json({ analysis });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
}

module.exports = { registerPublicPageApi, registerProtectedPageApi };
