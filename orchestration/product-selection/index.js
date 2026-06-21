const { queryOne, runSql } = require('../../database');
const { runProductSelectionAnalysis } = require('./runner');

/**
 * 异步执行选品分析编排任务（fire-and-forget）
 * @param {number} analysisId
 */
function dispatchProductSelectionAnalysis(analysisId) {
    setImmediate(() => executeProductSelectionAnalysis(analysisId));
}

async function executeProductSelectionAnalysis(analysisId) {
    try {
        await runSql(
            "UPDATE product_selection_analyses SET status = 'PROCESSING', updated_at = NOW() WHERE id = ? AND status = 'PENDING'",
            [analysisId]
        );

        const analysis = await queryOne('SELECT * FROM product_selection_analyses WHERE id = ?', [analysisId]);
        if (!analysis || analysis.status !== 'PROCESSING') return;

        const { report } = await runProductSelectionAnalysis(analysis);

        await runSql(
            "UPDATE product_selection_analyses SET status = 'COMPLETED', report = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?",
            [report, analysisId]
        );
    } catch (e) {
        console.error(`[product-selection] analysis ${analysisId} failed:`, e);
        try {
            await runSql(
                "UPDATE product_selection_analyses SET status = 'FAILED', error_message = ?, updated_at = NOW() WHERE id = ?",
                [String(e.message || e), analysisId]
            );
        } catch (updateErr) {
            console.error(`[product-selection] failed to mark analysis ${analysisId} as FAILED:`, updateErr);
        }
    }
}

module.exports = { dispatchProductSelectionAnalysis, executeProductSelectionAnalysis };
