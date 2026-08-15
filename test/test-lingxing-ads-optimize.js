const assert = require('assert');
const {
    adsReportWindow,
    formatReportDate,
    isSprintCampaignName,
    isEnabledCampaign,
    filterSprintCampaigns,
    isWorseRing,
    isHighConvert,
    trimAdPack,
    mapCampaignRow,
    resolveUs50ProfileId,
    fetchSprintAdPack
} = require('../service/lingxing-ads-optimize');

assert.deepStrictEqual(adsReportWindow('2026-08-10', '2026-08-14'), {
    start: '2026-08-10', end: '2026-08-13'
});
assert.deepStrictEqual(adsReportWindow('2026-08-10', '2026-08-20'), {
    start: '2026-08-10', end: '2026-08-16'
});
assert.deepStrictEqual(adsReportWindow('2026-08-10', '2026-08-10'), {
    start: '2026-08-10', end: '2026-08-10'
});
assert.strictEqual(formatReportDate('2026-08-10', '2026-08-16'), '2026-08-10 - 2026-08-16');

assert.strictEqual(isSprintCampaignName('B0XX-冲刺-自动', 'b0xx'), true);
assert.strictEqual(isSprintCampaignName('B0XX-维护', 'B0XX'), false);
assert.strictEqual(isEnabledCampaign({ state: 'enabled' }), true);
assert.strictEqual(isEnabledCampaign({ state: 'paused' }), false);

const mapped = mapCampaignRow({
    campaign_id: 'c1',
    campaign_name: 'B0XX-冲刺',
    state: 'enabled',
    spends: 12,
    sales: 40,
    orders: 2,
    acos: 0.3
});
assert.strictEqual(mapped.id, 'c1');
assert.strictEqual(mapped.name, 'B0XX-冲刺');
assert.strictEqual(mapped.spends, 12);
assert.ok(mapped.acos > 20);

const filtered = filterSprintCampaigns([
    { campaign_id: 'a', campaign_name: 'B0XX-冲刺', state: 'enabled', spends: 5 },
    { campaign_id: 'b', campaign_name: 'B0XX-冲刺', state: 'paused', spends: 99 },
    { campaign_id: 'c', campaign_name: 'B0XX-维护', state: 'enabled', spends: 80 }
], 'B0XX');
assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].id, 'a');

assert.strictEqual(isWorseRing({ acos_ring: 2 }), true);
assert.strictEqual(isWorseRing({ cvr_ring: -1 }), true);
assert.strictEqual(isWorseRing({ spends_ring: 3, sales_ring: -1 }), true);
assert.strictEqual(isWorseRing({ acos_ring: -1, cvr_ring: 1 }), false);
assert.strictEqual(isHighConvert({ orders: 3, acos: 12 }), true);
assert.strictEqual(isHighConvert({ orders: 0, acos: 5 }), false);

const trimmed = trimAdPack({
    campaigns: [
        { id: '1', name: 'A', spends: 100 },
        { id: '2', name: 'B', spends: 90 },
        { id: '3', name: 'C', spends: 80 },
        { id: '4', name: 'D', spends: 70 },
        { id: '5', name: 'E', spends: 60 },
        { id: '6', name: 'F', spends: 50 }
    ],
    keywords: [
        { id: 'k1', name: 'bad', spends: 10, acos_ring: 5, orders: 1, acos: 80 },
        { id: 'k2', name: 'good', spends: 8, orders: 4, acos: 10 }
    ],
    search_terms: [
        { id: 's1', name: 'q1', spends: 9, cvr_ring: -2 }
    ]
});
assert.strictEqual(trimmed.campaigns.length, 5);
assert.ok(trimmed.keywords.some((k) => k.name === 'bad'));
assert.ok(trimmed.keywords.some((k) => k.name === 'good'));
assert.ok(trimmed.search_terms.some((s) => s.name === 'q1'));

assert.strictEqual(resolveUs50ProfileId({
    list: [{ sid: '17438', profile_id: 99, country: 'US', name: '50宴君' }]
}), 99);
assert.strictEqual(resolveUs50ProfileId({ list: [] }), null);

(async () => {
    const calls = [];
    const callTool = async (name, args) => {
        calls.push({ name, args });
        if (name === 'lingxing_ad_auth_shops') {
            return { list: [{ sid: '17438', profile_id: 77, country: 'US' }] };
        }
        if (name === 'lingxing_ad_campaign_report') {
            return { list: [
                { campaign_id: 'c1', campaign_name: 'B0XX-冲刺-自动', state: 'enabled', spends: 20 },
                { campaign_id: 'c2', campaign_name: 'B0XX-维护', state: 'enabled', spends: 99 }
            ] };
        }
        if (name === 'lingxing_ad_campaign_keyword_report') {
            return { list: [{ keyword_id: 'k1', keyword_text: 'gloves', spends: 5, orders: 2, acos: 15 }] };
        }
        if (name === 'lingxing_ad_campaign_search_term_report') {
            return { list: [{ query: 'work gloves', spends: 4, cvr_ring: -1 }] };
        }
        throw new Error('unexpected ' + name);
    };
    const pack = await fetchSprintAdPack({
        asin: 'B0XX',
        weekStartYmd: '2026-08-10',
        todayYmd: '2026-08-14',
        callTool
    });
    assert.strictEqual(pack.profileId, 77);
    assert.strictEqual(pack.ads.campaigns.length, 1);
    assert.strictEqual(pack.ads.campaigns[0].name.includes('冲刺'), true);
    assert.ok(calls.some((c) => c.name === 'lingxing_ad_campaign_keyword_report'));
    assert.deepStrictEqual(calls.find((c) => c.name === 'lingxing_ad_campaign_report').args.asin, 'B0XX');
    const stCall = calls.find((c) => c.name === 'lingxing_ad_campaign_search_term_report');
    assert.ok(stCall);
    assert.strictEqual(typeof stCall.args.campaign_id, 'string');
    assert.strictEqual(stCall.args.campaign_id, 'c1');
    assert.ok(Array.isArray(calls.find((c) => c.name === 'lingxing_ad_campaign_keyword_report').args.campaign_id));

    const emptyTool = async (name) => {
        if (name === 'lingxing_ad_auth_shops') return { list: [{ sid: '17438', profile_id: 77 }] };
        if (name === 'lingxing_ad_campaign_report') return { list: [] };
        throw new Error('should not fetch terms');
    };
    const empty = await fetchSprintAdPack({
        asin: 'B0XX', weekStartYmd: '2026-08-10', todayYmd: '2026-08-14', callTool: emptyTool
    });
    assert.deepStrictEqual(empty.ads.campaigns, []);

    let noProfileErr = null;
    try {
        await fetchSprintAdPack({
            asin: 'B0XX',
            weekStartYmd: '2026-08-10',
            todayYmd: '2026-08-14',
            callTool: async () => ({ list: [] })
        });
    } catch (e) {
        noProfileErr = e;
    }
    assert.ok(noProfileErr);
    assert.strictEqual(noProfileErr.status, 400);
    assert.strictEqual(noProfileErr.message, '未找到50宴君北美广告店铺');

    console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
