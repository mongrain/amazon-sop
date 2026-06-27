const { queryAll, queryOne, runSql } = require('../database');

const FIELD_TYPES = ['string', 'number', 'date', 'timestamp', 'boolean'];
const AGG_THRESHOLDS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
const METRIC_TYPES = new Set(['number']);

function normalizeFieldType(type) {
    const t = String(type || 'string').trim().toLowerCase();
    return FIELD_TYPES.includes(t) ? t : 'string';
}

function normalizeAggThreshold(value) {
    const t = String(value || 'NONE').trim().toUpperCase();
    return AGG_THRESHOLDS.includes(t) ? t : 'NONE';
}

function isMetricField(field) {
    return METRIC_TYPES.has(normalizeFieldType(field.field_type));
}

async function listSchemas() {
    const rows = await queryAll(
        `SELECT s.id, s.name, s.translation, s.description, s.created_at, s.updated_at,
                COUNT(f.id) AS field_count
         FROM amc_schemas s
         LEFT JOIN amc_schema_fields f ON f.schema_id = s.id
         GROUP BY s.id
         ORDER BY s.updated_at DESC, s.id DESC`
    );
    return rows;
}

async function getSchemaById(id) {
    const schema = await queryOne('SELECT * FROM amc_schemas WHERE id = ?', [id]);
    if (!schema) return null;
    const fields = await queryAll(
        'SELECT * FROM amc_schema_fields WHERE schema_id = ? ORDER BY sort_order ASC, id ASC',
        [id]
    );
    return { ...schema, fields };
}

async function createSchema({ name, translation, description }) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) throw new Error('表名不能为空');
    const result = await runSql(
        'INSERT INTO amc_schemas (name, translation, description) VALUES (?, ?, ?)',
        [trimmedName, String(translation || '').trim(), String(description || '').trim() || null]
    );
    return getSchemaById(result.insertId);
}

async function updateSchema(id, { name, translation, description }) {
    const existing = await queryOne('SELECT id FROM amc_schemas WHERE id = ?', [id]);
    if (!existing) throw new Error('Schema 不存在');
    const trimmedName = String(name || '').trim();
    if (!trimmedName) throw new Error('表名不能为空');
    await runSql(
        'UPDATE amc_schemas SET name = ?, translation = ?, description = ?, updated_at = NOW() WHERE id = ?',
        [trimmedName, String(translation || '').trim(), String(description || '').trim() || null, id]
    );
    return getSchemaById(id);
}

async function deleteSchema(id) {
    const existing = await queryOne('SELECT id FROM amc_schemas WHERE id = ?', [id]);
    if (!existing) throw new Error('Schema 不存在');
    await runSql('DELETE FROM amc_schemas WHERE id = ?', [id]);
}

