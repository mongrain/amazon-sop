/**
 * 2026 美国亚马逊 FBA 尾程计费重量与分段判定 + 费率查价
 */

const INCH_TO_CM = 2.54;
const LB_TO_KG = 0.453592;

function determine2026FbaTierAndWeight(length, width, height, actualWeight, lengthUnit = 'cm', weightUnit = 'kg') {
    let l = lengthUnit.toLowerCase() === 'cm' ? length / INCH_TO_CM : length;
    let w = lengthUnit.toLowerCase() === 'cm' ? width / INCH_TO_CM : width;
    let h = lengthUnit.toLowerCase() === 'cm' ? height / INCH_TO_CM : height;
    let actualWeightLb = weightUnit.toLowerCase() === 'kg' ? actualWeight / LB_TO_KG : actualWeight;

    let dims = [l, w, h].sort((a, b) => b - a);
    let longest = dims[0];
    let median = dims[1];
    let shortest = dims[2];

    let girth = (median + shortest) * 2;
    let lengthPlusGirth = longest + girth;

    let standardDimWeight = (longest * median * shortest) / 139;
    let bulkyWidth = Math.max(median, 2);
    let bulkyHeight = Math.max(shortest, 2);
    let bulkyDimWeight = (longest * bulkyWidth * bulkyHeight) / 139;

    let sizeTier = '';
    let billableWeightLb = 0;

    if (actualWeightLb <= 1 && longest <= 15 && median <= 12 && shortest <= 0.75) {
        sizeTier = 'Small Standard';
        billableWeightLb = actualWeightLb;
    } else if (Math.max(actualWeightLb, standardDimWeight) <= 20 && longest <= 18 && median <= 14 && shortest <= 8) {
        sizeTier = 'Large Standard';
        billableWeightLb = Math.max(actualWeightLb, standardDimWeight);
    } else {
        let bulkyTierWeight = Math.max(actualWeightLb, bulkyDimWeight);

        if (bulkyTierWeight <= 50 && longest <= 37 && median <= 28 && shortest <= 20 && lengthPlusGirth <= 130) {
            sizeTier = 'Small Bulky';
            billableWeightLb = bulkyTierWeight;
        } else if (bulkyTierWeight <= 50 && longest <= 59 && median <= 33 && shortest <= 33 && lengthPlusGirth <= 130) {
            sizeTier = 'Large Bulky';
            billableWeightLb = bulkyTierWeight;
        } else {
            if (actualWeightLb > 150) {
                sizeTier = 'Extra-large (> 150 lb)';
                billableWeightLb = actualWeightLb;
            } else {
                if (longest > 96 || lengthPlusGirth > 130) {
                    sizeTier = 'Extra-large (Special Oversize - 特大号)';
                } else {
                    sizeTier = 'Extra-large (<= 150 lb)';
                }
                billableWeightLb = bulkyTierWeight;
            }
        }
    }

    let finalBillableWeight = Math.ceil(billableWeightLb);

    return {
        dimensions_inch: { L: longest.toFixed(2), W: median.toFixed(2), H: shortest.toFixed(2) },
        length_plus_girth: lengthPlusGirth.toFixed(2),
        actual_weight_lb: actualWeightLb.toFixed(2),
        standard_dim_weight: standardDimWeight.toFixed(2),
        bulky_dim_weight: bulkyDimWeight.toFixed(2),
        size_tier: sizeTier,
        billable_weight_lb_raw: billableWeightLb.toFixed(2),
        final_billable_weight_lb: finalBillableWeight
    };
}

/** 按重量阶梯查价（maxWeightLb 为上限，fee 为该档费用） */
function lookupBracketFee(lb, brackets) {
    for (const row of brackets) {
        if (lb <= row.max) return row.fee;
    }
    const last = brackets[brackets.length - 1];
    if (last.perLbAbove) {
        const extra = Math.ceil((lb - last.max) / (last.perLbStep || 1));
        return last.fee + extra * last.perLbAbove;
    }
    return last.fee;
}

