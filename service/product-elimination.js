const XLSX = require('xlsx');
const { getProductEconomics } = require('../product-economics');
const { mapSiteFromLabel } = require('../product-sites');
const { fetchAsinLinkMap, enrichResultsWithGroupSales, collapseLinkGroupResults } = require('./product-links');

const HEADER_ALIASES = {
    store: ['店铺'],
    country: ['国家'],
    asin: ['ASIN'],
    title: ['标题'],
    sku: ['SKU'],
    msku: ['MSKU'],
    productName: ['品名'],
    quantity: ['数量'],
    unitPrice: ['单价'],
    salesRevenue: ['销售收益'],
    itemPriceSales: ['销售额(Item Price)', '销售额(item price)', '销售额'],
    orderDate: ['订购日期'],
    isPromoted: ['是否推广'],
    orderStatus: ['订单状态']
};

const COST_NOT_FOUND = '产品库中找不到这个产品的成本';
const ABANDONED_STATUS = '已放弃';
const EXCLUDED_ORDER_STATUSES = new Set(['canceled', 'cancelled', '已取消']);
const SAMPLE_ORDER_FILE = 'amazon导出订单.txt';
const SAMPLE_EXCEL_FILE = '202606.xlsx';
const US_SALES_CHANNEL = 'Amazon.com';

const IMPORT_FORMAT = {
    AMAZON_TXT: 'amazon-txt',
    LINGXING_EXCEL: 'lingxing-excel'
};

const AMAZON_TXT_HEADERS = {
    salesChannel: 'sales-channel',
    orderStatus: 'order-status',
    asin: 'asin',
    purchaseDate: 'purchase-date',
    quantity: 'quantity',
    itemPrice: 'item-price',
    productName: 'product-name',
    sku: 'sku',
    promotionIds: 'promotion-ids'
};

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function round(v, digits = 2) {
    if (v == null || !Number.isFinite(v)) return null;
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
}

function pctChange(current, previous) {
    if (previous == null || current == null) return null;
    if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
    return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

function normalizeHeader(text) {
    return String(text || '').trim().replace(/\s+/g, '');
}

function buildColumnMap(headerRow) {
    const map = {};
    const normalizedHeaders = headerRow.map(h => normalizeHeader(h));

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        for (const alias of aliases) {
            const idx = normalizedHeaders.findIndex(h => h === normalizeHeader(alias));
            if (idx >= 0) {
                map[field] = idx;
                break;
            }
        }
    }
    return map;
}

function parseDateValue(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return toDateString(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) {
            const d = new Date(parsed.y, parsed.m - 1, parsed.d);
            return toDateString(d);
        }
    }
    const text = String(value).trim();
    if (!text) return null;
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return toDateString(d);
    const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
        const fixed = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (!Number.isNaN(fixed.getTime())) return toDateString(fixed);
    }
    return null;
}

function toDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return toDateString(d);
}

function daysBetween(startStr, endStr) {
    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    return Math.max(0, Math.round((end - start) / 86400000));
}

function isExcludedOrderStatus(status) {
    const key = String(status || '').trim().toLowerCase();
    return EXCLUDED_ORDER_STATUSES.has(key);
}

function isPromotedOrder(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;
    if (['是', 'yes', 'y', 'true', '1', '推广'].includes(text)) return true;
    if (['否', 'no', 'n', 'false', '0', '自然'].includes(text)) return false;
    return text.includes('是') || text.includes('推广');
}

function getCell(row, colMap, field) {
    const idx = colMap[field];
    if (idx == null || idx < 0) return '';
    return row[idx];
}

function getRowSalesAmount(row, colMap) {
    const itemPrice = num(getCell(row, colMap, 'itemPriceSales'));
    if (itemPrice != null && itemPrice > 0) return itemPrice;
    const revenue = num(getCell(row, colMap, 'salesRevenue'));
    if (revenue != null && revenue > 0) return revenue;
    const qty = num(getCell(row, colMap, 'quantity'));
    const price = num(getCell(row, colMap, 'unitPrice'));
    if (qty != null && qty > 0 && price != null) return round(qty * price, 2);
    return 0;
}

function getOrderDateRange(orders) {
    const dates = orders.map(o => o.orderDate).filter(Boolean).sort();
    if (!dates.length) return { min: null, max: null };
    return { min: dates[0], max: dates[dates.length - 1] };
}

