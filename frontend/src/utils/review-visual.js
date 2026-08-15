function finiteOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function barPercent(actual, target) {
    const a = finiteOrNull(actual);
    const t = finiteOrNull(target);
    if (a === null || t === null || t <= 0) return null;
    const pct = a / t * 100;
    return pct > 100 ? 100 : pct;
}

function compareTone(actual, target, higherBetter) {
    const a = finiteOrNull(actual);
    const t = finiteOrNull(target);
    if (a === null || t === null) return 'neutral';
    if (higherBetter) return a >= t ? 'ok' : 'bad';
    return a <= t ? 'ok' : 'bad';
}

function dayBarHeight(value, weekMax) {
    const v = finiteOrNull(value);
    const m = finiteOrNull(weekMax);
    if (v === null || m === null || m <= 0) return 0;
    const pct = v / m * 100;
    return pct > 100 ? 100 : pct;
}

function weekMax(days, key) {
    let max = null;
    for (const day of days || []) {
        if (!day || day.status !== 'filled') continue;
        const n = finiteOrNull(day[key]);
        if (n === null) continue;
        if (max === null || n > max) max = n;
    }
    return max === null ? 0 : max;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        finiteOrNull,
        barPercent,
        compareTone,
        dayBarHeight,
        weekMax
    };
}

export {
    finiteOrNull,
    barPercent,
    compareTone,
    dayBarHeight,
    weekMax
};
