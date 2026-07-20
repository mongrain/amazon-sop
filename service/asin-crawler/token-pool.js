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

async function addTokens({ tokensText, label }) {
    const list = parseTokenInput(tokensText);
    if (!list.length) throw new Error('token 不能为空');
    const sharedLabel = label ? String(label).trim() : null;
    const added = [];
    for (const text of list) {
        const result = await runSql(
            `INSERT INTO searchapi_tokens (token, label, status) VALUES (?, ?, 'active')`,
            [text, sharedLabel]
        );
        const row = await queryOne('SELECT * FROM searchapi_tokens WHERE id = ?', [result.insertId]);
        added.push(mapTokenRow(row));
    }
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
    listTokens,
    addToken,
    addTokens,
    disableToken,
    resetToken,
    countActiveTokens,
    acquireToken,
    markTokenExhausted,
    recordTokenFailure,
    touchTokenUsed
};
