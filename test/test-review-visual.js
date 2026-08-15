const assert = require('assert');
const {
    finiteOrNull,
    barPercent,
    compareTone,
    dayBarHeight,
    weekMax
} = require('../frontend/src/utils/review-visual.js');

assert.strictEqual(finiteOrNull(null), null);
assert.strictEqual(finiteOrNull(''), null);
assert.strictEqual(finiteOrNull(0), 0);
assert.strictEqual(finiteOrNull('12.5'), 12.5);

assert.strictEqual(barPercent(50, 100), 50);
assert.strictEqual(barPercent(150, 100), 100);
assert.strictEqual(barPercent(80, 0), null);
assert.strictEqual(barPercent(80, null), null);
assert.strictEqual(barPercent(null, 100), null);

assert.strictEqual(compareTone(80, 70, false), 'bad');
assert.strictEqual(compareTone(14, 15, false), 'ok');
assert.strictEqual(compareTone(70, 70, false), 'ok');
assert.strictEqual(compareTone(5, 5, true), 'ok');
assert.strictEqual(compareTone(4, 5, true), 'bad');
assert.strictEqual(compareTone(8, 5, true), 'ok');
assert.strictEqual(compareTone(10, null, false), 'neutral');
assert.strictEqual(compareTone(null, 10, true), 'neutral');

assert.strictEqual(dayBarHeight(10, 20), 50);
assert.strictEqual(dayBarHeight(20, 20), 100);
assert.strictEqual(dayBarHeight(null, 20), 0);
assert.strictEqual(dayBarHeight(10, 0), 0);

assert.strictEqual(weekMax([
    { status: 'filled', orders: 3 },
    { status: 'filled', orders: 8 },
    { status: 'missing', orders: 99 }
], 'orders'), 8);
assert.strictEqual(weekMax([{ status: 'missing', orders: 1 }], 'orders'), 0);

console.log('ok');
