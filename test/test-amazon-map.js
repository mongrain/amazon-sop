const { amazonDomainToTld, mapAmazonProduct } = require('../service/data-collection/amazon-map');

let passed = 0;
let failed = 0;
function ok(n) { passed += 1; console.log('  ✓', n); }
function fail(n, e) { failed += 1; console.error('  ✗', n, e.message || e); }

function assertEq(a, e, n) {
    if (a !== e) throw new Error(`期望 ${e}，实际 ${a}`);
    ok(n);
}

try {
    assertEq(amazonDomainToTld('amazon.com'), 'com', 'amazon.com → com');
    assertEq(amazonDomainToTld('www.amazon.co.uk'), 'co.uk', 'amazon.co.uk → co.uk');
    assertEq(amazonDomainToTld(''), 'com', '空域名默认 com');
} catch (e) { fail('tld 映射', e); }

try {
    const mapped = mapAmazonProduct({
        name: 'Demo Product',
        brand: 'DemoBrand',
        feature_bullets: ['a', 'b'],
        images: ['https://example.com/1.jpg'],
        product_category: 'Home–Kitchen',
        product_information: { asin: 'B0TEST', manufacturer: 'M' }
    });
    if (!mapped.product) throw new Error('缺少 product');
    if (mapped.provider !== 'scraperapi') throw new Error('provider');
    if (mapped.product.title !== 'Demo Product' && mapped.product.name !== 'Demo Product') {
        throw new Error('title/name 未映射');
    }
    if (!Array.isArray(mapped.product.feature_bullets) || mapped.product.feature_bullets.length !== 2) {
        throw new Error('feature_bullets');
    }
    ok('mapAmazonProduct 基础字段');
} catch (e) { fail('mapAmazonProduct 基础字段', e); }

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
