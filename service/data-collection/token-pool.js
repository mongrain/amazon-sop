const { queryAll, queryOne, runSql } = require('../../database');

function maskToken(token) {
    const text = String(token || '').trim();
    if (text.length <= 8) return '****';
    return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function mapTokenRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        token_masked: maskToken(row.token),
        label: row.label || '',
        status: row.status,
        success_count: Number(row.success_count || 0),
        fail_count: row.fail_count,
        last_used_at: row.last_used_at,
        last_error: row.last_error,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function listTokens() {
    const rows = await queryAll(
        'SELECT * FROM searchapi_tokens ORDER BY id DESC'
    );
    return rows.map(mapTokenRow);
}

function parseTokenInput(text) {
    const lines = String(text || '').split(/\r?\n/);
    const tokens = [];
    const seen = new Set();
    for (const line of lines) {
        const value = line.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        tokens.push(value);
    }
    return tokens;
}

function splitNewAndDuplicateTokens(list, existingTokens) {
    const existing = new Set(existingTokens || []);
    const fresh = [];
    const duplicates = [];
    for (const token of list) {
        if (existing.has(token)) {
            duplicates.push(token);
            continue;
        }
        existing.add(token);
        fresh.push(token);
    }
    return { fresh, duplicates };
}

async function addTokens({ tokensText, label }) {
    const list = parseTokenInput(tokensText);
    if (!list.length) throw new Error('token 不能为空');
    const placeholders = list.map(() => '?').join(', ');
    const existingRows = await queryAll(
        `SELECT token FROM searchapi_tokens WHERE token IN (${placeholders})`,
        list
    );
    const { fresh } = splitNewAndDuplicateTokens(list, existingRows.map(row => row.token));
    if (!fresh.length) throw new Error('token 已存在，禁止重复录入');
    const sharedLabel = label ? String(label).trim() : null;
    const added = [];
    for (const text of fresh) {
        let result;
        try {
            result = await runSql(
                `INSERT INTO searchapi_tokens (token, label, status) VALUES (?, ?, 'active')`,
                [text, sharedLabel]
            );
        } catch (error) {
            if (String(error.message || '').includes('Duplicate')) {
                continue;
            }
            throw error;
        }
        const row = await queryOne('SELECT * FROM searchapi_tokens WHERE id = ?', [result.insertId]);
        added.push(mapTokenRow(row));
    }
    if (!added.length) throw new Error('token 已存在，禁止重复录入');
    return added;
}

async function addToken({ token, tokens, label }) {
    const tokensText = tokens != null ? tokens : token;
    const added = await addTokens({ tokensText, label });
    return added.length === 1 ? added[0] : added;
}

async function disableToken(id) {
    const result = await runSql(
        `UPDATE searchapi_tokens SET status = 'disabled', updated_at = NOW() WHERE id = ?`,
        [Number(id)]
    );
    return Boolean(result.affectedRows);
}

async function resetToken(id) {
    const result = await runSql(
        `UPDATE searchapi_tokens
         SET status = 'active', fail_count = 0, last_error = NULL, updated_at = NOW()
         WHERE id = ?`,
        [Number(id)]
    );
    return Boolean(result.affectedRows);
}

async function countActiveTokens() {
    const row = await queryOne(
        `SELECT COUNT(*) AS cnt FROM searchapi_tokens WHERE status = 'active'`
    );
    return Number(row?.cnt || 0);
}

async function acquireToken() {
    const row = await queryOne(
        `SELECT id, token FROM searchapi_tokens
         WHERE status = 'active'
         ORDER BY (last_used_at IS NULL) DESC, last_used_at ASC, id ASC
         LIMIT 1`
    );
    return row ? { id: row.id, token: row.token } : null;
}

async function touchTokenUsed(id) {
    await runSql(
        `UPDATE searchapi_tokens SET last_used_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [Number(id)]
    );
}

async function markTokenExhausted(id, error) {
    const message = String(error || '').slice(0, 500);
    await runSql(
        `UPDATE searchapi_tokens
         SET status = 'exhausted', last_error = ?, updated_at = NOW()
         WHERE id = ?`,
        [message, Number(id)]
    );
}

async function recordTokenSuccess(id) {
    await runSql(
        `UPDATE searchapi_tokens
         SET success_count = success_count + 1, updated_at = NOW()
         WHERE id = ?`,
        [Number(id)]
    );
}

async function recordTokenFailure(id, error) {
    const message = String(error || '').slice(0, 500);
    await runSql(
        `UPDATE searchapi_tokens
         SET fail_count = fail_count + 1,
             last_error = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [message, Number(id)]
    );
    const row = await queryOne('SELECT fail_count FROM searchapi_tokens WHERE id = ?', [Number(id)]);
    if (Number(row?.fail_count || 0) >= 3) {
        await markTokenExhausted(id, message);
    }
}

module.exports = {
    maskToken,
    parseTokenInput,
    splitNewAndDuplicateTokens,
    mapTokenRow,
    listTokens,
    addToken,
    addTokens,
    disableToken,
    resetToken,
    countActiveTokens,
    acquireToken,
    markTokenExhausted,
    recordTokenSuccess,
    recordTokenFailure,
    touchTokenUsed
};
