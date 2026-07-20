require('dotenv').config();
const { getGoogleTrendsBatch } = require('../service/data-collection/trends');

async function main() {
    const keywords = process.argv.slice(2);
    const list = keywords.length ? keywords : ['dog', 'cat'];
    const data = await getGoogleTrendsBatch(list);
    console.log(JSON.stringify({
        total: data.total,
        success_count: data.success_count,
        results: data.results.map(item => ({
            keyword: item.keyword,
            code: item.code,
            message: item.message,
            success: item.success,
            source: item.source,
            data_count: Array.isArray(item.data) ? item.data.length : 0,
            latest: Array.isArray(item.data) && item.data.length ? item.data[item.data.length - 1] : null,
            error: item.error || null
        }))
    }, null, 2));
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
