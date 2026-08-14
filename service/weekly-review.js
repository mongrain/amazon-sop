const { METRIC_KEYS } = require('./lingxing-metrics');

function isEmptyField(v) {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function toYmd(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const yyyy = value.getFullYear();
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        const dd = String(value.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    const s = String(value || '').trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : '';
}

function shiftYmd(ymd, days) {
    const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function weekDateList(weekStartYmd) {
    const start = toYmd(weekStartYmd);
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(shiftYmd(start, i));
    return dates;
}

function numOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function roundTo(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}

function sumKey(days, key) {
    let sum = 0;
    for (const day of days || []) {
        if (day.status !== 'filled') continue;
        const n = numOrNull(day[key]);
        sum += n == null ? 0 : n;
    }
    return sum;
}

function aggregateWeek(days) {
    const filled_days = (days || []).filter((d) => d.status === 'filled').length;
    const orders_sum = sumKey(days, 'orders');
    const ad_spend_sum = sumKey(days, 'ad_spend');
    const total_sales_sum = sumKey(days, 'total_sales');
    const impressions_sum = sumKey(days, 'impressions');
    const clicks_sum = sumKey(days, 'clicks');
    const actual_max_loss = filled_days === 0 ? null : roundTo(ad_spend_sum, 2);
    const actual_tacos = filled_days === 0 || total_sales_sum <= 0
        ? null
        : roundTo(ad_spend_sum / total_sales_sum * 100, 2);
    const avg_daily_orders = filled_days === 0 ? null : roundTo(orders_sum / filled_days, 2);
    const ctr = impressions_sum <= 0 ? null : roundTo(clicks_sum / impressions_sum * 100, 4);
    const cvr = clicks_sum <= 0 ? null : roundTo(orders_sum / clicks_sum * 100, 4);
    const cpc = clicks_sum <= 0 ? null : roundTo(ad_spend_sum / clicks_sum, 2);
    return {
        filled_days, orders_sum, ad_spend_sum, total_sales_sum, impressions_sum, clicks_sum,
        actual_max_loss, actual_tacos, avg_daily_orders, ctr, cvr, cpc
    };
}

function buildWeekDays(weekStartYmd, todayYmd, metricRows) {
    const dates = weekDateList(weekStartYmd);
    const today = toYmd(todayYmd);
    const byDate = new Map();
    for (const row of metricRows || []) {
        const d = toYmd(row.record_date);
        if (d) byDate.set(d, row);
    }
    const days = dates.map((date) => {
        const row = byDate.get(date);
        if (row) {
            return {
                date,
                status: 'filled',
                orders: numOrNull(row.orders),
                ad_spend: numOrNull(row.ad_spend),
                total_sales: numOrNull(row.total_sales),
                tacos: numOrNull(row.tacos),
                impressions: numOrNull(row.impressions),
                clicks: numOrNull(row.clicks)
            };
        }
        return {
            date,
            status: date >= today ? 'upcoming' : 'missing',
            orders: null,
            ad_spend: null,
            total_sales: null,
            tacos: null,
            impressions: null,
            clicks: null
        };
    });
    return {
        start: dates[0],
        end: dates[6],
        today,
        days,
        totals: aggregateWeek(days)
    };
}

function datesToPull(days) {
    return (days || []).filter((d) => d.status === 'missing').map((d) => d.date);
}

function countSkippedExisting(days) {
    return (days || []).filter((d) => d.status === 'filled').length;
}

function finiteOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function decideReview(totals, sprint) {
    const spend = totals && totals.actual_max_loss;
    const tacos = totals && totals.actual_tacos;
    const avg = totals && totals.avg_daily_orders;
    const maxLoss = finiteOrNull(sprint && sprint.max_loss_7d);
    const stable = finiteOrNull(sprint && sprint.stable_tacos_target);
    const targetOrders = finiteOrNull(sprint && sprint.target_daily_orders);
    if (maxLoss !== null && spend !== null && spend >= maxLoss) return 'STOPPED';
    if (stable !== null && tacos !== null && targetOrders !== null && avg !== null
        && tacos <= stable && avg >= targetOrders) {
        return 'MAINTENANCE';
    }
    return 'CONTINUE';
}

function fmtNum(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
    return String(roundTo(Number(v), digits));
}

function buildSummary({ weekStart, weekEnd, totals, sprint, decision }) {
    const filled = totals && totals.filled_days ? totals.filled_days : 0;
    if (filled === 0) {
        return `本周区间：${weekStart} ~ ${weekEnd}，已填 0/7 天。\n本周暂无日报。\n建议：CONTINUE。原因：本周暂无日报。`;
    }
    const maxLoss = finiteOrNull(sprint && sprint.max_loss_7d);
    const spend = totals.actual_max_loss;
    let spendLine = `花费合计 $${fmtNum(spend, 2)}`;
    if (maxLoss === null) spendLine += '（7天最大亏损额度未设）。';
    else if (spend !== null && spend >= maxLoss) spendLine += `（7天最大亏损额度 $${fmtNum(maxLoss, 2)}）：已超线。`;
    else spendLine += `（7天最大亏损额度 $${fmtNum(maxLoss, 2)}）：未超线。`;

    const promo = finiteOrNull(sprint && sprint.promo_tacos_limit);
    const stable = finiteOrNull(sprint && sprint.stable_tacos_target);
    let tacosLine = `本周 TACOS ${totals.actual_tacos == null ? '-' : fmtNum(totals.actual_tacos, 2) + '%'}`;
    const tacosBits = [];
    if (promo !== null) tacosBits.push(`推广期允许 ${fmtNum(promo, 2)}%`);
    if (stable !== null) tacosBits.push(`稳定期目标 ${fmtNum(stable, 2)}%`);
    if (tacosBits.length) tacosLine += `（${tacosBits.join('，')}）。`;
    else tacosLine += '。';

    const targetOrders = finiteOrNull(sprint && sprint.target_daily_orders);
    let ordersLine = `日均单量 ${fmtNum(totals.avg_daily_orders, 2)}`;
    if (targetOrders === null) ordersLine += '（目标未设）。';
    else if (totals.avg_daily_orders !== null && totals.avg_daily_orders >= targetOrders) {
        ordersLine += `（目标 ${fmtNum(targetOrders, 2)}）：已达标。`;
    } else {
        ordersLine += `（目标 ${fmtNum(targetOrders, 2)}）：未达标。`;
    }

    const metricBits = [];
    if (totals.ctr != null) {
        const goal = finiteOrNull(sprint && sprint.ctr_7d);
        metricBits.push(`本周 CTR ${fmtNum(totals.ctr, 4)}%${goal === null ? '' : `（目标 ${fmtNum(goal, 4)}%）`}`);
    }
    if (totals.cvr != null) {
        const goal = finiteOrNull(sprint && sprint.cvr_7d);
        metricBits.push(`CVR ${fmtNum(totals.cvr, 4)}%${goal === null ? '' : `（目标 ${fmtNum(goal, 4)}%）`}`);
    }
    if (totals.cpc != null) {
        const goal = finiteOrNull(sprint && sprint.cpc);
        metricBits.push(`CPC $${fmtNum(totals.cpc, 2)}${goal === null ? '' : `（目标 $${fmtNum(goal, 2)}）`}`);
    }

    let reason = '未触发停止或转维护条件';
    if (decision === 'STOPPED') reason = '本周广告花费已达或超过 7 天最大亏损额度';
    if (decision === 'MAINTENANCE') reason = '本周 TACOS 不高于稳定期目标且日均单量达到目标';

    const lines = [
        `本周区间：${weekStart} ~ ${weekEnd}，已填 ${filled}/7 天。`,
        spendLine,
        tacosLine,
        ordersLine
    ];
    if (metricBits.length) lines.push(metricBits.join('；') + '。');
    lines.push(`建议：${decision}。原因：${reason}。`);
    return lines.join('\n');
}

function buildSuggestion(week, sprint) {
    const totals = (week && week.totals) || aggregateWeek([]);
    const decision = decideReview(totals, sprint || {});
    return {
        actual_max_loss: totals.actual_max_loss,
        actual_tacos: totals.actual_tacos,
        decision,
        summary: buildSummary({
            weekStart: week && week.start,
            weekEnd: week && week.end,
            totals,
            sprint: sprint || {},
            decision
        })
    };
}

function pickSprint(sprint) {
    const src = sprint || {};
    return {
        sprint_goal: src.sprint_goal == null ? null : src.sprint_goal,
        target_daily_orders: numOrNull(src.target_daily_orders),
        ctr_7d: numOrNull(src.ctr_7d),
        cvr_7d: numOrNull(src.cvr_7d),
        cpc: numOrNull(src.cpc),
        promo_tacos_limit: numOrNull(src.promo_tacos_limit),
        stable_tacos_target: numOrNull(src.stable_tacos_target),
        max_loss_7d: numOrNull(src.max_loss_7d),
        profit_margin: numOrNull(src.profit_margin),
        budget_cap: numOrNull(src.budget_cap)
    };
}

function assembleReviewPayload({ review, sprint, metricRows, todayYmd }) {
    const weekStart = toYmd(review && review.week_start_date);
    const week = buildWeekDays(weekStart, todayYmd, metricRows);
    return {
        review,
        sprint: pickSprint(sprint),
        week,
        suggestion: buildSuggestion(week, sprint)
    };
}

function mappedHasMetric(mapped) {
    return METRIC_KEYS.some((key) => {
        const n = Number(mapped && mapped[key]);
        return mapped && mapped[key] !== '' && mapped[key] !== null && mapped[key] !== undefined
            && String(mapped[key]).trim() !== '' && Number.isFinite(n);
    });
}

function computeDerivedMetrics(row) {
    const ad_spend = numOrNull(row && row.ad_spend);
    const ad_sales = numOrNull(row && row.ad_sales);
    const total_sales = numOrNull(row && row.total_sales);
    const impressions = numOrNull(row && row.impressions);
    const clicks = numOrNull(row && row.clicks);
    const orders = numOrNull(row && row.orders);
    const acos = ad_sales && ad_sales > 0 && ad_spend !== null ? ad_spend / ad_sales * 100 : null;
    const tacos = total_sales && total_sales > 0 && ad_spend !== null ? ad_spend / total_sales * 100 : null;
    const ctr = impressions && impressions > 0 && clicks !== null ? clicks / impressions : null;
    const cvr = clicks && clicks > 0 && orders !== null ? orders / clicks : null;
    return { acos, tacos, ctr, cvr };
}

function applySuggestion(form, suggestion) {
    const next = { ...(form || {}) };
    const src = suggestion || {};
    for (const key of ['actual_max_loss', 'actual_tacos', 'decision', 'summary']) {
        if (isEmptyField(next[key]) && src[key] !== null && src[key] !== undefined && src[key] !== '') {
            next[key] = src[key];
        }
    }
    return next;
}

module.exports = {
    isEmptyField,
    toYmd,
    weekDateList,
    buildWeekDays,
    datesToPull,
    countSkippedExisting,
    decideReview,
    buildSummary,
    buildSuggestion,
    assembleReviewPayload,
    mappedHasMetric,
    computeDerivedMetrics,
    applySuggestion
};
