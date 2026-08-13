function gatewayError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function parseSseDataLines(text) {
    const payloads = [];
    for (const line of String(text || '').split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
            payloads.push(JSON.parse(raw));
        } catch (e) {}
    }
    return payloads;
}

function unwrapToolResult(result) {
    if (!result || typeof result !== 'object') return result;
    if (result.structuredContent != null) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content : [];
    const textItem = content.find((item) => item && item.type === 'text' && item.text);
    if (textItem) {
        try {
            return JSON.parse(textItem.text);
        } catch (e) {
            return { text: textItem.text };
        }
    }
    if (result.result != null) return unwrapToolResult(result.result);
    return result;
}

function parseMcpResponseText(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    if (raw.startsWith('event:') || raw.includes('\ndata:') || raw.startsWith('data:')) {
        const payloads = parseSseDataLines(raw);
        const last = payloads[payloads.length - 1];
        if (!last) return null;
        if (last.error) {
            throw gatewayError(502, last.error.message || '领星网关返回错误');
        }
        return unwrapToolResult(last.result != null ? last.result : last);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw gatewayError(502, '领星网关响应无法解析');
    }
    if (parsed.error) {
        throw gatewayError(502, parsed.error.message || '领星网关返回错误');
    }
    return unwrapToolResult(parsed.result != null ? parsed.result : parsed);
}

async function postJson(fetchImpl, url, body, headers) {
    const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    const text = await res.text();
    return { res, text };
}

async function callYanjunTool(toolName, args, opts) {
    const options = opts || {};
    const url = String(options.url != null ? options.url : (process.env.YANJUN_MCP_URL || '')).trim();
    if (!url) throw gatewayError(400, '未配置领星网关');
    const fetchImpl = options.fetchImpl || fetch;
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
    };

    const init = await postJson(fetchImpl, url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'sop-system', version: '1.0.0' }
        }
    }, headers);
    if (!init.res.ok) {
        throw gatewayError(502, '领星网关初始化失败');
    }
    const sessionId = init.res.headers && init.res.headers.get
        ? init.res.headers.get('mcp-session-id')
        : null;
    if (sessionId) headers['mcp-session-id'] = sessionId;

    await postJson(fetchImpl, url, {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
    }, headers);

    const call = await postJson(fetchImpl, url, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} }
    }, headers);
    if (!call.res.ok) {
        throw gatewayError(502, '领星网关调用失败');
    }
    return parseMcpResponseText(call.text);
}

module.exports = {
    callYanjunTool,
    parseMcpResponseText
};
