const assert = require('assert');
const { callYanjunTool, parseMcpResponseText } = require('../service/yanjun-mcp');

(async () => {
    try {
        await callYanjunTool('lingxing_query_product_performance_asin_lists', {}, { url: '' });
        assert.fail('should throw');
    } catch (e) {
        assert.strictEqual(e.status, 400);
        assert.strictEqual(e.message, '未配置领星网关');
    }

    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"ok":1}}}\n\n';
    assert.deepStrictEqual(parseMcpResponseText(sse), { ok: 1 });

    const json = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{"ok":2}' }] } });
    assert.deepStrictEqual(parseMcpResponseText(json), { ok: 2 });

    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
        const method = JSON.parse(opts.body).method;
        if (method === 'initialize') {
            return {
                ok: true,
                headers: { get: (k) => (String(k).toLowerCase() === 'mcp-session-id' ? 'sid-1' : null) },
                text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } })
            };
        }
        if (method === 'notifications/initialized') {
            return { ok: true, headers: { get: () => null }, text: async () => '' };
        }
        return {
            ok: true,
            headers: { get: () => null },
            text: async () => JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                result: { structuredContent: { data: { data: { list: [{ asin: 'B0A' }] } } } }
            })
        };
    };

    const result = await callYanjunTool(
        'lingxing_query_product_performance_asin_lists',
        { offset: 0, length: 20 },
        { fetchImpl, url: 'https://example.test/mcp' }
    );
    assert.strictEqual(calls[0].body.method, 'initialize');
    assert.strictEqual(calls[2].body.method, 'tools/call');
    assert.strictEqual(calls[2].body.params.name, 'lingxing_query_product_performance_asin_lists');
    assert.strictEqual(calls[2].headers['mcp-session-id'], 'sid-1');
    assert.strictEqual(result.data.data.list[0].asin, 'B0A');

    try {
        await callYanjunTool('x', {}, {
            url: 'https://example.test/mcp',
            fetchImpl: async () => ({ ok: false, status: 502, headers: { get: () => null }, text: async () => 'bad' })
        });
        assert.fail('should throw');
    } catch (e) {
        assert.strictEqual(e.status, 502);
    }

    console.log('ok');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
