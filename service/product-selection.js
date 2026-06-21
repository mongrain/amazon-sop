const { queryAll, queryOne, runSql } = require('../database');
const { dispatchProductSelectionAnalysis } = require('../orchestration/product-selection');

function parsePositiveNumber(value, label, { required = false, integer = false } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new Error(`${label}不能为空`);
        return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        throw new Error(`${label}必须为正数`);
    }
    if (integer && !Number.isInteger(num)) {
        throw new Error(`${label}必须为整数`);
    }
    return num;
}

function validateCreatePayload(body) {
    const competitor_url = String(body.competitor_url || '').trim();
    if (!competitor_url) throw new Error('竞品库地址不能为空');
    if (!/^https?:\/\//i.test(competitor_url)) {
        throw new Error('竞品库地址须为有效的 http/https 链接');
    }

    const asin = String(body.asin || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
        throw new Error('ASIN 格式无效，须为 10 位字母数字');
    }

    return {
        competitor_url,
        asin,
        box_length: parsePositiveNumber(body.box_length, '箱规-长', { required: true }),
        box_width: parsePositiveNumber(body.box_width, '箱规-宽', { required: true }),
        box_height: parsePositiveNumber(body.box_height, '箱规-高', { required: true }),
        box_gross_weight: parsePositiveNumber(body.box_gross_weight, '毛重', { required: true }),
        box_quantity: parsePositiveNumber(body.box_quantity, '箱装数量', { required: true, integer: true }),
        purchase_price: parsePositiveNumber(body.purchase_price, '进货价', { required: true })
    };
}

async function createAnalysis(userId, body) {
    const input = validateCreatePayload(body);
    const result = await runSql(
        `INSERT INTO product_selection_analyses
         (user_id, competitor_url, asin, box_length, box_width, box_height, box_gross_weight, box_quantity, purchase_price, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
            userId || null,
            input.competitor_url,
            input.asin,
            input.box_length,
            input.box_width,
            input.box_height,
            input.box_gross_weight,
            input.box_quantity,
            input.purchase_price
        ]
    );

    const analysisId = result.insertId;
    dispatchProductSelectionAnalysis(analysisId);

    return getAnalysisById(analysisId);
}

async function getAnalysisById(id) {
    return queryOne(
        `SELECT a.*, u.name AS user_name
         FROM product_selection_analyses a
         LEFT JOIN users u ON a.user_id = u.id
         WHERE a.id = ?`,
        [id]
    );
}

async function listAnalyses({ page = 1, pageSize = 20 } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safePageSize;

    const totalRow = await queryOne('SELECT COUNT(*) AS cnt FROM product_selection_analyses');
    const total = totalRow ? Number(totalRow.cnt) : 0;

    const items = await queryAll(
        `SELECT a.id, a.competitor_url, a.asin, a.box_length, a.box_width, a.box_height,
                a.box_gross_weight, a.box_quantity, a.purchase_price, a.status,
                a.error_message, a.created_at, a.completed_at, u.name AS user_name
         FROM product_selection_analyses a
         LEFT JOIN users u ON a.user_id = u.id
         ORDER BY a.id DESC
         LIMIT ? OFFSET ?`,
        [safePageSize, offset]
    );

    return {
        items,
        total,
        page: safePage,
        pageSize: safePageSize,
        totalPages: Math.max(1, Math.ceil(total / safePageSize))
    };
}

module.exports = {
    createAnalysis,
    getAnalysisById,
    listAnalyses
};
