const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const STAR_COLUMN_NAMES = ['星级', 'star', 'Star', '评分'];
const TITLE_COLUMN_NAMES = ['评论标题', '标题', 'title'];
const CONTENT_COLUMN_NAMES = ['评论内容', '内容', 'content', 'review'];
const ASIN_COLUMN_NAMES = ['ASIN', 'asin'];
const FBA_COLUMN_NAMES = ['配送方式', 'BB配送', '是否FBA', 'FBA', '发货方式', 'fulfillment'];
const SELLER_RATING_COUNT_NAMES = ['rating数量', 'Rating数量', '总Rating数', '评分数', '卖家评分数', 'feedback数', 'Feedback数', '评论数', 'Rating'];
const SELLER_STAR_NAMES = ['卖家星级', '店铺评分', '平均星级', '评分', 'Rating', 'rating'];

function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase();
}

function pickColumn(columns, candidates) {
    const normalized = columns.map(col => ({ col, key: normalizeHeader(col) }));
    for (const name of candidates) {
        const target = normalizeHeader(name);
        const hit = normalized.find(item => item.key === target);
        if (hit) return hit.col;
    }
    for (const name of candidates) {
        const target = normalizeHeader(name);
        const hit = normalized.find(item => item.key.includes(target));
        if (hit) return hit.col;
    }
    return null;
}

function parseStar(value) {
    const num = Number(String(value || '').trim());
    if (!Number.isFinite(num) || num < 1 || num > 5) return null;
    return num;
}

function parseCount(value) {
    const num = Number(String(value || '').replace(/,/g, '').trim());
    if (!Number.isFinite(num) || num < 0) return null;
    return num;
}

function isFbaValue(value) {
    const text = String(value || '').trim().toUpperCase();
    if (!text) return false;
    return text.includes('FBA') || text === '是' || text === 'YES' || text === 'TRUE' || text === '1';
}

function readWorkbook(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`评论文件不存在：${filePath}`);
    }
    return XLSX.readFile(filePath);
}

function sheetToRows(sheet) {
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function findReviewSheet(workbook) {
    for (const sheetName of workbook.SheetNames) {
        const rows = sheetToRows(workbook.Sheets[sheetName]);
        if (!rows.length) continue;
        const starColumn = pickColumn(Object.keys(rows[0]), STAR_COLUMN_NAMES);
        if (starColumn) {
            return { sheetName, rows, starColumn };
        }
    }
    throw new Error('评论文件中未找到包含「星级」列的工作表');
}

/**
 * 1星+2星差评占所有评价的比例
 */
function analyzeBadReviewRatio(rows, starColumn) {
    let total = 0;
    let badCount = 0;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const row of rows) {
        const star = parseStar(row[starColumn]);
        if (star === null) continue;
        total += 1;
        distribution[star] += 1;
        if (star <= 2) badCount += 1;
    }

    if (total === 0) {
        throw new Error('评论文件中没有有效的星级数据');
    }

    return {
        totalReviews: total,
        badReviewCount: badCount,
        badReviewRatio: badCount / total,
        badReviewPercent: Number((badCount / total * 100).toFixed(2)),
        starDistribution: distribution
    };
}

function findSellerSheet(workbook) {
    for (const sheetName of workbook.SheetNames) {
        const rows = sheetToRows(workbook.Sheets[sheetName]);
        if (!rows.length) continue;
        const columns = Object.keys(rows[0]);
        const ratingCountColumn = pickColumn(columns, SELLER_RATING_COUNT_NAMES);
        const starColumn = pickColumn(columns, SELLER_STAR_NAMES);
        const fbaColumn = pickColumn(columns, FBA_COLUMN_NAMES);
        if (ratingCountColumn && starColumn) {
            return { sheetName, rows, ratingCountColumn, starColumn, fbaColumn };
        }
    }
    return null;
}

/**
 * rating 数量 > 15 的 FBA 卖家平均星级（卖家明细表）
 */
function analyzeFbaSellerAverageStar(rows, { ratingCountColumn, starColumn, fbaColumn }, minRatingCount = 15) {
    const matched = [];

    for (const row of rows) {
        const ratingCount = parseCount(row[ratingCountColumn]);
        const star = parseStar(row[starColumn]);
        if (ratingCount === null || star === null) continue;
        if (ratingCount < minRatingCount) continue;
        if (fbaColumn && !isFbaValue(row[fbaColumn])) continue;
        matched.push({ ratingCount, star });
    }

    if (!matched.length) {
        return {
            minRatingCount,
            sellerCount: 0,
            averageStar: null,
            averageStarText: '-'
        };
    }

    const sum = matched.reduce((acc, item) => acc + item.star, 0);
    const averageStar = sum / matched.length;

    return {
        minRatingCount,
        sellerCount: matched.length,
        averageStar,
        averageStarText: averageStar.toFixed(2),
        source: 'seller_sheet'
    };
}

/**
 * 评论表按 ASIN 分组：Rating 数 > 15 的 listing 平均星级（欧鹭 pasin 评论导出兜底）
 */