async function createField(schemaId, payload) {
    const schema = await queryOne('SELECT id FROM amc_schemas WHERE id = ?', [schemaId]);
    if (!schema) throw new Error('Schema 不存在');
    const amazonField = String(payload.amazon_field || '').trim();
    if (!amazonField) throw new Error('亚马逊字段不能为空');
    const sortRow = await queryOne(
        'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM amc_schema_fields WHERE schema_id = ?',
        [schemaId]
    );
    const sortOrder = Number(sortRow && sortRow.max_sort) + 1;
    const result = await runSql(
        `INSERT INTO amc_schema_fields
         (schema_id, amazon_field, translation, field_type, description, agg_threshold, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            schemaId,
            amazonField,
            String(payload.translation || '').trim(),
            normalizeFieldType(payload.field_type),
            String(payload.description || '').trim() || null,
            normalizeAggThreshold(payload.agg_threshold),
            sortOrder
        ]
    );
    await runSql('UPDATE amc_schemas SET updated_at = NOW() WHERE id = ?', [schemaId]);
    return queryOne('SELECT * FROM amc_schema_fields WHERE id = ?', [result.insertId]);
}

async function updateField(fieldId, payload) {
    const existing = await queryOne('SELECT * FROM amc_schema_fields WHERE id = ?', [fieldId]);
    if (!existing) throw new Error('字段不存在');
    const amazonField = String(payload.amazon_field || '').trim();
    if (!amazonField) throw new Error('亚马逊字段不能为空');
    await runSql(
        `UPDATE amc_schema_fields
         SET amazon_field = ?, translation = ?, field_type = ?, description = ?,
             agg_threshold = ?, updated_at = NOW()
         WHERE id = ?`,
        [
            amazonField,
            String(payload.translation || '').trim(),
            normalizeFieldType(payload.field_type),
            String(payload.description || '').trim() || null,
            normalizeAggThreshold(payload.agg_threshold),
            fieldId
        ]
    );
    await runSql('UPDATE amc_schemas SET updated_at = NOW() WHERE id = ?', [existing.schema_id]);
    return queryOne('SELECT * FROM amc_schema_fields WHERE id = ?', [fieldId]);
}

async function deleteField(fieldId) {
    const existing = await queryOne('SELECT * FROM amc_schema_fields WHERE id = ?', [fieldId]);
    if (!existing) throw new Error('字段不存在');
    await runSql('DELETE FROM amc_schema_fields WHERE id = ?', [fieldId]);
    await runSql('UPDATE amc_schemas SET updated_at = NOW() WHERE id = ?', [existing.schema_id]);
}

function generateAmcSql({ schema, fields, selectedFieldIds, whereClause, dateField, dateFrom, dateTo }) {
    if (!schema || !schema.name) throw new Error('Schema 无效');
    const idSet = new Set((selectedFieldIds || []).map(Number));
    const selected = fields.filter(f => idSet.has(Number(f.id)));
    if (!selected.length) throw new Error('请至少选择一个字段');

    const dimensions = selected.filter(f => !isMetricField(f));
    const metrics = selected.filter(f => isMetricField(f));

    const selectParts = [];
    dimensions.forEach(f => {
        selectParts.push(f.amazon_field);
    });
    metrics.forEach(f => {
        selectParts.push(`SUM(${f.amazon_field}) AS ${f.amazon_field}`);
    });

    let sql = `SELECT\n  ${selectParts.join(',\n  ')}\nFROM ${schema.name}`;

    const whereParts = [];
    if (dateField && dateFrom) whereParts.push(`${dateField} >= '${dateFrom}'`);
    if (dateField && dateTo) whereParts.push(`${dateField} <= '${dateTo}'`);
    const customWhere = String(whereClause || '').trim();
    if (customWhere) whereParts.push(customWhere);
    if (whereParts.length) {
        sql += `\nWHERE ${whereParts.join('\n  AND ')}`;
    }

    if (dimensions.length) {
        sql += `\nGROUP BY ${dimensions.map(f => f.amazon_field).join(', ')}`;
    }

    return sql;
}

async function generateSqlFromRequest(body) {
    const schemaId = Number(body.schema_id);
    if (!schemaId) throw new Error('请选择 Schema 表');
    const schemaData = await getSchemaById(schemaId);
    if (!schemaData) throw new Error('Schema 不存在');

    const sql = generateAmcSql({
        schema: schemaData,
        fields: schemaData.fields || [],
        selectedFieldIds: body.selected_field_ids || [],
        whereClause: body.where_clause,
        dateField: body.date_field,
        dateFrom: body.date_from,
        dateTo: body.date_to
    });

    return { sql, schema: schemaData };
}

async function listSqlScripts({ page = 1, pageSize = 20 } = {}) {
    const offset = (page - 1) * pageSize;
    const totalRow = await queryOne(
        'SELECT COUNT(DISTINCT group_id) AS cnt FROM amc_sql_scripts'
    );
    const total = Number(totalRow && totalRow.cnt) || 0;
    const items = await queryAll(
        `SELECT s.*, u.name AS creator_name
         FROM amc_sql_scripts s
         JOIN (
             SELECT group_id, MAX(version) AS max_version
             FROM amc_sql_scripts
             GROUP BY group_id
         ) latest ON s.group_id = latest.group_id AND s.version = latest.max_version
         LEFT JOIN users u ON s.created_by = u.id
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [pageSize, offset]
    );
    return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function listSqlVersions(groupId) {
    const versions = await queryAll(
        `SELECT s.*, u.name AS creator_name
         FROM amc_sql_scripts s
         LEFT JOIN users u ON s.created_by = u.id
         WHERE s.group_id = ?
         ORDER BY s.version DESC`,
        [groupId]
    );
    return versions;
}

async function getSqlScriptById(id) {
    return queryOne(
        `SELECT s.*, u.name AS creator_name
         FROM amc_sql_scripts s
         LEFT JOIN users u ON s.created_by = u.id
         WHERE s.id = ?`,
        [id]
    );
}

async function saveSqlScript(userId, body) {
    const name = String(body.name || '').trim();
    const sqlContent = String(body.sql_content || '').trim();
    if (!name) throw new Error('脚本名称不能为空');
    if (!sqlContent) throw new Error('SQL 内容不能为空');

    const schemaId = body.schema_id ? Number(body.schema_id) : null;
    const selectedFields = body.selected_field_ids ? JSON.stringify(body.selected_field_ids) : null;
    const note = String(body.note || '').trim() || null;
    const groupId = body.group_id ? Number(body.group_id) : null;

    if (groupId) {
        const existing = await queryOne(
            'SELECT group_id FROM amc_sql_scripts WHERE group_id = ? LIMIT 1',
            [groupId]
        );
        if (!existing) throw new Error('脚本组不存在');
        const maxRow = await queryOne(
            'SELECT COALESCE(MAX(version), 0) AS max_version FROM amc_sql_scripts WHERE group_id = ?',
            [groupId]
        );
        const nextVersion = Number(maxRow && maxRow.max_version) + 1;
        const result = await runSql(
            `INSERT INTO amc_sql_scripts
             (group_id, version, name, sql_content, schema_id, selected_fields, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [groupId, nextVersion, name, sqlContent, schemaId, selectedFields, note, userId || null]
        );
        return getSqlScriptById(result.insertId);
    }

    const result = await runSql(
        `INSERT INTO amc_sql_scripts
         (group_id, version, name, sql_content, schema_id, selected_fields, note, created_by)
         VALUES (0, 1, ?, ?, ?, ?, ?, ?)`,
        [name, sqlContent, schemaId, selectedFields, note, userId || null]
    );
    const newId = result.insertId;
    await runSql('UPDATE amc_sql_scripts SET group_id = ? WHERE id = ?', [newId, newId]);
    return getSqlScriptById(newId);
}

async function deleteSqlVersion(id) {
    const row = await queryOne('SELECT * FROM amc_sql_scripts WHERE id = ?', [id]);
    if (!row) throw new Error('版本不存在');
    const countRow = await queryOne(
        'SELECT COUNT(*) AS cnt FROM amc_sql_scripts WHERE group_id = ?',
        [row.group_id]
    );
    if (Number(countRow && countRow.cnt) <= 1) {
        await runSql('DELETE FROM amc_sql_scripts WHERE group_id = ?', [row.group_id]);
        return;
    }
    await runSql('DELETE FROM amc_sql_scripts WHERE id = ?', [id]);
}

module.exports = {
    FIELD_TYPES,
    AGG_THRESHOLDS,
    listSchemas,
    getSchemaById,
    createSchema,
    updateSchema,
    deleteSchema,
    createField,
    updateField,
    deleteField,
    generateSqlFromRequest,
    listSqlScripts,
    listSqlVersions,
    getSqlScriptById,
    saveSqlScript,
    deleteSqlVersion
};
