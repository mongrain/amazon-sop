const METRIC_KEYS = [
    'sessions', 'orders', 'impressions', 'clicks',
    'ad_spend', 'ad_sales', 'total_sales', 'ad_orders', 'bsr_rank'
];

const PERF_FIELD_MAP = {
    sessions: ['sessions', 'session', 'visits', 'session_count'],
    orders: ['order_items', 'order_num', 'orders', 'volume', 'order_count'],
    impressions: ['impressions', 'ad_impressions'],
    clicks: ['clicks', 'ad_clicks'],
    ad_spend: ['spend', 'ad_cost', 'ad_spend', 'ads_sp_cost'],
    ad_sales: ['ad_sales_amount', 'ad_sales', 'ad_sale_amount'],
    total_sales: ['amount', 'sales_amount', 'sales', 'total_sales'],
    ad_orders: ['ad_order_quantity', 'ad_order_num', 'ad_orders', 'ad_order_count'],
    bsr_rank: ['small_cate_rank', 'cate_rank', 'bsr_rank']
};

function pickNumeric(row, keys) {
    if (!row || typeof row !== 'object') return null;
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        const raw = row[key];
        if (raw === '' || raw === null || raw === undefined) continue;
        if (typeof raw === 'string' && raw.trim() === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function mapPerformanceRow(row) {
    const asin = String((row && row.asin) || '').trim();
    const mapped = { asin };
    for (const metric of METRIC_KEYS) {
        mapped[metric] = pickNumeric(row, PERF_FIELD_MAP[metric]);
    }
    return mapped;
}

function normalizeAsin(asin) {
    return String(asin || '').trim().toUpperCase();
}

function asinsToPrefill(sprintAsins, existingAsins) {
    const existing = new Set((existingAsins || []).map(normalizeAsin).filter(Boolean));
    return (sprintAsins || []).filter((asin) => {
        const key = normalizeAsin(asin);
        return key && !existing.has(key);
    });
}

function rowHasAnyMetric(row) {
    return METRIC_KEYS.some((key) => {
        const n = Number(row && row[key]);
        return row && row[key] !== '' && row[key] !== null && row[key] !== undefined
            && String(row[key]).trim() !== '' && Number.isFinite(n);
    });
}

function mergePrefillIntoRows(rows, prefillRows) {
    const byAsin = new Map();
    for (const item of prefillRows || []) {
        const key = normalizeAsin(item && item.asin);
        if (key) byAsin.set(key, item);
    }
    return (rows || []).map((row) => {
        if (rowHasAnyMetric(row)) return row;
        const prefill = byAsin.get(normalizeAsin(row && row.asin));
        if (!prefill) return row;
        const next = { ...row };
        for (const key of METRIC_KEYS) {
            if (prefill[key] != null && Number.isFinite(Number(prefill[key]))) {
                next[key] = prefill[key];
            }
        }
        return next;
    });
}

function shiftYmd(ymd, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function last7CompleteDays(todayYmd) {
    const end_date = shiftYmd(todayYmd, -1);
    const start_date = shiftYmd(end_date, -6);
    return { start_date, end_date };
}

function isEmptyField(v) {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function fillEmptySprintFields(form, lookup) {
    const next = { ...(form || {}) };
    const src = lookup || {};
    for (const key of ['fba_warehouse_qty', 'ctr_7d', 'cvr_7d', 'current_daily_orders']) {
        if (isEmptyField(next[key]) && src[key] != null && Number.isFinite(Number(src[key]))) {
            next[key] = src[key];
        }
    }
    if (isEmptyField(next.current_rank) && src.current_rank) {
        next.current_rank = src.current_rank;
    }
    return next;
}

function toFormPercent(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) > 1) return n;
    return Math.round(n * 100 * 10000) / 10000;
}

function sumFbaQty(items) {
    let total = 0;
    let found = false;
    for (const item of items || []) {
        const n = pickNumeric(item, ['afn_fulfillable_quantity', 'fulfillable_quantity', 'quantity']);
        if (n == null) continue;
        total += n;
        found = true;
    }
    return found ? total : null;
}

function extractPerformanceList(payload) {
    const candidates = [
        payload && payload.data && payload.data.data && payload.data.data.list,
        payload && payload.data && payload.data.list,
        payload && payload.list
    ];
    for (const list of candidates) {
        if (Array.isArray(list)) return list;
    }
    return [];
}

function pickFbaOnSaleQty(row) {
    const nested = row && row.available_inventory && typeof row.available_inventory === 'object'
        ? pickNumeric(row.available_inventory, ['total_fulfillable', 'afn_fulfillable_quantity'])
        : null;
    if (nested != null) return nested;
    return pickNumeric(row, ['total_fulfillable', 'afn_fulfillable_quantity', 'fulfillable_quantity']);
}

function formatCurrentRank(row) {
    const small = pickNumeric(row, ['small_cate_rank']);
    const big = pickNumeric(row, ['cate_rank']);
    const parts = [];
    if (small != null) parts.push(`小类排名${small}名`);
    if (big != null) parts.push(`大类排名${big}名`);
    return parts.length ? parts.join(', ') : null;
}

function lookupFromPerformanceRow(row) {
    if (!row) {
        return {
            fba_warehouse_qty: null,
            ctr_7d: null,
            cvr_7d: null,
            current_daily_orders: null,
            current_rank: null
        };
    }
    const avg7 = pickNumeric(row, ['volume_avg_7d', 'avg_volume']);
    return {
        fba_warehouse_qty: pickFbaOnSaleQty(row),
        ctr_7d: toFormPercent(pickNumeric(row, ['ctr'])),
        cvr_7d: toFormPercent(pickNumeric(row, ['cvr'])),
        current_daily_orders: avg7 == null ? null : Math.round(avg7 * 100) / 100,
        current_rank: formatCurrentRank(row)
    };
}

module.exports = {
    METRIC_KEYS,
    pickNumeric,
    mapPerformanceRow,
    asinsToPrefill,
    rowHasAnyMetric,
    mergePrefillIntoRows,
    last7CompleteDays,
    isEmptyField,
    fillEmptySprintFields,
    toFormPercent,
    sumFbaQty,
    extractPerformanceList,
    lookupFromPerformanceRow,
    formatCurrentRank
};
