const PRODUCT_SITES = ['50US', '149US', '82US', '48US'];

function isValidProductSite(site) {
    if (site === null || site === undefined || site === '') return true;
    return PRODUCT_SITES.includes(String(site).trim());
}

module.exports = { PRODUCT_SITES, isValidProductSite };
