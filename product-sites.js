const PRODUCT_SITES = ['50US', '149US', '82US', '48US', '223US'];

function isValidProductSite(site) {
    if (site === null || site === undefined || site === '') return true;
    return PRODUCT_SITES.includes(String(site).trim());
}

function getSiteNumericPrefix(site) {
    const m = String(site || '').trim().match(/^(\d+)/);
    return m ? m[1] : null;
}

/**
 * 将 Excel 站点标签（如「50美国」「50US」）按数字前缀映射为系统站点。
 * 仅当数字前缀与系统站点前缀完全一致时匹配，如 50 → 50US。
 */
function mapSiteFromLabel(label) {
    const raw = String(label || '').trim();
    if (!raw) return null;
    if (isValidProductSite(raw)) return raw;

    const prefix = getSiteNumericPrefix(raw);
    if (!prefix) return null;

    const matched = PRODUCT_SITES.find((site) => getSiteNumericPrefix(site) === prefix);
    return matched || null;
}

module.exports = {
    PRODUCT_SITES,
    isValidProductSite,
    getSiteNumericPrefix,
    mapSiteFromLabel
};
