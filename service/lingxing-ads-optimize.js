const { pickNumeric, toFormPercent, extractPerformanceList } = require('./lingxing-metrics');

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

function adsReportWindow(weekStartYmd, todayYmd) {
    const start = String(weekStartYmd || '').trim();
    const sunday = shiftYmd(start, 6);
    const yesterday = shiftYmd(String(todayYmd || '').trim(), -1);
    let end = sunday && yesterday
        ? (sunday <= yesterday ? sunday : yesterday)
        : (sunday || yesterday || start);
    if (end < start) end = start;
    return { start, end };
}

function formatReportDate(start, end) {
    return `${start} - ${end}`;
}

function isSprintCampaignName(name, asin) {
    const n = String(name || '').toUpperCase();
    const a = String(asin || '').toUpperCase().trim();
    if (!n || !a) return false;
    return n.includes(`${a}-冲刺`);
}

function isEnabledCampaign(row) {
    const raw = pickText(row, ['state', 'campaign_state']);
    if (!raw) return false;
    return String(raw).trim().toLowerCase() === 'enabled';
}

function pickText(row, keys) {
    if (!row || typeof row !== 'object') return null;
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        const raw = row[key];
        if (raw === null || raw === undefined) continue;
        const s = String(raw).trim();
        if (s === '') continue;
        return s;
    }
    return null;
}

function normalizeRate(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) > 1) return n;
    return toFormPercent(n);
}

function mapMetricFields(row) {
    const spends = pickNumeric(row, ['spends', 'spend', 'cost']);
    const sales = pickNumeric(row, ['sales', 'sale', 'sales_amount']);
    const orders = pickNumeric(row, ['orders', 'order_num', 'order_count']);
    const acos = normalizeRate(pickNumeric(row, ['acos', 'aco']));
    const cvr = normalizeRate(pickNumeric(row, ['cvr', 'conversion_rate']));
    const ctr = normalizeRate(pickNumeric(row, ['ctr', 'click_rate']));
    const acos_ring = pickNumeric(row, ['acos_ring', 'ring_acos', 'acos_wow']);
    const cvr_ring = pickNumeric(row, ['cvr_ring', 'ring_cvr', 'cvr_wow']);
    const orders_ring = pickNumeric(row, ['orders_ring', 'ring_orders', 'orders_wow']);
    const spends_ring = pickNumeric(row, ['spends_ring', 'ring_spends', 'spends_wow']);
    const sales_ring = pickNumeric(row, ['sales_ring', 'ring_sales', 'sales_wow']);
    return {
        spends,
        sales,
        orders,
        acos,
        cvr,
        ctr,
        acos_ring,
        cvr_ring,
        orders_ring,
        spends_ring,
        sales_ring
    };
}

function mapCampaignRow(row) {
    const metrics = mapMetricFields(row);
    return {
        id: pickText(row, ['campaign_id', 'id']),
        name: pickText(row, ['campaign_name', 'name']),
        match_type: pickText(row, ['match_type', 'matchType']),
        ...metrics
    };
}

function mapKeywordRow(row) {
    const metrics = mapMetricFields(row);
    return {
        id: pickText(row, ['keyword_id', 'id']),
        name: pickText(row, ['keyword_text', 'keyword', 'name']),
        campaign_name: pickText(row, ['campaign_name']),
        match_type: pickText(row, ['match_type', 'matchType']),
        ...metrics
    };
}

function mapSearchTermRow(row) {
    const metrics = mapMetricFields(row);
    return {
        id: pickText(row, ['search_term_id', 'id']),
        name: pickText(row, ['query', 'search_term', 'search_term_text', 'name']),
        campaign_name: pickText(row, ['campaign_name']),
        match_type: pickText(row, ['match_type', 'matchType']),
        ...metrics
    };
}

function filterSprintCampaigns(rows, asin) {
    return (rows || [])
        .filter((row) => isEnabledCampaign(row) && isSprintCampaignName(
            pickText(row, ['campaign_name', 'name']),
            asin
        ))
        .map(mapCampaignRow)
        .sort((a, b) => (Number(b.spends) || 0) - (Number(a.spends) || 0))
        .slice(0, 8);
}

function isWorseRing(row) {
    const acosRing = pickNumeric(row, ['acos_ring', 'ring_acos', 'acos_wow']);
    const cvrRing = pickNumeric(row, ['cvr_ring', 'ring_cvr', 'cvr_wow']);
    const ordersRing = pickNumeric(row, ['orders_ring', 'ring_orders', 'orders_wow']);
    const spendsRing = pickNumeric(row, ['spends_ring', 'ring_spends', 'spends_wow']);
    const salesRing = pickNumeric(row, ['sales_ring', 'ring_sales', 'sales_wow']);
    if (acosRing != null && acosRing > 0) return true;
    if (cvrRing != null && cvrRing < 0) return true;
    if (ordersRing != null && ordersRing < 0) return true;
    if (spendsRing != null && spendsRing > 0 && salesRing != null && salesRing < 0) return true;
    return false;
}

function isHighConvert(row) {
    const orders = pickNumeric(row, ['orders']);
    if (orders == null || !(orders > 0)) return false;
    const acos = pickNumeric(row, ['acos']);
    const cvr = pickNumeric(row, ['cvr']);
    if (acos != null && acos < 30) return true;
    if (cvr != null && cvr > 10) return true;
    return false;
}

