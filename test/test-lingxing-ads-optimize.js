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
    resolveUs50ProfileId
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

console.log('ok');
