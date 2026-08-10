const fs = require('fs');
const path = require('path');
const { parseTrendsTimeline, stripGoogleAntiXssi, buildTrendsExploreUrl } = require('../service/data-collection/trends-parse');

let passed = 0;
let failed = 0;
function ok(n) { passed += 1; console.log('  ✓', n); }
function fail(n, e) { failed += 1; console.error('  ✗', n, e.message || e); }

try {
    const s = stripGoogleAntiXssi(")]}'\n{\"a\":1}");
    if (s !== '{"a":1}' && !s.includes('"a"')) throw new Error(s);
    ok('strip anti-xssi');
} catch (e) { fail('strip anti-xssi', e); }

try {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/google-trends-multiline.json'), 'utf8'));
    const rows = parseTrendsTimeline(fixture, 'shoes');
    if (!Array.isArray(rows) || rows.length !== 2) throw new Error('len');
    if (rows[0].value !== 42) throw new Error('value0');
    if (!rows[0].date) throw new Error('date');
    ok('parse fixture timeline');
} catch (e) { fail('parse fixture timeline', e); }

try {
    const prefixed = ")]}'\n" + fs.readFileSync(path.join(__dirname, 'fixtures/google-trends-multiline.json'), 'utf8');
    const rows = parseTrendsTimeline(prefixed, 'shoes');
    if (rows.length !== 2) throw new Error('prefixed len');
    ok('parse anti-xssi string');
} catch (e) { fail('parse anti-xssi string', e); }

try {
    const url = buildTrendsExploreUrl({ keyword: 'nike shoes', geo: 'US', time: 'today 3-m', hl: 'en-US', tz: 360 });
    if (!String(url).includes('trends.google.com')) throw new Error(url);
    if (!String(url).includes('nike')) throw new Error('keyword missing');
    ok('buildTrendsExploreUrl');
} catch (e) { fail('buildTrendsExploreUrl', e); }

try {
    parseTrendsTimeline('<html>no data</html>', 'x');
    fail('invalid should throw', new Error('未抛错'));
} catch (e) {
    if (String(e.message).includes('未抛错')) fail('invalid should throw', e);
    else ok('invalid should throw');
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