function rowKey(row) {
    const id = row && row.id != null ? String(row.id).trim() : '';
    if (id) return `id:${id}`;
    const name = row && row.name != null ? String(row.name).trim() : '';
    if (name) return `name:${name}`;
    return null;
}

function takeBySpend(items, limit, seen) {
    const out = [];
    const sorted = [...(items || [])].sort(
        (a, b) => (Number(b.spends) || 0) - (Number(a.spends) || 0)
    );
    for (const item of sorted) {
        const key = rowKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= limit) break;
    }
    return out;
}

function takeByPred(items, pred, limit, seen) {
    const out = [];
    for (const item of items || []) {
        if (!pred(item)) continue;
        const key = rowKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= limit) break;
    }
    return out;
}

function trimAdPack({ campaigns, keywords, search_terms } = {}) {
    const campSeen = new Set();
    const trimmedCampaigns = takeBySpend(campaigns, 5, campSeen);

    const kwSeen = new Set();
    const trimmedKeywords = [
        ...takeBySpend(keywords, 8, kwSeen),
        ...takeByPred(keywords, isWorseRing, 8, kwSeen),
        ...takeByPred(keywords, isHighConvert, 5, kwSeen)
    ];

    const stSeen = new Set();
    const trimmedSearchTerms = [
        ...takeBySpend(search_terms, 8, stSeen),
        ...takeByPred(search_terms, isWorseRing, 8, stSeen),
        ...takeByPred(search_terms, isHighConvert, 5, stSeen)
    ];

    return {
        campaigns: trimmedCampaigns,
        keywords: trimmedKeywords,
        search_terms: trimmedSearchTerms
    };
}

function shopListFromPayload(payload) {
    const fromPerf = extractPerformanceList(payload);
    if (fromPerf.length) return fromPerf;
    const candidates = [
        payload && payload.data,
        payload && payload.list,
        payload && payload.shops
    ];
    for (const list of candidates) {
        if (Array.isArray(list)) return list;
    }
    if (payload && payload.data && typeof payload.data === 'object') {
        const nested = payload.data.list || payload.data.shops;
        if (Array.isArray(nested)) return nested;
    }
    return [];
}

function resolveUs50ProfileId(payload, sid = '17438') {
    const targetSid = String(sid);
    const list = shopListFromPayload(payload);
    for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        const rowSid = pickText(row, ['sid', 'store_id', 'seller_id']);
        const name = pickText(row, ['name', 'shop_name', 'store_name']) || '';
        const country = String(pickText(row, ['country', 'marketplace', 'country_code']) || '')
            .trim()
            .toUpperCase();
        const sidMatch = rowSid != null && String(rowSid) === targetSid;
        const nameUsMatch = name.includes('50') && (country === 'US' || country === 'USA');
        if (!sidMatch && !nameUsMatch) continue;
        const profileRaw = row.profile_id != null ? row.profile_id : row.profileId;
        const profileId = Number(profileRaw);
        if (Number.isFinite(profileId)) return profileId;
    }
    return null;
}

function emptyAds() {
    return { campaigns: [], keywords: [], search_terms: [] };
}

async function fetchSprintAdPack({ asin, weekStartYmd, todayYmd, callTool }) {
    const tool = callTool || require('./yanjun-mcp').callYanjunTool;
    const shopsPayload = await tool('lingxing_ad_auth_shops', {});
    const profileId = resolveUs50ProfileId(shopsPayload);
    if (profileId == null) {
        const err = new Error('未找到50宴君北美广告店铺');
        err.status = 400;
        throw err;
    }

    const win = adsReportWindow(weekStartYmd, todayYmd);
    const report_date = formatReportDate(win.start, win.end);
    const commonArgs = {
        report_date,
        profile_ids: [profileId],
        page: 1,
        length: 50,
        sort_field: 'spends',
        sort_type: 'desc'
    };

    const campaignPayload = await tool('lingxing_ad_campaign_report', {
        ...commonArgs,
        asin,
        state: 'enabled'
    });
    const campaigns = filterSprintCampaigns(extractPerformanceList(campaignPayload), asin);
    if (!campaigns.length) {
        return { ads: emptyAds(), profileId };
    }

    const campaign_id = campaigns.map((c) => c.id).filter(Boolean);
    const keywordPayload = await tool('lingxing_ad_campaign_keyword_report', {
        ...commonArgs,
        campaign_id,
        with_ring: 1
    });
    const searchTermPayload = await tool('lingxing_ad_campaign_search_term_report', {
        ...commonArgs,
        campaign_id,
        asin,
        with_ring: true
    });

    const keywords = extractPerformanceList(keywordPayload).map(mapKeywordRow);
    const search_terms = extractPerformanceList(searchTermPayload).map(mapSearchTermRow);
    return {
        ads: trimAdPack({ campaigns, keywords, search_terms }),
        profileId
    };
}

module.exports = {
    adsReportWindow,
    formatReportDate,
    isSprintCampaignName,
    isEnabledCampaign,
    pickText,
    mapCampaignRow,
    mapKeywordRow,
    mapSearchTermRow,
    filterSprintCampaigns,
    isWorseRing,
    isHighConvert,
    trimAdPack,
    resolveUs50ProfileId,
    fetchSprintAdPack
};
