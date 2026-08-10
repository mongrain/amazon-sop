function amazonDomainToTld(amazonDomain) {
    const raw = String(amazonDomain || '').trim().toLowerCase();
    if (!raw) return 'com';
    const host = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const m = host.match(/^amazon\.(.+)$/);
    return m ? m[1] : 'com';
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value == null) continue;
        if (typeof value === 'string' && !value.trim()) continue;
        if (Array.isArray(value) && !value.length) continue;
        return value;
    }
    return '';
}

function normalizeRank(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) return value.join(' | ');
    return value;
}

function normalizeReviewCount(raw) {
    if (typeof raw.reviews === 'number') return raw.reviews;
    if (typeof raw.total_reviews === 'number') return raw.total_reviews;
    if (typeof raw.reviews_count === 'number') return raw.reviews_count;
    if (typeof raw.ratings_total === 'number') return raw.ratings_total;
    if (raw.product_information && typeof raw.product_information.customer_reviews === 'number') {
        return raw.product_information.customer_reviews;
    }
    // "1,234 ratings" 类文案
    const text = firstNonEmpty(
        raw.reviews_count,
        raw.total_reviews,
        raw.product_information && raw.product_information.customer_reviews
    );
    if (typeof text === 'string') {
        const digits = text.replace(/[^\d]/g, '');
        if (digits) return Number(digits);
    }
    return '';
}

function mapAmazonProduct(sdeJson) {
    const raw = sdeJson && typeof sdeJson === 'object' ? sdeJson : {};
    const info = raw.product_information && typeof raw.product_information === 'object'
        ? raw.product_information
        : {};
    const images = Array.isArray(raw.images) ? raw.images : [];
    const buybox = raw.buybox && typeof raw.buybox === 'object' ? raw.buybox : {};
    const fulfillment = buybox.fulfillment && typeof buybox.fulfillment === 'object'
        ? buybox.fulfillment
        : {};

    const title = firstNonEmpty(raw.name, raw.title);
    const brand = firstNonEmpty(raw.brand, info.brand);
    const soldBy = firstNonEmpty(raw.sold_by, fulfillment.sold_by);
    const shipsFrom = firstNonEmpty(raw.ships_from, fulfillment.ships_from);

    const product = {
        asin: firstNonEmpty(info.asin, raw.asin),
        title,
        name: title,
        brand,
        brand_name: firstNonEmpty(info.brand, brand),
        feature_bullets: Array.isArray(raw.feature_bullets) ? raw.feature_bullets : [],
        images,
        main_image: firstNonEmpty(images[0], raw.main_image),
        product_information: info,
        categories: firstNonEmpty(raw.product_category, raw.categories),
        full_description: firstNonEmpty(raw.full_description, raw.description),
        model: firstNonEmpty(raw.model, info.model_name),
        model_number: firstNonEmpty(info.item_model_number, raw.model),
        weight: firstNonEmpty(info.item_weight, raw.weight),
        manufacturer: firstNonEmpty(info.manufacturer, raw.manufacturer),
        material_type: firstNonEmpty(info.material, raw.material),
        best_sellers_rank: normalizeRank(firstNonEmpty(info.best_sellers_rank, raw.bestsellers_rank)),
        ships_from: shipsFrom,
        sold_by: soldBy,
        seller_name: firstNonEmpty(raw.seller_name, soldBy),
        seller_id: firstNonEmpty(raw.seller_id, raw.sellerId, fulfillment.seller_id),
        aplus_present: raw.aplus_present == null ? '' : Boolean(raw.aplus_present),
        availability: firstNonEmpty(
            raw.availability,
            buybox.availability,
            info.availability
        ),
        stock_quantity: firstNonEmpty(
            raw.stock_quantity,
            raw.inventory,
            buybox.maximum_order_quantity,
            buybox.quantity
        ),
        review_count: normalizeReviewCount(raw)
    };

    return { product, provider: 'scraperapi', raw };
}

module.exports = { amazonDomainToTld, mapAmazonProduct };
