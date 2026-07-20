const assert = require('assert');
const { flattenForCsv } = require('../service/data-collection/asin/flatten');

const sample = {
    search_metadata: { status: 'Success', total_time_taken: 4.3 },
    product: {
        asin: 'B0CGCMS31N',
        title: 'Test Product',
        rating: 4.5,
        feature_bullets: ['bullet one', 'bullet two'],
        attributes: [{ name: 'Brand', value: 'OtterBox' }],
        buybox: { price: { value: 23.56, currency: 'USD' } }
    }
};

const flat = flattenForCsv(sample);

assert.strictEqual(flat['product.asin'], 'B0CGCMS31N');
assert.strictEqual(flat['product.title'], 'Test Product');
assert.strictEqual(flat['product.rating'], 4.5);
assert.strictEqual(flat['product.buybox.price.value'], 23.56);
assert.strictEqual(flat['product.feature_bullets'], 'bullet one\nbullet two');
assert.ok(typeof flat['product.attributes'] === 'string');
assert.ok(flat['product.attributes'].includes('OtterBox'));
assert.strictEqual(flat['search_metadata.status'], 'Success');

console.log('test-asin-crawler-flatten: PASS');
