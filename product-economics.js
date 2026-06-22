const { calculateLastMileUsd } = require('./fba-2026');
const { getUsdCnyRate } = require('./exchange-rate');

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function round(v, digits = 2) {
    if (v == null || !Number.isFinite(v)) return null;
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
}

/** 头程 = max(长×宽×高/箱装数/6000, 毛重/箱装数) × 10/7 */
function calcFirstLegUsd(lengthCm, widthCm, heightCm, grossWeightKg, unitsPerBox) {
    const boxQty = Math.max(1, parseInt(unitsPerBox, 10) || 1);
    const len = num(lengthCm) || 0;
    const wid = num(widthCm) || 0;
    const hgt = num(heightCm) || 0;
    const wt = num(grossWeightKg) || 0;
    if (len <= 0 || wid <= 0 || hgt <= 0 || wt <= 0) return null;
    const volPart = (len * wid * hgt) / boxQty / 6000;
    const weightPart = wt / boxQty;
    return round(Math.max(volPart, weightPart) * (10 / 7), 4);
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        length_cm: num(row.length_cm),
        width_cm: num(row.width_cm),
        height_cm: num(row.height_cm),
        selling_price_usd: num(row.selling_price_usd),
        gross_weight_kg: num(row.gross_weight_kg),
        units_per_box: Math.max(1, parseInt(row.units_per_box, 10) || 1),
        cost_price_rmb: num(row.cost_price_rmb),
        first_leg_usd: num(row.first_leg_usd),
        first_leg_manual: !!row.first_leg_manual,
        tax_usd: num(row.tax_usd) ?? 0,
        misc_fee_usd: num(row.misc_fee_usd),
        ad_spend_usd: num(row.ad_spend_usd),
        ad_spend_manual: !!row.ad_spend_manual,
        last_mile_fee_usd: num(row.last_mile_fee_usd),
        last_mile_fee_manual: !!row.last_mile_fee_manual,
        order_velocity: num(row.order_velocity)
    };
}

async function computeEconomics(rawRow, dbCtx) {
    const row = normalizeRow(rawRow) || {};
    const exchange = await getUsdCnyRate(dbCtx);
    const rate = exchange.rate;

    const sellingPrice = row.selling_price_usd ?? 0;
    const costRmb = row.cost_price_rmb ?? 0;
    const costUsd = rate > 0 && costRmb ? round(costRmb / rate, 4) : null;

    const firstLegAuto = calcFirstLegUsd(
        row.length_cm, row.width_cm, row.height_cm, row.gross_weight_kg, row.units_per_box
    );
    const firstLeg = row.first_leg_manual && row.first_leg_usd != null ? row.first_leg_usd : firstLegAuto;

    const { lastMileUsd, fba } = calculateLastMileUsd(
        row.length_cm / row.units_per_box, row.width_cm / row.units_per_box, row.height_cm / row.units_per_box, row.gross_weight_kg / row.units_per_box
    );
    const feeUsd = sellingPrice ? round(sellingPrice * 0.15, 4) : 0;
    const lastMileFeeAuto = round((lastMileUsd || 0) + (feeUsd || 0), 4);
    const lastMileFee = row.last_mile_fee_manual && row.last_mile_fee_usd != null
        ? row.last_mile_fee_usd
        : lastMileFeeAuto;

    const adSpendAuto = sellingPrice ? round(sellingPrice * 0.2, 4) : null;
    const adSpend = row.ad_spend_manual && row.ad_spend_usd != null ? row.ad_spend_usd : adSpendAuto;

    const tax = row.tax_usd ?? 0;
    const misc = row.misc_fee_usd ?? 0;

    let profitUsd = null;
    if (sellingPrice > 0) {
        profitUsd = round(
            sellingPrice
            - (costUsd || 0)
            - (firstLeg || 0)
            - tax
            - misc
            - (adSpend || 0)
            - (lastMileFee || 0),
            4
        );
    }

    const profitRmb = profitUsd != null && rate ? round(profitUsd * rate, 2) : null;
    const profitMargin = profitUsd != null && sellingPrice > 0 ? round(profitUsd / sellingPrice, 4) : null;
    const orderVelocity = row.order_velocity;
    const totalProfitRmb = profitRmb != null && orderVelocity != null
        ? round(profitRmb * orderVelocity, 2)
        : null;

    return {
        inputs: row,
        exchangeRate: exchange,
        computed: {
            cost_price_usd: costUsd,
            first_leg_auto: firstLegAuto,
            first_leg_used: firstLeg,
            last_mile_usd: round(lastMileUsd, 4),
            fee_usd: feeUsd,
            last_mile_fee_auto: lastMileFeeAuto,
            last_mile_fee_used: lastMileFee,
            ad_spend_auto: adSpendAuto,
            ad_spend_used: adSpend,
            profit_usd: profitUsd,
            profit_rmb: profitRmb,
            profit_margin: profitMargin,
            total_profit_rmb: totalProfitRmb,
            fba
        }
    };
}

async function getProductEconomics(productId, dbCtx) {
    const row = await dbCtx.queryOne('SELECT * FROM product_economics WHERE product_id = ?', [productId]);
    return computeEconomics(row, dbCtx);
}

async function ensureEconomicsForProduct(productId, runSql) {
    await runSql(
        'INSERT IGNORE INTO product_economics (product_id, units_per_box, tax_usd) VALUES (?, 1, 0)',
        [productId]
    );
}

const PATCHABLE_FIELDS = [
    'length_cm', 'width_cm', 'height_cm', 'selling_price_usd', 'gross_weight_kg', 'units_per_box',
    'cost_price_rmb', 'first_leg_usd', 'first_leg_manual', 'tax_usd', 'misc_fee_usd',
    'ad_spend_usd', 'ad_spend_manual', 'last_mile_fee_usd', 'last_mile_fee_manual', 'order_velocity'
];

async function updateProductEconomics(productId, body, dbCtx) {
    const { queryOne, runSql } = dbCtx;
    await ensureEconomicsForProduct(productId, runSql);

    const sets = [];
    const params = [];
    for (const key of PATCHABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        let val = body[key];
        if (key.endsWith('_manual')) {
            val = val ? 1 : 0;
        } else if (['units_per_box'].includes(key)) {
            val = Math.max(1, parseInt(val, 10) || 1);
        } else if (val === '' || val === null) {
            val = null;
        } else {
            val = Number(val);
            if (!Number.isFinite(val)) val = null;
        }
        sets.push(`${key} = ?`);
        params.push(val);
    }

    if (sets.length) {
        params.push(productId);
        await runSql(`UPDATE product_economics SET ${sets.join(', ')} WHERE product_id = ?`, params);
    }

    return getProductEconomics(productId, dbCtx);
}

module.exports = {
    calcFirstLegUsd,
    computeEconomics,
    getProductEconomics,
    ensureEconomicsForProduct,
    updateProductEconomics,
    PATCHABLE_FIELDS
};