function parseOrderRows(rows) {
    if (!Array.isArray(rows) || rows.length < 2) {
        throw new Error('表格至少需要表头行和一行数据');
    }

    let headerIndex = 0;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const line = rows[i].map(c => normalizeHeader(c));
        if (line.some(c => c === 'ASIN' || c.includes('ASIN'))) {
            headerIndex = i;
            break;
        }
    }

    const colMap = buildColumnMap(rows[headerIndex]);
    if (colMap.asin == null) {
        throw new Error('未找到 ASIN 列，请确认表头包含 ASIN 字段');
    }

    const orders = [];
    let skippedCanceled = 0;
    for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const asin = String(getCell(row, colMap, 'asin') || '').trim().toUpperCase();
        if (!asin || asin === 'ASIN') continue;

        const orderStatus = String(getCell(row, colMap, 'orderStatus') || '').trim();
        if (isExcludedOrderStatus(orderStatus)) {
            skippedCanceled += 1;
            continue;
        }

        const rawQty = num(getCell(row, colMap, 'quantity'));
        const qty = rawQty != null && rawQty > 0 ? rawQty : 0;
        const salesAmount = getRowSalesAmount(row, colMap);
        if (qty <= 0 && salesAmount <= 0) continue;

        const store = String(getCell(row, colMap, 'store') || '默认店铺').trim() || '默认店铺';
        orders.push({
            store,
            site: mapSiteFromLabel(store),
            country: String(getCell(row, colMap, 'country') || '').trim(),
            asin,
            title: String(getCell(row, colMap, 'title') || '').trim(),
            sku: String(getCell(row, colMap, 'sku') || '').trim(),
            msku: String(getCell(row, colMap, 'msku') || '').trim(),
            productName: String(getCell(row, colMap, 'productName') || '').trim(),
            quantity: qty > 0 ? qty : 1,
            unitPrice: num(getCell(row, colMap, 'unitPrice')),
            salesAmount,
            orderDate: parseDateValue(getCell(row, colMap, 'orderDate')),
            isPromoted: isPromotedOrder(getCell(row, colMap, 'isPromoted')),
            orderStatus
        });
    }

    if (!orders.length) {
        throw new Error('未解析到有效订单行，请检查 ASIN 列是否有数据');
    }

    return { orders, colMap, headerIndex, skippedCanceled };
}

function parseExcelBuffer(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('Excel 文件中没有工作表');
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    return parseOrderRows(rows);
}

function buildAmazonTxtColumnMap(headerLine) {
    const headers = headerLine.split('\t').map(h => h.trim().toLowerCase());
    const map = {};
    for (const [field, header] of Object.entries(AMAZON_TXT_HEADERS)) {
        const idx = headers.indexOf(header);
        if (idx >= 0) map[field] = idx;
    }
    return map;
}

function getAmazonTxtCell(row, colMap, field) {
    const idx = colMap[field];
    if (idx == null || idx < 0) return '';
    return row[idx] ?? '';
}

