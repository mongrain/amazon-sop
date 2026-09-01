const assert = require('assert');
const { mergeTaskEntries } = require('../service/desktop-pet-sync.js');

const older = '2026-09-01T01:00:00.000Z';
const newer = '2026-09-01T02:00:00.000Z';

assert.deepStrictEqual(mergeTaskEntries([], []), []);

assert.deepStrictEqual(
    mergeTaskEntries(
        [{ id: 'a', time: '12:30', content: '本地独有', createdAt: older, updatedAt: older }],
        [{ id: 'b', time: '18:10', content: '远端独有', createdAt: older, updatedAt: older }]
    ),
    [
        { id: 'a', time: '12:30', content: '本地独有', createdAt: older, updatedAt: older },
        { id: 'b', time: '18:10', content: '远端独有', createdAt: older, updatedAt: older }
    ]
);

assert.deepStrictEqual(
    mergeTaskEntries(
        [{ id: 'a', time: '12:30', content: '旧本地', createdAt: older, updatedAt: older }],
        [{ id: 'a', time: '12:30', content: '新远端', createdAt: older, updatedAt: newer }]
    ),
    [{ id: 'a', time: '12:30', content: '新远端', createdAt: older, updatedAt: newer }]
);

assert.deepStrictEqual(
    mergeTaskEntries(
        [{ id: 'a', time: '12:30', content: '新本地', createdAt: older, updatedAt: newer }],
        [{ id: 'a', time: '12:30', content: '旧远端', createdAt: older, updatedAt: older }]
    ),
    [{ id: 'a', time: '12:30', content: '新本地', createdAt: older, updatedAt: newer }]
);

assert.deepStrictEqual(
    mergeTaskEntries(
        [{ id: 'a', time: '12:30', content: '本地同刻', createdAt: older, updatedAt: newer }],
        [{ id: 'a', time: '12:30', content: '远端同刻', createdAt: older, updatedAt: newer }]
    ),
    [{ id: 'a', time: '12:30', content: '远端同刻', createdAt: older, updatedAt: newer }]
);

console.log('ok');
