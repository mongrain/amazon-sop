const EXACT_LABELS = {
    _crawl_asin: 'ASIN',
    'search_metadata.status': '请求状态',
    'search_metadata.created_at': '请求时间',
    'search_metadata.request_time_taken': '请求耗时(秒)',
    'search_metadata.parsing_time_taken': '解析耗时(秒)',
    'search_metadata.total_time_taken': '总耗时(秒)',
    'search_metadata.request_url': '请求URL',
    'search_parameters.engine': '引擎',
    'search_parameters.asin': '查询ASIN',
    'search_parameters.amazon_domain': 'Amazon站点',
    'product.asin': '产品ASIN',
    'product.title': '标题',
    'product.link': '商品链接',
    'product.rating': '评分',
    'product.reviews': '评论数',
    'product.main_image': '主图',
    'product.marketplace_id': '站点ID',
    'product.feature_bullets': '卖点',
    'product.attributes': '属性',
    'product.variants': '变体',
    'product.specifications': '规格',
    'product.bestsellers_rank': 'BSR排名',
    'product.images': '图片列表',
    'product.search_alias.title': '搜索类目',
    'product.buybox.price.raw': '价格(原始)',
    'product.buybox.price.value': '价格',
    'product.buybox.price.currency': '货币',
    'product.buybox.original_price.raw': '原价(原始)',
    'product.buybox.original_price.value': '原价',
    'product.buybox.save.percentage': '折扣(%)',
    'product.buybox.availability': '库存状态',
    'product.buybox.maximum_order_quantity': '最大购买数量',
    'product.buybox.fulfillment.ships_from': '发货方',
    'product.buybox.fulfillment.sold_by': '销售方',
    'product.buybox.fulfillment.is_sold_by_amazon': '是否亚马逊自营',
    'similar_item.asin': '相似品ASIN',
    'similar_item.title': '相似品标题',
    'similar_item.rating': '相似品评分',
    'similar_item.reviews': '相似品评论数',
    'similar_item.price.value': '相似品价格',
    'frequently_bought_together.total_price.value': '组合价',
    'frequently_bought_together.products': '组合购买商品',
    'sponsored_products': '赞助商品',
    'review_results': '评论结果'
};

const SEGMENT_LABELS = {
    search_metadata: '请求元数据',
    search_parameters: '查询参数',
    product: '产品',
    similar_item: '相似品',
    frequently_bought_together: '组合购买',
    sponsored_products: '赞助商品',
    review_results: '评论',
    buybox: '购买框',
    price: '价格',
    original_price: '原价',
    save: '优惠',
    fulfillment: '配送',
    standard_delivery: '标准配送',
    fastest_delivery: '最快配送',
    attributes: '属性',
    specifications: '规格',
    variants: '变体',
    images: '图片',
    feature_bullets: '卖点',
    bestsellers_rank: 'BSR',
    search_alias: '搜索类目',
    asin: 'ASIN',
    title: '标题',
    link: '链接',
    rating: '评分',
    reviews: '评论数',
    value: '数值',
    raw: '原始值',
    currency: '货币',
    symbol: '符号',
    availability: '库存',
    status: '状态',
    engine: '引擎',
    amazon_domain: 'Amazon站点',
    main_image: '主图',
    marketplace_id: '站点ID',
    products: '商品列表',
    total_price: '总价',
    percentage: '百分比',
    ships_from: '发货方',
    sold_by: '销售方',
    text: '文本',
    date: '日期',
    type: '类型',
    name: '名称',
    brand: '品牌'
};

function translateColumnHeader(key) {
    if (EXACT_LABELS[key]) return EXACT_LABELS[key];
    const parts = key.split('.');
    const translated = parts.map(part => SEGMENT_LABELS[part] || part);
    if (translated.join('.') === key) return key;
    return translated.join('_');
}

function buildColumnLabels(columns) {
    const labels = {};
    const used = new Map();
    for (const col of columns) {
        let label = translateColumnHeader(col);
        const count = used.get(label) || 0;
        if (count > 0) {
            label = `${label}_${count + 1}`;
        }
        used.set(translateColumnHeader(col), count + 1);
        labels[col] = label;
    }
    return labels;
}

module.exports = {
    EXACT_LABELS,
    SEGMENT_LABELS,
    translateColumnHeader,
    buildColumnLabels
};