function parseAmazonOrderText(bufferOrText) {
    const text = Buffer.isBuffer(bufferOrText)
        ? bufferOrText.toString('utf8')
        : String(bufferOrText || '');
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
        throw new Error('文件至少需要表头行和一行数据');
    }

    const colMap = buildAmazonTxtColumnMap(lines[0]);
    if (colMap.asin == null) {
        throw new Error('未找到 asin 列，请确认是 Amazon 订单 TSV 导出格式');
    }
    if (colMap.salesChannel == null) {
        throw new Error('未找到 sales-channel 列，请确认是 Amazon 订单 TSV 导出格式');
    }

    const orders = [];
    let skippedCanceled = 0;
    let skippedNonUsChannel = 0;

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split('\t');
        const salesChannel = String(getAmazonTxtCell(row, colMap, 'salesChannel') || '').trim();
        if (salesChannel !== US_SALES_CHANNEL) {
            skippedNonUsChannel += 1;
            continue;
        }

        const asin = String(getAmazonTxtCell(row, colMap, 'asin') || '').trim().toUpperCase();
        if (!asin) continue;

        const orderStatus = String(getAmazonTxtCell(row, colMap, 'orderStatus') || '').trim();
        if (isExcludedOrderStatus(orderStatus)) {
            skippedCanceled += 1;
            continue;
        }

        const rawQty = num(getAmazonTxtCell(row, colMap, 'quantity'));
        const qty = rawQty != null && rawQty > 0 ? rawQty : 0;
        const itemPrice = num(getAmazonTxtCell(row, colMap, 'itemPrice'));
        const salesAmount = itemPrice != null && itemPrice > 0
            ? round(itemPrice, 2)
            : (qty > 0 ? 0 : 0);
        if (qty <= 0 && salesAmount <= 0) continue;

        const promotionIds = String(getAmazonTxtCell(row, colMap, 'promotionIds') || '').trim();
        orders.push({
            store: US_SALES_CHANNEL,
            site: null,
            salesChannel,
            country: 'US',
            asin,
            title: String(getAmazonTxtCell(row, colMap, 'productName') || '').trim(),
            sku: String(getAmazonTxtCell(row, colMap, 'sku') || '').trim(),
            msku: '',
            productName: '',
            quantity: qty > 0 ? qty : 1,
            unitPrice: qty > 0 && itemPrice != null ? round(itemPrice / qty, 2) : itemPrice,
            salesAmount,
            orderDate: parseDateValue(getAmazonTxtCell(row, colMap, 'purchaseDate')),
            isPromoted: Boolean(promotionIds),
            orderStatus
        });
    }

    if (!orders.length) {
        throw new Error(`未解析到 ${US_SALES_CHANNEL} 的有效订单行，请确认 sales-channel 为 Amazon.com 且有订单数据`);
    }

    return { orders, colMap, skippedCanceled, skippedNonUsChannel };
}

function isAmazonOrderText(buffer) {
    const head = buffer.slice(0, 300).toString('utf8').toLowerCase();
    return head.includes('amazon-order-id') && head.includes('sales-channel');
}

function isExcelBuffer(buffer) {
    if (!buffer || buffer.length < 4) return false;
    const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4B;
    const isXls = buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
    return isXlsx || isXls;
}

function detectImportFormat(buffer, sourceFile) {
    const name = String(sourceFile || '').toLowerCase();
    if (name.endsWith('.txt') || isAmazonOrderText(buffer)) {
        return IMPORT_FORMAT.AMAZON_TXT;
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || isExcelBuffer(buffer)) {
        return IMPORT_FORMAT.LINGXING_EXCEL;
    }
    throw new Error('无法识别文件格式，请上传 Amazon 订单 TXT 或领星订单 Excel（.xlsx）');
}

function parseOrderFile(buffer, sourceFile) {
    const importFormat = detectImportFormat(buffer, sourceFile);
    if (importFormat === IMPORT_FORMAT.AMAZON_TXT) {
        return {
            ...parseAmazonOrderText(buffer),
            importFormat,
            importFormatLabel: 'Amazon 订单 TXT'
        };
    }
    return {
        ...parseExcelBuffer(buffer),
        importFormat,
        importFormatLabel: '领星订单 Excel',
        skippedNonUsChannel: 0
    };
}

function filterOrdersByDateRange(orders, startInclusive, endInclusive) {
    return orders.filter(o => {
        if (!o.orderDate) return false;
        return o.orderDate >= startInclusive && o.orderDate <= endInclusive;
    });
}

function sumSales(orders) {
    return round(orders.reduce((sum, o) => sum + (o.salesAmount || 0), 0), 2);
}

function sumQuantity(orders) {
    return orders.reduce((sum, o) => sum + (o.quantity || 0), 0);
}

/** 销售额相同并列同一名次，下一档跳过并列占用的序号（1,2,2,4 而非 1,2,2,3） */
function assignCompetitionSalesRanks(items, salesField = 'salesAmount') {
    const list = [...items].sort((a, b) => (b[salesField] || 0) - (a[salesField] || 0));
    let prevSales = null;
    let rank = 0;
    for (let i = 0; i < list.length; i++) {
        const sales = list[i][salesField] || 0;
        if (prevSales === null || sales !== prevSales) {
            rank = i + 1;
            prevSales = sales;
        }
        list[i].salesRank = rank;
    }
    return list;
}

