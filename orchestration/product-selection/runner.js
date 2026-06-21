const path = require('path');
const { downloadOalurReviews } = require('./oalur-reviews');
const { analyzeReviewFile, buildReviewAnalysisReportSection } = require('./review-analysis');
const { analyzeReviewsWithGpt, buildGptReviewReportSection } = require('./gpt-review-analysis');

const REVIEWS_ROOT = path.join(__dirname, '../../data/product-selection-reviews');

function buildReport(analysis, reviewResult, reviewAnalysis, gptAnalysis) {
    const lines = [
        '# 选品分析报告',
        '',
        `> 任务 ID：${analysis.id}`,
        `> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        '',
        '## 录入信息',
        '',
        `- **ASIN**：${analysis.asin}`,
        `- **竞品库地址**：${analysis.competitor_url}`,
        `- **箱规**：${analysis.box_length} × ${analysis.box_width} × ${analysis.box_height} cm`,
        `- **毛重**：${analysis.box_gross_weight} kg`,
        `- **箱装数量**：${analysis.box_quantity}`,
        `- **进货价**：¥${analysis.purchase_price}`,
        '',
        '## 评论下载',
        '',
        `- **ASIN**：${reviewResult.asin}`,
        `- **站点**：${reviewResult.site}`,
        `- **文件名**：${reviewResult.filename}`,
        `- **本地路径**：\`${reviewResult.localPath}\``,
        `- **欧鹭生成时间**：${reviewResult.createdAt || '-'}`,
        `- **数据来源**：${reviewResult.fromCache ? 'ASIN 缓存（未重新请求欧鹭）' : '欧鹭新下载'}`,
        ...(reviewResult.fileUrl ? [`- **下载地址**：${reviewResult.fileUrl}`] : []),
        '',
        buildReviewAnalysisReportSection(reviewAnalysis),
        buildGptReviewReportSection(gptAnalysis)
    ];
    return lines.join('\n');
}

/**
 * @param {object} analysis 数据库中的分析任务记录
 * @returns {Promise<{ report: string, reviewResult: object, reviewAnalysis: object, gptAnalysis: object }>}
 */
async function runProductSelectionAnalysis(analysis) {
    const saveDir = path.join(REVIEWS_ROOT, String(analysis.id));
    const reviewResult = await downloadOalurReviews({ saveDir, asin: analysis.asin });
    const reviewAnalysis = analyzeReviewFile(reviewResult.localPath);
    const gptAnalysis = await analyzeReviewsWithGpt({
        asin: analysis.asin,
        filePath: reviewResult.localPath,
        reviewAnalysis
    });

    return {
        report: buildReport(analysis, reviewResult, reviewAnalysis, gptAnalysis),
        reviewResult,
        reviewAnalysis,
        gptAnalysis
    };
}

module.exports = { runProductSelectionAnalysis };
