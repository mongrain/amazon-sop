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
    'product.name': '标题',
    'product.link': '商品链接',
    'product.rating': '评分',
    'product.reviews': '评论数',
    'product.main_image': '主图',
    'product.marketplace_id': '站点ID',
    'product.feature_bullets': '五点',
    'product.attributes': '属性',
    'product.variants': '变体',
    'product.specifications': '规格',
    'product.bestsellers_rank': 'BSR排名',
    'product.images': '图片列表',
    'product.brand': '品牌',
    'product.brand_url': '品牌链接',
    'product.categories': '类目',
    'product.product_category': '类目',
    'product.full_description': '详细描述',
    'product.model': '型号',
    'product.ships_from': '发货方',
    'product.sold_by': '销售方',
    'product.aplus_present': '是否有A+',
    'product.is_coupon_exists': '是否有优惠券',
    'product.search_alias.title': '搜索类目',
    'product.buybox.price.raw': '价格文案',
    'product.buybox.price.value': '价格',
    'product.buybox.price.currency': '货币',
    'product.buybox.price.symbol': '货币符号',
    'product.buybox.original_price.raw': '原价文案',
    'product.buybox.original_price.value': '原价',
    'product.buybox.original_price.currency': '原价货币',
    'product.buybox.original_price.symbol': '原价货币符号',
    'product.buybox.save.percentage': '折扣(%)',
    'product.buybox.save.raw': '折扣文案',
    'product.buybox.availability': '库存状态',
    'product.buybox.availability_text': '库存说明',
    'product.buybox.maximum_order_quantity': '最大购买数量',
    'product.buybox.fulfillment.ships_from': '发货方',
    'product.buybox.fulfillment.sold_by': '销售方',
    'product.buybox.fulfillment.is_sold_by_amazon': '是否亚马逊自营',
    'product.buybox.fulfillment.standard_delivery.raw': '标准配送文案',
    'product.buybox.fulfillment.standard_delivery.text': '标准配送说明',
    'product.buybox.fulfillment.fastest_delivery.raw': '最快配送文案',
    'product.buybox.fulfillment.fastest_delivery.text': '最快配送说明',
    'product.product_information.asin': '产品ASIN',
    'product.product_information.brand': '品牌',
    'product.product_information.color': '颜色',
    'product.product_information.material': '材质',
    'product.product_information.manufacturer': '制造商',
    'product.product_information.model_name': '型号名称',
    'product.product_information.item_model_number': '型号编号',
    'product.product_information.item_weight': '重量',
    'product.product_information.product_dimensions': '尺寸',
    'product.product_information.date_first_available': '上架日期',
    'product.product_information.best_sellers_rank': '畅销榜排名',
    'product.product_information.capacity': '容量',
    'product.product_information.power_source': '电源',
    'product.product_information.voltage': '电压',
    'product.product_information.wattage': '功率',
    'product.product_information.special_feature': '特殊功能',
    'product.product_information.included_components': '包含配件',
    'product.product_information.product_care_instructions': '保养说明',
    'product.product_information.lid_material': '盖子材质',
    'similar_item.asin': '相似品ASIN',
    'similar_item.title': '相似品标题',
    'similar_item.rating': '相似品评分',
    'similar_item.reviews': '相似品评论数',
    'similar_item.price.value': '相似品价格',
    'frequently_bought_together.total_price.value': '组合价',
    'frequently_bought_together.products': '组合购买商品',
    sponsored_products: '赞助商品',
    review_results: '评论结果',
    provider: '数据来源'
};

const SEGMENT_LABELS = {
    search_metadata: '请求元数据',
    search_parameters: '查询参数',
    product: '产品',
    product_information: '产品信息',
    product_category: '类目',
    product_dimensions: '尺寸',
    product_care_instructions: '保养说明',
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
    feature_bullets: '五点',
    bestsellers_rank: 'BSR',
    best_sellers_rank: '畅销榜排名',
    search_alias: '搜索类目',
    asin: 'ASIN',
    title: '标题',
    link: '链接',
    rating: '评分',
    reviews: '评论数',
    value: '金额',
    raw: '文案',
    currency: '货币',
    symbol: '符号',
    availability: '库存',
    availability_text: '库存说明',
    formatted: '格式化显示',
    formatted_value: '显示值',
    extracted_value: '提取值',
    empty: '是否为空',
    text: '说明',
    date: '日期',
    type: '类型',
    name: '名称',
    brand: '品牌',
    brand_url: '品牌链接',
    categories: '类目',
    full_description: '详细描述',
    model: '型号',
    model_name: '型号名称',
    item_model_number: '型号编号',
    item_weight: '重量',
    color: '颜色',
    material: '材质',
    lid_material: '盖子材质',
    manufacturer: '制造商',
    capacity: '容量',
    power_source: '电源',
    voltage: '电压',
    wattage: '功率',
    special_feature: '特殊功能',
    included_components: '包含配件',
    date_first_available: '上架日期',
    aplus_present: '是否有A+',
    is_coupon_exists: '是否有优惠券',
    provider: '数据来源',
    maximum_order_quantity: '最大购买数量',
    is_sold_by_amazon: '是否亚马逊自营',
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
    request_time_taken: '请求耗时',
    parsing_time_taken: '解析耗时',
    total_time_taken: '总耗时',
    created_at: '创建时间',
    request_url: '请求URL'
};