function organicRatio(orders) {
    if (!orders.length) return null;
    const organic = orders.filter(o => !o.isPromoted).length;
    return round((organic / orders.length) * 100, 1);
}

function buildPeriodComparison(orders, referenceDate) {
    const dateRange = getOrderDateRange(orders);
    const ref = referenceDate || dateRange.max || toDateString(new Date());
    const spanDays = dateRange.min && dateRange.max ? daysBetween(dateRange.min, dateRange.max) : 0;

    if (spanDays < 45 && dateRange.min && dateRange.max) {
        const midDate = addDays(dateRange.min, Math.floor(spanDays / 2));
        const firstHalf = filterOrdersByDateRange(orders, dateRange.min, midDate);
        const secondHalf = filterOrdersByDateRange(orders, addDays(midDate, 1), dateRange.max);
        const organicFirst = organicRatio(firstHalf);
        const organicSecond = organicRatio(secondHalf);

        return {
            mode: 'half-month',
            periodLabel: `${addDays(midDate, 1)}~${dateRange.max} vs ${dateRange.min}~${midDate}`,
            sales30d: {
                current: sumSales(secondHalf),
                previous: sumSales(firstHalf),
                changePct: pctChange(sumSales(secondHalf), sumSales(firstHalf)),
                ordersCurrent: secondHalf.length,
                ordersPrevious: firstHalf.length,
                periodLabel: '下半段 vs 上半段'
            },
            sales90d: {
                current: sumSales(orders),
                previous: null,
                changePct: null,
                ordersCurrent: orders.length,
                ordersPrevious: 0,
                periodLabel: '数据不足90天',
                note: `当前数据仅覆盖 ${dateRange.min} ~ ${dateRange.max}`
            },
            yoyMonth: {
                current: sumSales(secondHalf),
                previous: null,
                changePct: null,
                monthLabel: dateRange.max.slice(0, 7),
                compareMonthLabel: null,
                note: '单月导出数据无法计算同比'
            },
            organicRatio: {
                current: organicSecond,
                previous: organicFirst,
                changePct: organicSecond != null && organicFirst != null
                    ? round(organicSecond - organicFirst, 1)
                    : null
            }
        };
    }

    const d30Start = addDays(ref, -29);
    const d30PrevStart = addDays(ref, -59);
    const d30PrevEnd = addDays(ref, -30);
    const d90Start = addDays(ref, -89);
    const d90PrevStart = addDays(ref, -179);
    const d90PrevEnd = addDays(ref, -90);

    const last30 = filterOrdersByDateRange(orders, d30Start, ref);
    const prev30 = filterOrdersByDateRange(orders, d30PrevStart, d30PrevEnd);
    const last90 = filterOrdersByDateRange(orders, d90Start, ref);
    const prev90 = filterOrdersByDateRange(orders, d90PrevStart, d90PrevEnd);

    const refDate = new Date(ref + 'T00:00:00');
    const thisMonthStart = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-01`;
    const lastYearMonthStart = `${refDate.getFullYear() - 1}-${String(refDate.getMonth() + 1).padStart(2, '0')}-01`;
    const lastYearMonthEnd = addDays(
        `${refDate.getFullYear() - 1}-${String(refDate.getMonth() + 2).padStart(2, '0')}-01`,
        -1
    );

    const thisMonth = filterOrdersByDateRange(orders, thisMonthStart, ref);
    const lastYearMonth = filterOrdersByDateRange(orders, lastYearMonthStart, lastYearMonthEnd);

    const organicLast30 = organicRatio(last30);
    const organicPrev30 = organicRatio(prev30);

    return {
        mode: 'rolling',
        periodLabel: `以 ${ref} 为截止日`,
        sales30d: {
            current: sumSales(last30),
            previous: sumSales(prev30),
            changePct: pctChange(sumSales(last30), sumSales(prev30)),
            ordersCurrent: last30.length,
            ordersPrevious: prev30.length,
            periodLabel: '近30天 vs 前30天'
        },
        sales90d: {
            current: sumSales(last90),
            previous: sumSales(prev90),
            changePct: pctChange(sumSales(last90), sumSales(prev90)),
            ordersCurrent: last90.length,
            ordersPrevious: prev90.length,
            periodLabel: '近90天 vs 前90天'
        },
        yoyMonth: {
            current: sumSales(thisMonth),
            previous: sumSales(lastYearMonth),
            changePct: pctChange(sumSales(thisMonth), sumSales(lastYearMonth)),
            monthLabel: `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`,
            compareMonthLabel: `${refDate.getFullYear() - 1}-${String(refDate.getMonth() + 1).padStart(2, '0')}`,
            note: lastYearMonth.length ? null : '订单数据中无去年同期记录'
        },
        organicRatio: {
            current: organicLast30,
            previous: organicPrev30,
            changePct: organicLast30 != null && organicPrev30 != null
                ? round(organicLast30 - organicPrev30, 1)
                : null
        }
    };
}

function avgMetric(rows, field) {
    const vals = rows.map(r => num(r[field])).filter(v => v != null);
    if (!vals.length) return null;
    return round(vals.reduce((a, b) => a + b, 0) / vals.length, 4);
}

function sumMetric(rows, field) {
    const vals = rows.map(r => num(r[field])).filter(v => v != null);
    if (!vals.length) return null;
    return round(vals.reduce((a, b) => a + b, 0), 2);
}

function analyzeBudgetIncrease(metrics) {
    if (!metrics || metrics.length < 14) {
        return {
            orderGrowthPct: null,
            acosDeteriorated: null,
            note: '每日指标数据不足，无法分析加预算效果'
        };
    }

    const sorted = [...metrics].sort((a, b) => a.record_date.localeCompare(b.record_date));
    let bestEvent = null;

    for (let i = 7; i < sorted.length - 7; i++) {
        const before = sorted.slice(i - 7, i);
        const after = sorted.slice(i, i + 7);
        const current = sorted[i];
        const avgSpendBefore = avgMetric(before, 'ad_spend');
        const currentSpend = num(current.ad_spend);
        if (avgSpendBefore == null || currentSpend == null || avgSpendBefore <= 0) continue;
        if (currentSpend < avgSpendBefore * 1.2) continue;

        const ordersBefore = sumMetric(before, 'orders') || 0;
        const ordersAfter = sumMetric(after, 'orders') || 0;
        const acosBefore = avgMetric(before, 'acos');
        const acosAfter = avgMetric(after, 'acos');
        const growth = pctChange(ordersAfter, ordersBefore);
        const acosWorse = acosBefore != null && acosAfter != null && acosAfter > acosBefore * 1.1;

        const event = {
            date: current.record_date,
            orderGrowthPct: growth,
            acosDeteriorated: acosWorse,
            adSpendBefore: avgSpendBefore,
            adSpendAfter: currentSpend
        };
        if (!bestEvent || (growth != null && (bestEvent.orderGrowthPct == null || growth > bestEvent.orderGrowthPct))) {
            bestEvent = event;
        }
    }

    if (!bestEvent) {
        return {
            orderGrowthPct: null,
            acosDeteriorated: null,
            note: '未检测到明显加预算事件（花费较前7日均值上涨20%以上）'
        };
    }

    return {
        orderGrowthPct: bestEvent.orderGrowthPct,
        acosDeteriorated: bestEvent.acosDeteriorated,
        eventDate: bestEvent.date,
        note: null
    };
}

async function fetchMetricsForAsin(asin, dbCtx) {
    const today = toDateString(new Date());
    const start = addDays(today, -180);
    const rows = await dbCtx.queryAll(
        `SELECT record_date, orders, ad_spend, ad_sales, total_sales, ad_orders,
                acos, tacos, ctr, cvr, core_kw_rank
         FROM daily_asin_metrics
         WHERE asin = ? AND record_date >= ?
         ORDER BY record_date ASC`,
        [asin, start]
    );
    return rows || [];
}

function analyzeKeywordRank(metrics) {
    const today = toDateString(new Date());
    const last30Start = addDays(today, -30);
    const prev30Start = addDays(today, -60);
    const prev30End = addDays(today, -31);

    const last30 = metrics.filter(m => m.record_date >= last30Start);
    const prev30 = metrics.filter(m => m.record_date >= prev30Start && m.record_date <= prev30End);

    const currentRank = avgMetric(last30, 'core_kw_rank');
    const previousRank = avgMetric(prev30, 'core_kw_rank');

    if (currentRank == null && previousRank == null) {
        return { current: null, previous: null, change: null, note: '无关键词排名数据' };
    }

    const change = currentRank != null && previousRank != null
        ? round(currentRank - previousRank, 1)
        : null;

    return {
        current: currentRank != null ? round(currentRank, 0) : null,
        previous: previousRank != null ? round(previousRank, 0) : null,
        change,
        note: change != null
            ? (change > 0 ? '排名下降' : change < 0 ? '排名上升' : '排名持平')
            : null
    };
}

async function fetchAllCatalogSites(dbCtx) {
    const rows = await dbCtx.queryAll(
        `SELECT DISTINCT seq FROM products
         WHERE seq IS NOT NULL AND seq != ''
         ORDER BY seq ASC`
    );
    return (rows || []).map(r => r.seq);
}

async function enrichOrdersWithProductSite(orders, dbCtx) {
    const asins = [...new Set(orders.map(o => o.asin).filter(Boolean))];
    const asinSiteMap = new Map();
    if (asins.length) {
        const chunkSize = 500;
        for (let i = 0; i < asins.length; i += chunkSize) {
            const chunk = asins.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '?').join(',');
            const rows = await dbCtx.queryAll(
                `SELECT asin, seq FROM products WHERE asin IN (${placeholders})`,
                chunk
            );
            for (const row of rows || []) {
                asinSiteMap.set(row.asin, row.seq);
            }
        }
    }
    for (const order of orders) {
        if (!order.site) {
            order.site = asinSiteMap.get(order.asin) || mapSiteFromLabel(order.store) || null;
        }
    }
    return orders;
}

async function fetchCatalogProductsBySites(sites, dbCtx) {
    if (!sites.length) return new Map();
    const placeholders = sites.map(() => '?').join(',');
    const rows = await dbCtx.queryAll(
        `SELECT id, asin, name, seq, status, category, operating_started_at
         FROM products
         WHERE seq IN (${placeholders})
         ORDER BY seq ASC, asin ASC`,
        sites
    );
    const map = new Map();
    for (const site of sites) map.set(site, []);
    for (const row of rows || []) {
        if (!map.has(row.seq)) map.set(row.seq, []);
        map.get(row.seq).push(row);
    }
    return map;
}

function buildSiteOrderGroups(orders) {
    const bySite = new Map();
    let skippedUnmappedStore = 0;

    for (const order of orders) {
        const site = order.site || mapSiteFromLabel(order.store);
        if (!site) {
            skippedUnmappedStore += 1;
            continue;
        }
        order.site = site;

        if (!bySite.has(site)) bySite.set(site, new Map());
        const asinMap = bySite.get(site);
        if (!asinMap.has(order.asin)) {
            asinMap.set(order.asin, {
                site,
                asin: order.asin,
                title: order.title,
                sku: order.sku,
                msku: order.msku,
                productName: order.productName,
                orderStores: new Set(),
                orders: []
            });
        }
        const group = asinMap.get(order.asin);
        group.orderStores.add(order.store);
        if (!group.title && order.title) group.title = order.title;
        if (!group.productName && order.productName) group.productName = order.productName;
        group.orders.push(order);
    }

    for (const [, asinMap] of bySite) {
        for (const [, group] of asinMap) {
            group.orderStores = [...group.orderStores];
        }
    }

    return { bySite, skippedUnmappedStore };
}

async function fetchProductCost(asin, dbCtx, catalogProduct = null) {
    const product = catalogProduct || await dbCtx.queryOne(
        'SELECT id, asin, name, operating_started_at FROM products WHERE asin = ?',
        [asin]
    );
    if (!product) return { found: false, error: COST_NOT_FOUND };

    const economics = await getProductEconomics(product.id, dbCtx);
    const costRmb = economics?.inputs?.cost_price_rmb;
    const costUsd = economics?.computed?.cost_price_usd;
    const profitUsd = economics?.computed?.profit_usd;
    const sellingPrice = economics?.inputs?.selling_price_usd;

    if (costRmb == null && costUsd == null) {
        return { found: false, error: COST_NOT_FOUND, productName: product.name };
    }

    return {
        found: true,
        productId: product.id,
        productName: product.name,
        operatingStartedAt: product.operating_started_at,
        costPriceRmb: costRmb,
        costPriceUsd: costUsd,
        profitUsdPerUnit: profitUsd,
        sellingPriceUsd: sellingPrice
    };
}

async function buildProductResultRow({
    site,
    asin,
    catalogProduct,
    orderGroup,
    siteSalesTotal,
    referenceDate,
    dbCtx,
    caches
}) {
    const productOrders = orderGroup?.orders || [];
    const hasOrders = productOrders.length > 0;
    const salesAmount = sumSales(productOrders);
    const orderCount = sumQuantity(productOrders);
    const salesSharePct = siteSalesTotal > 0 ? round((salesAmount / siteSalesTotal) * 100, 2) : null;

    if (!caches.cost.has(asin)) {
        caches.cost.set(asin, await fetchProductCost(asin, dbCtx, catalogProduct));
    }
    const costInfo = caches.cost.get(asin);

    let grossProfit = null;
    let grossProfitContribution = null;
    let costError = null;

    if (!costInfo.found) {
        costError = costInfo.error;
    } else if (costInfo.profitUsdPerUnit != null) {
        grossProfitContribution = round(costInfo.profitUsdPerUnit * orderCount, 2);
        const avgUnitPrice = orderCount > 0 ? round(salesAmount / orderCount, 2) : null;
        const unitCost = costInfo.costPriceUsd;
        if (avgUnitPrice != null && unitCost != null) {
            grossProfit = round((avgUnitPrice - unitCost) * orderCount, 2);
        }
    } else if (costInfo.costPriceUsd != null) {
        const avgUnitPrice = orderCount > 0 ? round(salesAmount / orderCount, 2) : null;
        if (avgUnitPrice != null) {
            grossProfit = round((avgUnitPrice - costInfo.costPriceUsd) * orderCount, 2);
            grossProfitContribution = grossProfit;
        }
    }

    const growth = buildPeriodComparison(productOrders, referenceDate);

    if (!caches.metrics.has(asin)) {
        caches.metrics.set(asin, await fetchMetricsForAsin(asin, dbCtx));
    }
    const metrics = caches.metrics.get(asin);
    const recent30 = metrics.filter(m => m.record_date >= addDays(referenceDate, -29));
    const kwRank = analyzeKeywordRank(metrics);
    const budgetEffect = analyzeBudgetIncrease(metrics);

    const title = (catalogProduct && catalogProduct.name)
        || orderGroup?.title
        || orderGroup?.productName
        || costInfo.productName
        || '';

    return {
        site,
        store: site,
        asin,
        title,
        sku: orderGroup?.sku || '',
        msku: orderGroup?.msku || '',
        productStatus: catalogProduct?.status || null,
        category: catalogProduct?.category || null,
        operatingStartedAt: catalogProduct?.operating_started_at ?? costInfo.operatingStartedAt ?? null,
        inCatalog: Boolean(catalogProduct),
        hasOrders,
        orderStores: orderGroup?.orderStores || [],
        salesAmount,
        orderCount,
        salesSharePct,
        cost: costInfo.found ? {
            costPriceRmb: costInfo.costPriceRmb,
            costPriceUsd: costInfo.costPriceUsd,
            sellingPriceUsd: costInfo.sellingPriceUsd
        } : null,
        costError,
        grossProfit,
        grossProfitContribution,
        growth,
        keywordRank: kwRank,
        adScaling: {
            acos: avgMetric(recent30, 'acos'),
            tacos: avgMetric(recent30, 'tacos'),
            ctr: avgMetric(recent30, 'ctr'),
            cvr: avgMetric(recent30, 'cvr'),
            budgetIncrease: budgetEffect,
            highConvKeywordCount: {
                value: null,
                note: '系统暂无关键词级转化数据，需单独导入广告关键词报告'
            }
        }
    };
}

async function analyzeProductElimination(input, dbCtx) {
    let orders;
    let skippedCanceled = 0;
    let skippedNonUsChannel = 0;
    let importFormat = IMPORT_FORMAT.LINGXING_EXCEL;
    let importFormatLabel = '领星订单 Excel';

    if (input.buffer) {
        const parsed = parseOrderFile(input.buffer, input.sourceFile);
        orders = parsed.orders;
        skippedCanceled = parsed.skippedCanceled || 0;
        skippedNonUsChannel = parsed.skippedNonUsChannel || 0;
        importFormat = parsed.importFormat;
        importFormatLabel = parsed.importFormatLabel;
    } else if (Array.isArray(input.rows)) {
        ({ orders, skippedCanceled } = parseOrderRows(input.rows));
    } else {
        throw new Error('请上传订单文件（Amazon TXT 或领星 Excel）或提供表格数据');
    }

    await enrichOrdersWithProductSite(orders, dbCtx);
    const { bySite, skippedUnmappedStore } = buildSiteOrderGroups(orders);
    const catalogSites = await fetchAllCatalogSites(dbCtx);
    const sites = [...new Set([...catalogSites, ...bySite.keys()])]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));

    if (!sites.length) {
        throw new Error('产品库中未找到可分析站点，请先维护产品站点信息');
    }

    const catalogBySite = await fetchCatalogProductsBySites(sites, dbCtx);
    const asinLinkMap = await fetchAsinLinkMap(dbCtx);
    const dateRange = getOrderDateRange(orders);
    const referenceDate = dateRange.max || toDateString(new Date());
    const caches = { cost: new Map(), metrics: new Map() };
    const results = [];

    for (const site of sites) {
        const asinOrderMap = bySite.get(site) || new Map();
        const catalogProducts = catalogBySite.get(site) || [];
        const catalogAsinSet = new Set(catalogProducts.map(p => p.asin));

        const siteSalesTotal = [...asinOrderMap.values()]
            .filter(g => catalogAsinSet.has(g.asin))
            .reduce((sum, g) => sum + sumSales(g.orders), 0);

        for (const catalogProduct of catalogProducts) {
            const orderGroup = asinOrderMap.get(catalogProduct.asin) || null;
            const row = await buildProductResultRow({
                site,
                asin: catalogProduct.asin,
                catalogProduct,
                orderGroup,
                siteSalesTotal,
                referenceDate,
                dbCtx,
                caches
            });
            results.push(row);
        }

        for (const [asin, orderGroup] of asinOrderMap) {
            if (catalogAsinSet.has(asin)) continue;
            const row = await buildProductResultRow({
                site,
                asin,
                catalogProduct: null,
                orderGroup,
                siteSalesTotal: sumSales(orderGroup.orders),
                referenceDate,
                dbCtx,
                caches
            });
            results.push(row);
        }
    }

    enrichResultsWithGroupSales(results, asinLinkMap);
    const displayResults = collapseLinkGroupResults(results, asinLinkMap);

    const rankBySite = new Map();
    for (const r of displayResults) {
        if (!rankBySite.has(r.site)) rankBySite.set(r.site, []);
        rankBySite.get(r.site).push(r);
    }
    for (const [, list] of rankBySite) {
        assignCompetitionSalesRanks(list, 'groupSalesAmount');
    }

    displayResults.sort((a, b) => {
        if (a.site !== b.site) return a.site.localeCompare(b.site, 'zh-CN');
        return a.salesRank - b.salesRank;
    });

    const periodMeta = buildPeriodComparison(orders, referenceDate);
    const withOrdersCount = displayResults.filter(r => r.hasOrders).length;
    const withoutOrdersCount = displayResults.filter(r => !r.hasOrders).length;

    return {
        analyzedAt: new Date().toISOString(),
        sourceFile: input.sourceFile || null,
        totalOrders: orders.length,
        totalProducts: displayResults.length,
        catalogProductCount: displayResults.filter(r => r.inCatalog).length,
        withOrdersCount,
        withoutOrdersCount,
        skippedCanceled,
        skippedNonUsChannel,
        skippedUnmappedStore,
        importFormat,
        importFormatLabel,
        salesChannel: importFormat === IMPORT_FORMAT.AMAZON_TXT ? US_SALES_CHANNEL : null,
        dataDateRange: dateRange,
        referenceDate,
        periodMode: periodMeta.mode,
        periodLabel: periodMeta.periodLabel,
        sites,
        stores: sites,
        results: displayResults
    };
}

module.exports = {
    analyzeProductElimination,
    parseExcelBuffer,
    parseAmazonOrderText,
    parseOrderFile,
    detectImportFormat,
    parseOrderRows,
    COST_NOT_FOUND,
    SAMPLE_ORDER_FILE,
    SAMPLE_EXCEL_FILE,
    US_SALES_CHANNEL,
    IMPORT_FORMAT
};
