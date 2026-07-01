function pad2(n) {
    return String(n).padStart(2, '0');
}

function toDateOnly(value) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value) : new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDateTimeForDb(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} 00:00:00`;
}

/**
 * 根据接口返回的 totalDays 反推运营开始时间（当天 0 点往前推 N 天）。
 */
function computeOperatingStartedAtFromTotalDays(totalDays, referenceDate = new Date()) {
    const days = Math.max(0, Math.round(Number(totalDays)));
    const ref = toDateOnly(referenceDate);
    if (!ref) return null;
    ref.setDate(ref.getDate() - days);
    return formatDateTimeForDb(ref);
}

/**
 * 根据运营开始时间计算运营天数（按自然日，含开始当天）。
 */
function computeOperatingDays(startedAt, referenceDate = new Date()) {
    const start = toDateOnly(startedAt);
    const ref = toDateOnly(referenceDate);
    if (!start || !ref) return null;
    const diffMs = ref.getTime() - start.getTime();
    return Math.max(0, Math.floor(diffMs / 86400000));
}

/**
 * 手动录入运营天数时，反推运营开始时间；传空则清空。
 */
function resolveOperatingStartedAtFromManualDays(manualDays) {
    if (manualDays === null || manualDays === undefined || manualDays === '') {
        return null;
    }
    const days = Math.round(Number(manualDays));
    if (Number.isNaN(days) || days < 0) {
        throw new Error('运营天数必须是非负整数');
    }
    return computeOperatingStartedAtFromTotalDays(days);
}

module.exports = {
    computeOperatingStartedAtFromTotalDays,
    computeOperatingDays,
    resolveOperatingStartedAtFromManualDays
};
