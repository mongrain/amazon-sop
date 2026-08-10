const PARSE_ERROR = 'Trends HTML 未解析到时序数据';

function stripGoogleAntiXssi(text) {
    const raw = String(text || '');
    const trimmed = raw.trimStart();
    if (trimmed.startsWith(")]}'")) {
        return trimmed.slice(4).trimStart();
    }
    return raw;
}

function buildTrendsExploreUrl({ keyword, geo, time, hl, tz }) {
    const u = new URL('https://trends.google.com/trends/explore');
    u.searchParams.set('q', keyword);
    if (geo) u.searchParams.set('geo', geo);
    if (time) u.searchParams.set('date', time);
    if (hl) u.searchParams.set('hl', hl);
    return u.toString();
}

function normalizeKeyword(keyword) {
    return String(keyword || '').trim().toLowerCase();
}

function pickNumericValue(values, keyword) {
    if (!Array.isArray(values) || !values.length) return 0;
    const normalizedKeyword = normalizeKeyword(keyword);
    const entry = values.find(item => {
        if (item == null) return false;
        if (typeof item === 'number') return false;
        if (typeof item === 'string') return false;
        const query = String(item.query || item.keyword || '').trim().toLowerCase();
        return query && query === normalizedKeyword;
    });
    if (entry) {
        const value = Number(entry.extracted_value ?? entry.value ?? 0);
        return Number.isFinite(value) ? value : 0;
    }
    if (values.length === 1) {
        const only = values[0];
        if (typeof only === 'number') return Number.isFinite(only) ? only : 0;
        if (typeof only === 'string') {
            const n = Number(only);
            return Number.isFinite(n) ? n : 0;
        }
        const value = Number(only?.extracted_value ?? only?.value ?? 0);
        return Number.isFinite(value) ? value : 0;
    }
    const first = values[0];
    if (typeof first === 'number') return Number.isFinite(first) ? first : 0;
    const value = Number(first?.extracted_value ?? first?.value ?? first ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function pickFormattedValue(values, keyword, numericValue) {
    if (!Array.isArray(values) || !values.length) {
        return String(Number.isFinite(numericValue) ? numericValue : 0);
    }
    const normalizedKeyword = normalizeKeyword(keyword);
    const entry = values.find(item => {
        if (item == null || typeof item !== 'object') return false;
        const query = String(item.query || item.keyword || '').trim().toLowerCase();
        return query && query === normalizedKeyword;
    });
    if (entry && entry.value != null) return String(entry.value);
    if (values.length === 1) {
        const only = values[0];
        if (typeof only === 'string' || typeof only === 'number') return String(only);
        if (only?.value != null) return String(only.value);
    }
    const first = values[0];
    if (typeof first === 'string' || typeof first === 'number') return String(first);
    if (first?.value != null) return String(first.value);
    return String(Number.isFinite(numericValue) ? numericValue : 0);
}

function mapTimelineRow(row, keyword) {
    const timestamp = Number(row.time ?? row.timestamp);
    const date = Number.isFinite(timestamp)
        ? new Date(timestamp * 1000).toISOString().slice(0, 10)
        : '';
    const valueSource = row.value ?? row.values ?? row.formattedValue;
    const formattedSource = row.formattedValue ?? row.values ?? row.value;
    const value = pickNumericValue(Array.isArray(valueSource) ? valueSource : [valueSource], keyword);
    const formattedValue = pickFormattedValue(
        Array.isArray(formattedSource) ? formattedSource : [formattedSource],
        keyword,
        value
    );
    return {
        date,
        time: row.time ?? row.timestamp,
        formattedTime: row.formattedTime || row.date || date,
        searches: value,
        value,
        formattedValue,
        empty: false
    };
}

function extractTimelineData(payload) {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.default && Array.isArray(payload.default.timelineData)) {
        return payload.default.timelineData;
    }

    if (payload.interest_over_time && Array.isArray(payload.interest_over_time.timeline_data)) {
        return payload.interest_over_time.timeline_data;
    }

    if (Array.isArray(payload.timelineData)) {
        return payload.timelineData;
    }

    if (Array.isArray(payload.widgets)) {
        for (const widget of payload.widgets) {
            const data = widget?.data ?? widget?.request ?? widget;
            const fromWidget = extractTimelineData(data);
            if (fromWidget && fromWidget.length) return fromWidget;
            if (Array.isArray(widget?.default?.timelineData)) {
                return widget.default.timelineData;
            }
        }
    }

    return null;
}

function parsePayloadObject(payload) {
    const timeline = extractTimelineData(payload);
    if (timeline && timeline.length) return timeline;
    return null;
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function extractTimelineFromHtml(html) {
    const text = String(html || '');

    const multilineMatch = text.match(/"timelineData"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (multilineMatch) {
        const parsed = tryParseJson(multilineMatch[1]);
        if (Array.isArray(parsed) && parsed.length) return parsed;
    }

    const interestMatch = text.match(/"timeline_data"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (interestMatch) {
        const parsed = tryParseJson(interestMatch[1]);
        if (Array.isArray(parsed) && parsed.length) return parsed;
    }

    const widgetsMatch = text.match(/"widgets"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (widgetsMatch) {
        const widgets = tryParseJson(widgetsMatch[1]);
        if (Array.isArray(widgets)) {
            for (const widget of widgets) {
                const timeline = extractTimelineData(widget);
                if (timeline && timeline.length) return timeline;
            }
        }
    }

    return null;
}

function parseTrendsTimeline(payload, keyword) {
    let timeline = null;

    if (typeof payload === 'string') {
        const stripped = stripGoogleAntiXssi(payload);
        const trimmed = stripped.trim();

        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            const parsed = tryParseJson(trimmed);
            if (parsed) {
                timeline = Array.isArray(parsed)
                    ? parsed
                    : parsePayloadObject(parsed);
            }
        }

        if (!timeline && (trimmed.startsWith('<') || trimmed.includes('<html'))) {
            timeline = extractTimelineFromHtml(trimmed);
        } else if (!timeline) {
            timeline = extractTimelineFromHtml(trimmed);
        }
    } else if (payload && typeof payload === 'object') {
        timeline = Array.isArray(payload) ? payload : parsePayloadObject(payload);
    }

    if (!timeline || !timeline.length) {
        throw new Error(PARSE_ERROR);
    }

    return timeline.map(row => mapTimelineRow(row, keyword));
}

module.exports = {
    stripGoogleAntiXssi,
    parseTrendsTimeline,
    buildTrendsExploreUrl,
    PARSE_ERROR
};
