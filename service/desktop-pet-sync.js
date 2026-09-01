/**
 * 桌宠任务条目合并（本地 ↔ 远端）
 * 条目：{ id, time, content, createdAt, updatedAt }
 */

function toMillis(iso) {
    const t = Date.parse(String(iso || ''));
    return Number.isFinite(t) ? t : 0;
}

function normalizeEntry(raw = {}) {
    return {
        id: String(raw.id || raw.client_id || '').trim(),
        time: String(raw.time || '').trim(),
        content: String(raw.content || '').trim(),
        createdAt: String(raw.createdAt || raw.created_at || '').trim(),
        updatedAt: String(raw.updatedAt || raw.updated_at || '').trim()
    };
}

/**
 * 按 id 并集合并；两侧都有取 updatedAt 较新；相等保留 remote。
 * @param {Array} localEntries
 * @param {Array} remoteEntries
 * @returns {Array}
 */
function mergeTaskEntries(localEntries = [], remoteEntries = []) {
    const map = new Map();

    for (const raw of remoteEntries) {
        const entry = normalizeEntry(raw);
        if (!entry.id || !entry.content) continue;
        map.set(entry.id, entry);
    }

    for (const raw of localEntries) {
        const entry = normalizeEntry(raw);
        if (!entry.id || !entry.content) continue;
        const existing = map.get(entry.id);
        if (!existing) {
            map.set(entry.id, entry);
            continue;
        }
        if (toMillis(entry.updatedAt) > toMillis(existing.updatedAt)) {
            map.set(entry.id, entry);
        }
    }

    return [...map.values()].sort((left, right) => {
        const leftTime = left.time || '99:99';
        const rightTime = right.time || '99:99';
        if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
        return left.id.localeCompare(right.id);
    });
}

function rowToEntry(row) {
    return normalizeEntry({
        id: row.client_id,
        time: row.time,
        content: row.content,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    });
}

module.exports = {
    mergeTaskEntries,
    normalizeEntry,
    rowToEntry,
    toMillis
};
