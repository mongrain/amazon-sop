const { chatCompletionJson } = require('../../gpt');
const { extractReviewsForGpt, buildReviewStatsSummary } = require('./review-analysis');

const REVIEW_GPT_PROMPT = `你是一位资深亚马逊选品分析师。请基于提供的商品评论数据，判断该产品是否值得做，并输出结构化洞察。

【分析要求】
1. 不可做理由：从差评与共性抱怨中识别致命缺陷、退货风险、合规/安全、难以改进的质量问题等；若无充分理由则 should_avoid=false
2. 用户画像：归纳 2-5 类典型购买者（如家长、礼物采购者等），说明使用场景
3. 产品痛点：买家反复抱怨的问题，标注提及频率（高/中/低）
4. 产品卖点：买家认可的优势，标注提及频率（高/中/低）
5. 提及最多内容：统计评论中高频出现的关键词/主题（至少 5 条，按重要性排序）
6. 结论需有评论依据，避免空泛

【输出格式】
必须直接返回标准 JSON，不要 Markdown 标记或额外说明：
{
  "should_avoid": false,
  "avoid_reasons": ["不可做理由1"],
  "avoid_summary": "是否建议做的简短结论，80字以内",
  "user_personas": [
    { "name": "画像名称", "description": "描述", "evidence": "评论依据摘要" }
  ],
  "pain_points": [
    { "point": "痛点", "frequency": "高", "examples": ["原话摘要1"] }
  ],
  "selling_points": [
    { "point": "卖点", "frequency": "高", "examples": ["原话摘要1"] }
  ],
  "top_mentions": [
    { "topic": "高频主题", "frequency": "高", "sentiment": "负" }
  ],
  "overall_summary": "整体选品判断摘要，120字以内"
}`;

function buildGptInput(asin, stats, reviews) {
    const badReviews = reviews.filter(item => item.star <= 2);
    const goodReviews = reviews.filter(item => item.star >= 4);
    const neutralReviews = reviews.filter(item => item.star === 3);

    return JSON.stringify({
        asin,
        stats,
        review_samples: {
            bad_reviews: badReviews,
            neutral_reviews: neutralReviews.slice(0, 20),
            good_reviews: goodReviews.slice(0, 30)
        },
        note: 'bad_reviews 为全部1-2星评论；good/neutral 为抽样，请结合 stats 做整体判断'
    }, null, 2);
}

function normalizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeItems(value, keys) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            const row = {};
            keys.forEach(key => {
                row[key] = item && item[key] !== undefined && item[key] !== null
                    ? String(item[key]).trim()
                    : '';
            });
            if (keys.includes('examples')) {
                row.examples = normalizeStringList(item && item.examples);
            }
            return row;
        })
        .filter(item => Object.values(item).some(v => (Array.isArray(v) ? v.length : v)));
}

function normalizeGptReviewAnalysis(raw) {
    return {
        should_avoid: Boolean(raw.should_avoid),
        avoid_reasons: normalizeStringList(raw.avoid_reasons),
        avoid_summary: String(raw.avoid_summary || '').trim(),
        user_personas: normalizeItems(raw.user_personas, ['name', 'description', 'evidence']),
        pain_points: normalizeItems(raw.pain_points, ['point', 'frequency', 'examples']),
        selling_points: normalizeItems(raw.selling_points, ['point', 'frequency', 'examples']),
        top_mentions: normalizeItems(raw.top_mentions, ['topic', 'frequency', 'sentiment']),
        overall_summary: String(raw.overall_summary || '').trim()
    };
}

async function analyzeReviewsWithGpt({ asin, filePath, reviewAnalysis }) {
    const { reviews } = extractReviewsForGpt(filePath);
    if (!reviews.length) {
        throw new Error('评论文件中没有可用于 GPT 分析的文本');
    }

    const stats = buildReviewStatsSummary(reviewAnalysis);
    const input = buildGptInput(asin, stats, reviews);
    const raw = await chatCompletionJson(REVIEW_GPT_PROMPT, input);
    return normalizeGptReviewAnalysis(raw);
}

function renderListSection(title, items, formatter) {
    const lines = [`### ${title}`, ''];
    if (!items.length) {
        lines.push('- 暂无');
        return lines;
    }
    items.forEach((item, index) => {
        lines.push(formatter(item, index));
    });
    lines.push('');
    return lines;
}

function buildGptReviewReportSection(gptAnalysis) {
    const lines = [
        '## GPT 评论洞察',
        '',
        `- **是否建议规避**：${gptAnalysis.should_avoid ? '是（存在不可做风险）' : '否（未发现致命不可做理由）'}`,
        `- **选品结论**：${gptAnalysis.avoid_summary || gptAnalysis.overall_summary || '-'}`,
        ''
    ];

    if (gptAnalysis.avoid_reasons.length) {
        lines.push('### 不可做理由', '');
        gptAnalysis.avoid_reasons.forEach(reason => lines.push(`- ${reason}`));
        lines.push('');
    }

    lines.push(...renderListSection('用户画像', gptAnalysis.user_personas, (item) =>
        `- **${item.name}**：${item.description}${item.evidence ? `（依据：${item.evidence}）` : ''}`
    ));

    lines.push(...renderListSection('产品痛点', gptAnalysis.pain_points, (item) => {
        const examples = item.examples && item.examples.length
            ? `；例：${item.examples.slice(0, 2).join('；')}`
            : '';
        return `- **${item.point}**（提及：${item.frequency || '中'}）${examples}`;
    }));

    lines.push(...renderListSection('产品卖点', gptAnalysis.selling_points, (item) => {
        const examples = item.examples && item.examples.length
            ? `；例：${item.examples.slice(0, 2).join('；')}`
            : '';
        return `- **${item.point}**（提及：${item.frequency || '中'}）${examples}`;
    }));

    lines.push(...renderListSection('提及最多的内容', gptAnalysis.top_mentions, (item) =>
        `- **${item.topic}**（提及：${item.frequency || '高'}，情感：${item.sentiment || '中性'}）`
    ));

    if (gptAnalysis.overall_summary) {
        lines.push('### 整体摘要', '', gptAnalysis.overall_summary, '');
    }

    return lines.join('\n');
}

module.exports = {
    analyzeReviewsWithGpt,
    buildGptReviewReportSection
};