/** 无法整段命中时，按 snake_case 单词拼中文 */
const WORD_LABELS = {
    product: '产品',
    information: '信息',
    category: '类目',
    categories: '类目',
    dimensions: '尺寸',
    dimension: '尺寸',
    care: '保养',
    instructions: '说明',
    search: '搜索',
    metadata: '元数据',
    parameters: '参数',
    similar: '相似',
    item: '商品',
    frequently: '经常',
    bought: '购买',
    together: '一起',
    sponsored: '赞助',
    review: '评论',
    results: '结果',
    buybox: '购买框',
    price: '价格',
    original: '原',
    save: '优惠',
    fulfillment: '配送',
    standard: '标准',
    delivery: '配送',
    fastest: '最快',
    attributes: '属性',
    specifications: '规格',
    variants: '变体',
    images: '图片',
    image: '图片',
    feature: '功能',
    features: '功能',
    special: '特殊',
    bullets: '卖点',
    bestsellers: '畅销',
    best: '畅销',
    sellers: '卖家',
    seller: '卖家',
    rank: '排名',
    alias: '别名',
    asin: 'ASIN',
    title: '标题',
    link: '链接',
    url: '链接',
    rating: '评分',
    reviews: '评论数',
    value: '金额',
    raw: '文案',
    currency: '货币',
    symbol: '符号',
    availability: '库存',
    status: '状态',
    engine: '引擎',
    amazon: '亚马逊',
    domain: '站点',
    main: '主',
    marketplace: '市场',
    id: 'ID',
    products: '商品列表',
    total: '总',
    percentage: '百分比',
    ships: '发货',
    from: '方',
    sold: '销售',
    by: '方',
    text: '说明',
    date: '日期',
    first: '首次',
    available: '上架',
    type: '类型',
    name: '名称',
    brand: '品牌',
    full: '详细',
    description: '描述',
    model: '型号',
    number: '编号',
    weight: '重量',
    color: '颜色',
    material: '材质',
    lid: '盖子',
    manufacturer: '制造商',
    capacity: '容量',
    power: '电源',
    source: '来源',
    voltage: '电压',
    wattage: '功率',
    included: '包含',
    components: '配件',
    aplus: 'A+',
    present: '有',
    is: '是否',
    coupon: '优惠券',
    exists: '存在',
    provider: '数据来源',
    maximum: '最大',
    order: '订单',
    quantity: '数量',
    request: '请求',
    time: '时间',
    taken: '耗时',
    parsing: '解析',
    created: '创建',
    at: '于',
    empty: '空',
    formatted: '显示',
    extracted: '提取'
};

function translateSnakeCaseWords(part) {
    const words = String(part || '').split('_').filter(Boolean);
    if (!words.length) return null;
    const mapped = words.map(w => WORD_LABELS[w.toLowerCase()]);
    if (mapped.every(Boolean)) return mapped.join('');
    return null;
}

function translateSegment(part) {
    const key = String(part || '');
    if (!key) return null;
    if (SEGMENT_LABELS[key]) return SEGMENT_LABELS[key];
    const fromWords = translateSnakeCaseWords(key);
    if (fromWords) return fromWords;
    return null;
}

/**
 * 将扁平字段路径翻译为纯中文表头：仅使用最后一级字段名。
 * 例：product.product_information.color → 颜色
 *     product.buybox.price.raw → 文案
 */
function translateColumnHeader(key) {
    const rawKey = String(key || '');
    // 无层级的特殊列（如 _crawl_asin）仍走精确表
    if (!rawKey.includes('.') && EXACT_LABELS[rawKey]) {
        return EXACT_LABELS[rawKey];
    }

    const parts = rawKey.split('.').filter(Boolean);
    if (!parts.length) return rawKey;

    const leaf = parts[parts.length - 1];
    const leafZh = translateSegment(leaf) || translateSnakeCaseWords(leaf);
    if (leafZh) return leafZh;
    return '未命名字段';
}

function buildColumnLabels(columns) {
    const labels = {};
    const used = new Map();
    for (const col of columns) {
        const base = translateColumnHeader(col);
        const count = used.get(base) || 0;
        let label = base;
        if (count > 0) {
            label = `${base}_${count + 1}`;
        }
        used.set(base, count + 1);
        labels[col] = label;
    }
    return labels;
}

module.exports = {
    EXACT_LABELS,
    SEGMENT_LABELS,
    WORD_LABELS,
    translateColumnHeader,
    buildColumnLabels
};
