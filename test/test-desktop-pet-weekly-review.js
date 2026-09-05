const assert = require('assert');
const { generateWeeklyReview, isRetryableAiError } = require('../service/desktop-pet-weekly-review');
const { deriveResponsesApiUrl, getResponsesOutputText } = require('../gpt');

const days = [{
    date: '2026-09-05',
    entries: [{ time: '09:00', content: '完成广告报表复盘' }]
}];

assert.strictEqual(isRetryableAiError({ response: { status: 503 } }), true);
assert.strictEqual(isRetryableAiError({ response: { status: 400 } }), false);
assert.strictEqual(deriveResponsesApiUrl('https://gateway.example/v1/chat/completions'), 'https://gateway.example/v1/responses');
assert.strictEqual(getResponsesOutputText({ output_text: '{"ok":true}' }), '{"ok":true}');
assert.strictEqual(getResponsesOutputText({ output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), '{"ok":true}');

(async () => {
    let calls = 0;
    let waits = 0;
    const summary = await generateWeeklyReview(days, {
        chatFn: async () => {
            calls += 1;
            if (calls < 3) {
                const error = new Error('Service unavailable');
                error.response = { status: 503 };
                throw error;
            }
            return { rows: [{ topic: '广告', progress: '完成报表复盘', status: '已推进', nextAction: '跟进异常项' }] };
        },
        waitFn: async () => { waits += 1; }
    });
    assert.strictEqual(calls, 3);
    assert.strictEqual(waits, 2);
    assert.strictEqual(summary.rows[0].topic, '广告');

    await assert.rejects(
        () => generateWeeklyReview(days, {
            chatFn: async () => {
                const error = new Error('Service unavailable');
                error.response = { status: 503 };
                throw error;
            },
            waitFn: async () => {}
        }),
        /AI 服务暂时不可用（503）/
    );
    console.log('ok');
})();
