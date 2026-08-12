function calcEndDate(startDateStr, cycleDays) {
    const days = Number(cycleDays);
    if (!startDateStr || !Number.isFinite(days) || days <= 0) return '';
    const d = new Date(startDateStr + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Math.trunc(days) - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function calcRequiredImpressions(targetDailyOrders, ctrPct, cvrPct) {
    const orders = Number(targetDailyOrders);
    const ctr = Number(ctrPct) / 100;
    const cvr = Number(cvrPct) / 100;
    if (![orders, ctr, cvr].every(Number.isFinite) || orders < 0 || ctr <= 0 || cvr <= 0) return null;
    return Math.round((orders / (ctr * cvr)) * 100) / 100;
}

function calcBudgetCap(requiredImpressions, cpc) {
    const imp = Number(requiredImpressions);
    const p = Number(cpc);
    if (![imp, p].every(Number.isFinite) || imp < 0 || p < 0) return null;
    return Math.round(imp * p * 100) / 100;
}

function toFiniteOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function calcFinanceDefaults({ profitMarginRatio, profitUsd, currentDailyOrders }) {
    const ratio = toFiniteOrNull(profitMarginRatio);
    const marginPct = ratio == null ? null : Math.round(ratio * 10000) / 100;
    const profit = toFiniteOrNull(profitUsd);
    const orders = toFiniteOrNull(currentDailyOrders);
    let maxLoss = null;
    if (Number.isFinite(profit) && Number.isFinite(orders) && orders > 0) {
        maxLoss = Math.round(profit * orders * 7 * 100) / 100;
    }
    return {
        profit_margin_pct: marginPct,
        promo_tacos_limit: marginPct,
        stable_tacos_target: marginPct == null ? null : Math.round(marginPct * 0.6 * 100) / 100,
        max_loss_7d: maxLoss
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcEndDate, calcRequiredImpressions, calcBudgetCap, calcFinanceDefaults, toFiniteOrNull };
}

export { calcEndDate, calcRequiredImpressions, calcBudgetCap, calcFinanceDefaults, toFiniteOrNull };