function analyzeAsinGroupedAverageStar(rows, starColumn, minRatingCount = 15) {
    const asinColumn = pickColumn(Object.keys(rows[0] || {}), ASIN_COLUMN_NAMES);
    const fbaColumn = pickColumn(Object.keys(rows[0] || {}), FBA_COLUMN_NAMES);
    if (!asinColumn) {
        return {
            minRatingCount,
            sellerCount: 0,
            averageStar: null,
            averageStarText: '-',
            unavailableReason: '评论文件中未找到 ASIN 或卖家 Rating 相关列，暂无法计算'
        };
    }

    const groups = new Map();
    for (const row of rows) {
        const asin = String(row[asinColumn] || '').trim().toUpperCase();
        const star = parseStar(row[starColumn]);
        if (!asin || star === null) continue;
        if (fbaColumn && !isFbaValue(row[fbaColumn])) continue;

        if (!groups.has(asin)) {
            groups.set(asin, { asin, total: 0, sum: 0 });
        }
        const group = groups.get(asin);
        group.total += 1;
        group.sum += star;
    }

    const qualified = [];
    for (const group of groups.values()) {
        if (group.total < minRatingCount) continue;
        qualified.push({
            asin: group.asin,
            reviewCount: group.total,
            averageStar: group.sum / group.total
        });
    }

    if (!qualified.length) {
        return {
            minRatingCount,
            sellerCount: 0,
            averageStar: null,
            averageStarText: '-',
            unavailableReason: `未找到 Rating 数大于 ${minRatingCount} 的 ASIN 分组`
        };
    }

    const averageStar = qualified.reduce((acc, item) => acc + item.averageStar, 0) / qualified.length;
    return {
        minRatingCount,
        sellerCount: qualified.length,
        averageStar,
        averageStarText: averageStar.toFixed(2),
        source: 'asin_group',
        fbaFiltered: Boolean(fbaColumn),
        qualifiedAsins: qualified
    };
}

function analyzeReviewWorkbook(workbook) {
    const reviewSheet = findReviewSheet(workbook);
    const badReview = analyzeBadReviewRatio(reviewSheet.rows, reviewSheet.starColumn);

    const sellerSheet = findSellerSheet(workbook);
    let fbaSeller;
    if (sellerSheet) {
        fbaSeller = analyzeFbaSellerAverageStar(sellerSheet.rows, sellerSheet);
    } else {
        fbaSeller = analyzeAsinGroupedAverageStar(reviewSheet.rows, reviewSheet.starColumn);
    }

    return {
        reviewSheet: reviewSheet.sheetName,
        sellerSheet: sellerSheet ? sellerSheet.sheetName : null,
        badReview,
        fbaSeller
    };
}

function analyzeReviewFile(filePath) {
    const workbook = readWorkbook(filePath);
    return {
        filePath,
        ...analyzeReviewWorkbook(workbook)
    };
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncateText(text, maxLen = 400) {
    const value = stripHtml(text);
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen)}…`;
}

function extractReviewsForGpt(filePath, { contentMaxLen = 400 } = {}) {
    const workbook = readWorkbook(filePath);
    const reviewSheet = findReviewSheet(workbook);
    const columns = Object.keys(reviewSheet.rows[0] || {});
    const titleColumn = pickColumn(columns, TITLE_COLUMN_NAMES);
    const contentColumn = pickColumn(columns, CONTENT_COLUMN_NAMES);

    const reviews = [];
    for (const row of reviewSheet.rows) {
        const star = parseStar(row[reviewSheet.starColumn]);
        if (star === null) continue;
        const title = titleColumn ? stripHtml(row[titleColumn]) : '';
        const content = contentColumn ? truncateText(row[contentColumn], contentMaxLen) : '';
        if (!title && !content) continue;
        reviews.push({ star, title, content });
    }

    return { reviews, reviewSheet: reviewSheet.sheetName };
}

function buildReviewStatsSummary(reviewAnalysis) {
    const { badReview, fbaSeller } = reviewAnalysis;
    return {
        totalReviews: badReview.totalReviews,
        badReviewCount: badReview.badReviewCount,
        badReviewPercent: badReview.badReviewPercent,
        starDistribution: badReview.starDistribution,
        fbaSellerAverageStar: fbaSeller.averageStarText || '-'
    };
}

function formatPercent(value) {
    return `${Number((value * 100).toFixed(2))}%`;
}

function buildReviewAnalysisReportSection(analysisResult) {
    const { badReview, fbaSeller } = analysisResult;
    const lines = [
        '## 评论分析',
        '',
        `- **分析文件**：\`${analysisResult.filePath}\``,
        `- **评论工作表**：${analysisResult.reviewSheet}`,
        `- **有效评论数**：${badReview.totalReviews}`,
        `- **1星+2星差评数**：${badReview.badReviewCount}`,
        `- **差评占比**：${formatPercent(badReview.badReviewRatio)}（${badReview.badReviewPercent}%）`,
        `- **星级分布**：1星 ${badReview.starDistribution[1]} / 2星 ${badReview.starDistribution[2]} / 3星 ${badReview.starDistribution[3]} / 4星 ${badReview.starDistribution[4]} / 5星 ${badReview.starDistribution[5]}`
    ];

    if (fbaSeller.unavailableReason) {
        lines.push(`- **FBA卖家平均星级（Rating≥${fbaSeller.minRatingCount}）**：${fbaSeller.unavailableReason}`);
    } else {
        const sourceText = fbaSeller.source === 'seller_sheet'
            ? '卖家明细表'
            : (fbaSeller.fbaFiltered ? '评论按 ASIN 分组（已过滤 FBA）' : '评论按 ASIN 分组');
        lines.push(
            `- **FBA卖家平均星级（Rating≥${fbaSeller.minRatingCount}）**：${fbaSeller.averageStarText}`,
            `- **符合条件卖家/Listing 数**：${fbaSeller.sellerCount}`,
            `- **计算方式**：${sourceText}`
        );
        if (analysisResult.sellerSheet) {
            lines.push(`- **卖家工作表**：${analysisResult.sellerSheet}`);
        }
    }

    lines.push('');
    return lines.join('\n');
}

module.exports = {
    analyzeReviewFile,
    analyzeReviewWorkbook,
    extractReviewsForGpt,
    buildReviewStatsSummary,
    buildReviewAnalysisReportSection
};
