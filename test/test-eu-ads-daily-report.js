const assert = require('assert');
const {
    completeDayWindow,
    normalizeCountryCode,
    listEuAdShops,
    metricLabel,
    EU_COUNTRY_ORDER,
    buildReportMatrix,
    rowKey,
    buildSuggestions,
    fetchEuAdsDailyReport
} = require('../service/eu-ads-daily-report');

assert.deepStrictEqual(completeDayWindow('2026-09-01'), [
    '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
    '2026-08-29', '2026-08-30', '2026-08-31'
]);
assert.strictEqual(normalizeCountryCode('gb'), 'UK');
assert.strictEqual(normalizeCountryCode('DE'), 'DE');
assert.strictEqual(normalizeCountryCode('US'), null);
assert.strictEqual(metricLabel('impressions'), '曝光');
assert.deepStrictEqual(EU_COUNTRY_ORDER, ['UK', 'DE', 'FR', 'IT', 'ES']);

const shops = listEuAdShops({
    list: [
        { name: 'EU-UK', country: 'GB', profile_id: 11 },
        { name: 'EU-DE', country: 'DE', profile_id: '22' },
        { name: 'US', country: 'US', profile_id: 99 }
    ]
});
assert.deepStrictEqual(shops.map((s) => [s.country, s.profileId]), [
    ['UK', 11],
    ['DE', 22]
]);

assert.strictEqual(rowKey('UK', 'clicks'), 'UK · 点击');

const dates = ['2026-08-30', '2026-08-31'];
const matrix = buildReportMatrix({
    dates,
    dailyByCountry: {
        UK: {
            '2026-08-30': { impressions: 100, clicks: 10, orders: 1 },
            '2026-08-31': { impressions: 120, clicks: 8, orders: 1 }
        }
    }
});
assert.strictEqual(matrix.rows.length, 15);
const ukImp = matrix.rows.find((r) => r.key === 'UK · 曝光');
const ukClk = matrix.rows.find((r) => r.key === 'UK · 点击');
const deImp = matrix.rows.find((r) => r.key === 'DE · 曝光');
assert.strictEqual(ukImp.values['2026-08-31'], 120);
assert.strictEqual(ukImp.trend, 'up');
assert.strictEqual(ukClk.trend, null);
assert.strictEqual(deImp.values['2026-08-31'], null);
assert.strictEqual(deImp.trend, null);

const sugMatrix = buildReportMatrix({
    dates: ['2026-08-30', '2026-08-31'],
    dailyByCountry: {
        UK: {
            '2026-08-30': { impressions: 200, clicks: 20, orders: 2 },
            '2026-08-31': { impressions: 100, clicks: 10, orders: 2 }
        },
        DE: {
            '2026-08-30': { impressions: 50, clicks: 5, orders: 2 },
            '2026-08-31': { impressions: 80, clicks: 10, orders: 1 }
        }
    }
});
const suggestions = buildSuggestions(sugMatrix);
assert.ok(suggestions.length >= 1 && suggestions.length <= 5);
assert.ok(suggestions.some((s) => s.country === 'UK' && /预算|出价/.test(s.action)));
assert.ok(suggestions.some((s) => s.country === 'DE' && /搜索词|Listing|转化/.test(s.action)));

(async () => {
    const calls = [];
    const callTool = async (name, args) => {
        calls.push({ name, args });
        if (name === 'lingxing_ad_auth_shops') {
            return {
                list: [
                    { name: 'UK', country: 'UK', profile_id: 1 },
                    { name: 'DE', country: 'DE', profile_id: 2 }
                ]
            };
        }
        if (name === 'lingxing_ad_campaign_report') {
            const pid = args.profile_ids[0];
            const day = String(args.report_date).slice(0, 10);
            if (pid === 1 && day === '2026-08-31') {
                return { list: [{ impressions: 10, clicks: 2, orders: 1, spends: 1 }] };
            }
            return { list: [{ impressions: 5, clicks: 1, orders: 0, spends: 1 }] };
        }
        throw new Error(`unexpected ${name}`);
    };
    const report = await fetchEuAdsDailyReport({ todayYmd: '2026-09-01', callTool });
    assert.strictEqual(report.dates.length, 7);
    assert.strictEqual(report.rows.length, 15);
    const ukImpRow = report.rows.find((r) => r.key === 'UK · 曝光');
    assert.strictEqual(ukImpRow.values['2026-08-31'], 10);
    assert.ok(Array.isArray(report.suggestions));
    assert.ok(calls.some((c) => c.name === 'lingxing_ad_auth_shops'));
    console.log('ok test-eu-ads-daily-report');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