// 2026 美国 FBA 履约费（非服装，低价位段；单位 USD）
const SMALL_STANDARD_BRACKETS = [
    { max: 0.125, fee: 3.22 },
    { max: 0.25, fee: 3.40 },
    { max: 0.375, fee: 3.58 },
    { max: 0.5, fee: 3.77 },
    { max: 0.625, fee: 3.95 },
    { max: 0.75, fee: 4.15 },
    { max: 0.875, fee: 4.32 },
    { max: 1, fee: 4.45 }
];

const LARGE_STANDARD_BRACKETS = [
    { max: 0.25, fee: 3.86 },
    { max: 0.5, fee: 4.08 },
    { max: 0.75, fee: 4.24 },
    { max: 1, fee: 4.75 },
    { max: 1.25, fee: 5.40 },
    { max: 1.5, fee: 5.69 },
    { max: 1.75, fee: 5.97 },
    { max: 2, fee: 6.10 },
    { max: 2.25, fee: 6.28 },
    { max: 2.5, fee: 6.41 },
    { max: 2.75, fee: 6.59 },
    { max: 3, fee: 6.81 },
    { max: 20, fee: 6.81, perLbAbove: 0.08, perLbStep: 0.25 }
];

const SMALL_BULKY_BRACKETS = [
    { max: 1, fee: 9.73 },
    { max: 2, fee: 10.53 },
    { max: 3, fee: 11.33 },
    { max: 50, fee: 11.33, perLbAbove: 0.42, perLbStep: 1 }
];

const LARGE_BULKY_BRACKETS = [
    { max: 1, fee: 9.73 },
    { max: 2, fee: 10.53 },
    { max: 3, fee: 11.33 },
    { max: 50, fee: 11.33, perLbAbove: 0.42, perLbStep: 1 }
];

const EXTRA_LARGE_BRACKETS = [
    { max: 1, fee: 26.32 },
    { max: 2, fee: 28.08 },
    { max: 3, fee: 30.08 },
    { max: 50, fee: 30.08, perLbAbove: 0.83, perLbStep: 1 },
    { max: 150, fee: 69.16, perLbAbove: 0.83, perLbStep: 1 }
];

function lookupFbaFeeUsd(sizeTier, billableWeightLb) {
    const lb = Math.max(0, Number(billableWeightLb) || 0);
    if (sizeTier === 'Small Standard') return lookupBracketFee(lb, SMALL_STANDARD_BRACKETS);
    if (sizeTier === 'Large Standard') return lookupBracketFee(lb, LARGE_STANDARD_BRACKETS);
    if (sizeTier === 'Small Bulky') return lookupBracketFee(lb, SMALL_BULKY_BRACKETS);
    if (sizeTier === 'Large Bulky') return lookupBracketFee(lb, LARGE_BULKY_BRACKETS);
    if (sizeTier && sizeTier.startsWith('Extra-large')) return lookupBracketFee(lb, EXTRA_LARGE_BRACKETS);
    return 0;
}

function calculateLastMileUsd(lengthCm, widthCm, heightCm, grossWeightKg) {
    const len = Number(lengthCm) || 0;
    const wid = Number(widthCm) || 0;
    const hgt = Number(heightCm) || 0;
    const wt = Number(grossWeightKg) || 0;
    if (len <= 0 || wid <= 0 || hgt <= 0 || wt <= 0) {
        return { lastMileUsd: 0, fba: null };
    }
    const fba = determine2026FbaTierAndWeight(len, wid, hgt, wt, 'cm', 'kg');
    const lastMileUsd = lookupFbaFeeUsd(fba.size_tier, fba.final_billable_weight_lb);
    return { lastMileUsd, fba };
}

module.exports = {
    determine2026FbaTierAndWeight,
    lookupFbaFeeUsd,
    calculateLastMileUsd
};
