function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function getArrayJoinSeparator(prefix) {
    const key = String(prefix || '').split('.').pop();
    if (key === 'feature_bullets') return '\n';
    return '|';
}

function flattenForCsv(obj) {
    const out = {};

    function walk(value, prefix) {
        if (isScalar(value)) {
            out[prefix] = value;
            return;
        }
        if (Array.isArray(value)) {
            if (!value.length) {
                out[prefix] = '';
                return;
            }
            if (value.every(isScalar)) {
                out[prefix] = value.map(v => (v == null ? '' : String(v))).join(getArrayJoinSeparator(prefix));
                return;
            }
            out[prefix] = JSON.stringify(value);
            return;
        }
        if (isPlainObject(value)) {
            const keys = Object.keys(value);
            if (!keys.length) {
                out[prefix] = '';
                return;
            }
            for (const key of keys) {
                const next = prefix ? `${prefix}.${key}` : key;
                walk(value[key], next);
            }
        }
    }

    if (isPlainObject(obj)) {
        for (const key of Object.keys(obj)) {
            walk(obj[key], key);
        }
    }
    return out;
}

module.exports = { flattenForCsv };
