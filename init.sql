-- Amazon OMC - MySQL 初始化脚本
-- 使用前请先创建数据库: CREATE DATABASE sop_system DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- 然后执行: USE sop_system; 再运行本文件

-- 产品表
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seq VARCHAR(50) DEFAULT NULL,
    asin VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(500) DEFAULT NULL,
    category VARCHAR(100) DEFAULT NULL,
    status VARCHAR(20) DEFAULT '待处理',
    overall_progress DOUBLE DEFAULT 0,
    excel_row INT DEFAULT NULL,
    link_group_id INT DEFAULT NULL COMMENT '关联 ASIN 组 ID，同组产品淘汰分析时合并销量',
    listed_at DATETIME DEFAULT NULL COMMENT '上架日期',
    operating_started_at DATETIME DEFAULT NULL COMMENT '运营开始时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_asin (asin),
    INDEX idx_category (category),
    INDEX idx_status (status),
    INDEX idx_link_group (link_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SOP模块表
CREATE TABLE IF NOT EXISTS sop_modules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SOP子项表
CREATE TABLE IF NOT EXISTS sop_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    module_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    instruction_text TEXT,
    image_url VARCHAR(500) DEFAULT NULL,
    sort_order INT NOT NULL,
    is_data_column TINYINT DEFAULT 0,
    FOREIGN KEY (module_id) REFERENCES sop_modules(id) ON DELETE CASCADE,
    INDEX idx_module (module_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 产品-SOP记录表
CREATE TABLE IF NOT EXISTS product_sop_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    sop_item_id INT NOT NULL,
    status VARCHAR(20) DEFAULT '待处理',
    remark TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_product_item (product_id, sop_item_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (sop_item_id) REFERENCES sop_items(id) ON DELETE CASCADE,
    INDEX idx_product (product_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 应用设置表
CREATE TABLE IF NOT EXISTS app_settings (
    `key` VARCHAR(100) PRIMARY KEY,
    value TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 年度活动（按年、按月维护活动与执行要点）
CREATE TABLE IF NOT EXISTS annual_activities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    year INT NOT NULL,
    month TINYINT NOT NULL,
    activity_title VARCHAR(500) DEFAULT NULL,
    action_plan TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_year_month (year, month),
    INDEX idx_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 产品版本快照表（用于记录某个时间点的产品所有SOP内容，允许后续修改）
CREATE TABLE IF NOT EXISTS product_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    version_number INT NOT NULL,
    version_name VARCHAR(200) DEFAULT NULL,
    snapshot_data LONGTEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY uk_product_version (product_id, version_number),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 竞品表（用于记录竞品品牌与亚马逊商店链接）
CREATE TABLE IF NOT EXISTS competitors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    brand_name VARCHAR(200) NOT NULL,
    brand_category VARCHAR(200) DEFAULT NULL,
    amazon_store_url VARCHAR(1000) DEFAULT NULL,
    status TINYINT DEFAULT 0 comment '0: 正常, 1: 已下架',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_brand_name (brand_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS competitor_actions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    competitor_id INT NOT NULL,
    action_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
    INDEX idx_competitor_created (competitor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS competitor_monitor_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    competitor_id INT NOT NULL,
    image_url VARCHAR(1000) NOT NULL,
    has_change TINYINT DEFAULT 0 COMMENT '0: 无变化, 1: 有变化',
    action_text TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
    INDEX idx_competitor_monitor_created (competitor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(200) DEFAULT NULL,
    must_change_password TINYINT DEFAULT 0 COMMENT '1: 首次登录须改密',
    role ENUM('OPS','DESIGN','MANAGER') NOT NULL DEFAULT 'OPS',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_name (name),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 碎碎念
CREATE TABLE IF NOT EXISTS daily_rants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    content LONGTEXT,
    rant_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_rant_date (rant_date),
    INDEX idx_user_date (user_id, rant_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sprint_projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asin VARCHAR(30) NOT NULL,
    owner_id INT DEFAULT NULL,
    status ENUM('ACTIVE','MAINTENANCE','STOPPED') NOT NULL DEFAULT 'ACTIVE',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_cycle_days DECIMAL(10,2) NOT NULL DEFAULT 14.00 COMMENT '目标周期天数(可为小数)',
    current_daily_orders DECIMAL(10,4) DEFAULT NULL COMMENT '当前日均单量(可为小数)',
    target_daily_orders DECIMAL(10,4) DEFAULT NULL COMMENT '目标日均单量(可为小数)',
    current_rank INT DEFAULT NULL,
    target_rank INT DEFAULT NULL,
    promo_tacos_limit DECIMAL(10,2) DEFAULT NULL,
    stable_tacos_target DECIMAL(10,2) DEFAULT NULL,
    max_loss_7d DECIMAL(10,2) DEFAULT NULL,
    inventory_days INT DEFAULT NULL,
    competitor_action TEXT,
    page_ok TINYINT DEFAULT 0,
    exit_conditions TEXT,
    profit_margin DECIMAL(6,2) DEFAULT NULL,
    acos_limit DECIMAL(10,2) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sprint_asin (asin),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS weekly_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sprint_id INT NOT NULL,
    week_start_date DATE NOT NULL,
    status ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
    actual_max_loss DECIMAL(10,2) DEFAULT NULL,
    actual_tacos DECIMAL(10,2) DEFAULT NULL,
    decision ENUM('CONTINUE','MAINTENANCE','STOPPED') DEFAULT NULL,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sprint_week (sprint_id, week_start_date),
    FOREIGN KEY (sprint_id) REFERENCES sprint_projects(id) ON DELETE CASCADE,
    INDEX idx_review_status (status),
    INDEX idx_week (week_start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_asin_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asin VARCHAR(30) NOT NULL,
    record_date DATE NOT NULL,
    data_source ENUM('MANUAL','RPA_BOT') NOT NULL DEFAULT 'MANUAL',
    sessions INT DEFAULT NULL,
    orders INT DEFAULT NULL,
    impressions INT DEFAULT NULL,
    clicks INT DEFAULT NULL,
    ad_spend DECIMAL(12,2) DEFAULT NULL,
    ad_sales DECIMAL(12,2) DEFAULT NULL,
    total_sales DECIMAL(12,2) DEFAULT NULL,
    ad_orders INT DEFAULT NULL,
    core_kw_rank INT DEFAULT NULL,
    bsr_rank INT DEFAULT NULL,
    acos DECIMAL(10,4) DEFAULT NULL,
    tacos DECIMAL(10,4) DEFAULT NULL,
    ctr DECIMAL(10,6) DEFAULT NULL,
    cvr DECIMAL(10,6) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_asin_date (asin, record_date),
    INDEX idx_record_date (record_date),
    INDEX idx_source_date (data_source, record_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS metric_insights (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asin VARCHAR(30) NOT NULL,
    record_date DATE NOT NULL,
    insight_type VARCHAR(50) NOT NULL,
    message VARCHAR(500) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_asin_date (asin, record_date),
    INDEX idx_type (insight_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS issue_tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sprint_id INT DEFAULT NULL,
    asin VARCHAR(30) NOT NULL,
    ticket_type VARCHAR(50) NOT NULL,
    severity ENUM('S','A','B','C') DEFAULT 'B',
    owner_id INT DEFAULT NULL,
    co_owner_id INT DEFAULT NULL,
    status ENUM('TODO','PENDING_DESIGN','WAITING_VERIFY','RESOLVED','FAILED') NOT NULL DEFAULT 'TODO',
    sla_deadline DATETIME DEFAULT NULL,
    trigger_reason TEXT,
    design_request TEXT,
    design_asset_url VARCHAR(1000) DEFAULT NULL,
    verify_evidence TEXT,
    verify_file_url VARCHAR(1000) DEFAULT NULL,
    resolved_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sprint_id) REFERENCES sprint_projects(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (co_owner_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status_deadline (status, sla_deadline),
    INDEX idx_asin_created (asin, created_at),
    INDEX idx_sprint (sprint_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 知识库文档
CREATE TABLE IF NOT EXISTS knowledge_docs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    content LONGTEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SearchAPI Token 池
CREATE TABLE IF NOT EXISTS searchapi_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    label VARCHAR(100) DEFAULT NULL,
    status ENUM('active','exhausted','disabled') NOT NULL DEFAULT 'active',
    last_used_at DATETIME DEFAULT NULL,
    fail_count INT NOT NULL DEFAULT 0,
    last_error VARCHAR(500) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_last_used (last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ASIN 爬取任务
CREATE TABLE IF NOT EXISTS asin_crawl_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    amazon_domain VARCHAR(50) NOT NULL DEFAULT 'amazon.com',
    total_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    fail_count INT NOT NULL DEFAULT 0,
    created_by INT DEFAULT NULL,
    error_message VARCHAR(1000) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME DEFAULT NULL,
    finished_at DATETIME DEFAULT NULL,
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ASIN 爬取明细
CREATE TABLE IF NOT EXISTS asin_crawl_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    asin VARCHAR(10) NOT NULL,
    status ENUM('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
    raw_json JSON DEFAULT NULL,
    flat_json JSON DEFAULT NULL,
    error_message VARCHAR(500) DEFAULT NULL,
    token_id INT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME DEFAULT NULL,
    INDEX idx_job (job_id),
    INDEX idx_job_status (job_id, status),
    INDEX idx_asin (asin),
    FOREIGN KEY (job_id) REFERENCES asin_crawl_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (token_id) REFERENCES searchapi_tokens(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ASIN 当日爬取缓存
CREATE TABLE IF NOT EXISTS asin_crawl_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asin VARCHAR(10) NOT NULL,
    amazon_domain VARCHAR(50) NOT NULL DEFAULT 'amazon.com',
    cache_date DATE NOT NULL,
    raw_json JSON NOT NULL,
    flat_json JSON NOT NULL,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_asin_domain_day (asin, amazon_domain, cache_date),
    INDEX idx_cache_date (cache_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 初始化数据：12个模块，171项SOP子项
-- ============================================

INSERT INTO sop_modules (sort_order, name) VALUES
(1, '基础信息'),
(2, '评价管理'),
(3, '竞品分析'),
(4, '文案和关键词优化'),
(5, '广告管理'),
(6, '站外推广'),
(7, '关联流量'),
(8, '促销流量'),
(9, '产品属性优化'),
(10, '视觉优化'),
(11, '其它');

-- 基础信息 (模块ID=1)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(1, '产品分类', '产品所属分类', 1, 1),
(1, 'ASIN', '', 2, 1),
(1, '产品名称', '', 3, 1),
(1, '运营情况', '当前运营进度状态', 4, 1),
(1, '已完成百分比', '', 5, 1),
(1, '评价管理概览', '快速查看评价数据', 6, 0);

-- 评价管理 (模块ID=2)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(2, '更新时间', '', 7, 1),
(2, '星级', '', 8, 1),
(2, '评分数', '', 9, 1),
(2, 'VINE评分', '', 10, 1),
(2, '直评', '', 11, 1),
(2, '首页差评', '', 12, 1),
(2, 'VINE年龄设置', '产品做VINE之前先不要在标题和五点上把产品的适用年龄定得太泛（而是定准确且保守的适用年龄），婴儿产品不用。', 13, 0),
(2, '注册VINE', '产品上架第一时间做VINE', 14, 0),
(2, '收集无评星产品做直评', '收集所有无评星或评星小于4的产品来做直评', 15, 0),
(2, '扩展VINE人群范围', 'VINE之后将人群范围扩展，比如年龄范围写大一点', 16, 0),
(2, '拆分差评变体', '把差评多且影响listing评分的变体拆出来避免因评分差影响其它变体影响转化', 17, 0),
(2, 'AI分析产品评价', '用AI工具分析更多产品评价，找产品痛点、焦虑点', 18, 0),
(2, '分析客户爽点', '分析客户爽点', 19, 0),
(2, '痛爽点转卖点', '把痛点和爽点转换为产品的卖点（把痛点和爽点投喂给GPT后让GPT帮改标题五点，改图片A+）', 20, 0),
(2, '放大客户焦虑打法', '问GPT:这个产品___,五点和图片是___,怎样让客人的焦虑点转换为产品卖点，给出可执行的行动步骤：P(焦虑) → R(安抚) → P(证据) → A(行动)', 21, 0),
(2, '焦虑打法补充', '屏幕时间、发育落后、安全材质、呛咽、清洁卫生、耐用度等焦虑点，每条都要在标题/主图/五点/A+、视频、QA、客服话术里找到安抚点', 22, 0),
(2, '做售后卡片/明信片', '为此产品做售后卡片，明信片，以避免后继的中差评问题', 23, 0),
(2, 'VINE刷评', '使服务商做VINE或用刷单不留评安全刷单法', 24, 0),
(2, '埋入竞品出单精准长尾词', '把主要出单词或从广告洞察找到3个搜索量中等的竞品出单精准长尾词，埋入listing里（五点描述和ST里）添加其权重', 25, 0);

-- 竞品分析 (模块ID=3)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(3, '更新时间', '', 26, 1),
(3, '竞品数量', '', 27, 1),
(3, '收藏竞品到欧鹭', '把收集到的竞品收藏到欧鹭里，并每周每月去看竞品的变化情况', 28, 0),
(3, '新品首页竞品分析', '对新品/首页新品进行竞品分析', 29, 0),
(3, '反查优秀产品关键词', '反查前三项购买率大于1000转化率大于15%的产品的所有优秀有流量的关键词并进入我们的LISTING里面', 30, 0),
(3, '反查自己的LISTING', '反查自己的LISTING的关键词，以查漏补缺，把自己的ASIN当作竞品来反差', 31, 0),
(3, '亲自把玩产品', '把产品亲自把玩一遍以熟悉产品功能卖点', 32, 0),
(3, '竞品差距分析', '挑几个ASIN找出我司ASIN和竞品的差距并提出修改意见', 33, 0),
(3, 'GPT挖掘意外卖点', '把意想不到的产品卖点、受众、用途、场景、关键词或其它细节等用GPT来问', 34, 0),
(3, 'GPT分析listing改进空间', '将产品前台显示的标题五点图片A+逐个投给GPT做分析：还有什么改进空间。关键词也全部投给他让它补充更多关键词', 35, 0),
(3, '选品扩展', '通过1688，淘宝，亚马逊检查此产品近期新上架的新品/升级换代品', 36, 0),
(3, '做产品视频和图片', '去fivework找人做产品视频和新的一套图片', 37, 0),
(3, '竞品工具分析', '竞品分析：用工具（sif/js/卖家精灵/H10）或竞品分析表做分析', 38, 0),
(3, '检查关键词排名', '检查前10名的关键词排名并具体列出每个关键词的排名位置（自然位及广告位）', 39, 0);

-- 文案和关键词优化 (模块ID=4)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(4, '更新时间', '', 40, 1),
(4, '广告出单词', '', 41, 1),
(4, '主打词', '', 42, 1),
(4, '标题', '', 43, 1),
(4, '五点描述', '', 44, 1),
(4, '收集品牌分析关键词', '针对每个产品，在品牌分析页面的关键词收集和整理并用于开广告', 45, 0),
(4, '按RUFUS和COSMO算法优化', '按RUFUS和COSMO的算法解释来优化listing', 46, 0),
(4, '扩展100+关键词', '扩展100个以上的相关关键词用于开广告', 47, 0),
(4, '广告出单词加入ST', '把广告出单词加入st，或有一定搜索量的加入listing', 48, 0),
(4, '更换主打关键词', '根据数据更换主打关键词', 49, 0),
(4, '标题加入大品牌描述词', '竞品少的新品，在标题中加入大品牌的描述词', 50, 0),
(4, '突出安全性', '突出婴儿/非婴儿产品安全性：加上安全性关键词，加强品牌特性。1材质安全性，2无窒息风险，3有ASTM/CPSIA证书，4设计安全', 51, 0),
(4, 'plastic换成BPA Free', '婴儿塑胶产品：把方案里的plastic换成BPA Free Plastic或Non-Toxic Plastic', 52, 0),
(4, '移动端专属优化', '确保标题前30字符含核心词，五点的前两点能完整显示并能够把产品的主要卖点说清楚；图片文字在手机端清晰可读', 53, 0),
(4, '扩展五点描述', '加多第六第七第八点', 54, 0),
(4, '五点增加使用场景', '五点描述中增加关于产品的更多具体使用场景（适合什么对象，什么场合，什么节日的礼物都要在五点里写清楚出来）', 55, 0),
(4, '节日词/情感词/礼品词', '将节日词、情感词、礼品词等在Listing中可做适当呈现', 56, 0),
(4, '试开广告检查推荐词', '用试开广告的方法检查推荐词是否有不相关的词，如有则优化listing', 57, 0),
(4, '标题五点AB测试', '标题五点做AB测试', 58, 0),
(4, '本地化Listing优化', '针对不同人群（如美国的西班牙语人群）站点（如DE/FR）翻译文案并植入本地搜索习惯词', 59, 0),
(4, 'listing深度再优化', '将listing的图片标题五点全部逐个发给GPT问改进空间', 60, 0),
(4, '婴儿产品QA模板', 'QA不能跳过：婴儿产品在A+新建QA模块加入QA问答：Q1适用年龄疑问, Q2 BPA认证, Q3清洁方法。每条QA给出标准回复模板', 61, 0);

-- 广告管理 (模块ID=5)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(5, '更新时间', '', 62, 1),
(5, '自动广告数据', '曝光和前一个月变化对比', 63, 1),
(5, '手动关键词广告', '曝光和前一个月变化对比', 64, 1),
(5, '海王广告数据', '曝光/点击/花费/转化（曝光和前一个月变化对比）', 65, 1),
(5, '视频广告数据', '曝光/ACOS（曝光和前一个月变化对比）', 66, 1),
(5, '标签打法数据', '曝光和前一个月变化对比', 67, 1),
(5, 'TOS广告数据', '曝光和前一个月变化对比', 68, 1),
(5, 'ASIN广告数据', '曝光和前一个月变化对比', 69, 1),
(5, '闭环互投数据', '曝光和前一个月变化对比', 70, 1),
(5, 'SD广告数据', '曝光和前一个月变化对比', 71, 1),
(5, 'SBC广告数据', '曝光和前一个月变化对比', 72, 1),
(5, '列出广告关键词', '列出此产品所有主要的广告关键词', 73, 1),
(5, '查询广告位稳定情况', '用sif等工具查询这些主要广告关键词的广告位稳定情况', 74, 1),
(5, '开齐所有广告类型', '开齐所有广告类型：ASIN广告、核心词广告、海王、标签、TOS、ROS、类目/跨类目、SP闭环、SD闭环、SBV、SBC、SD定向', 75, 0),
(5, '按卖点开广告', '所有广告类型能按卖点开的都按卖点来开广告，且把所有重要卖点和属性都要开广告', 76, 0),
(5, '多开自动广告', '多开自动广告（10组）并去停掉表现差的自动广告（或优化已开广告）', 77, 0),
(5, '按卖点分组关键词', '通过工具收集关键词并按照属性卖点分类关键词建组，覆盖：使用场景、目标人群、痛点与收益、季节/节日、合规与信任、差异化、组合与增值、情绪/礼品、价格与促销', 78, 0),
(5, '手动精准广告', '把表现好的搜索词做成手动精准：从自动广告、广泛广告的报告里挑出表现好的搜索词做成手动精准，出价要比原来高', 79, 0),
(5, '手动关键词广告优化', '手动关键词广告（或优化已开广告）', 80, 0),
(5, '广告海王打法', '广告海王打法（主力产品先做）（或优化已开广告）', 81, 0),
(5, '标签打法广告', '标签打法广告（或优化已开广告）', 82, 0),
(5, '视频广告', '做视频广告：做出一个别致新颖的推广视频来开广告（或优化已开广告）', 83, 0),
(5, '视频广告VCPM', '开视频广告时除了开点击的方式，都要同时开VCPM的形式（或优化已开广告）', 84, 0),
(5, '节日加大闭环出价', '节日活动前，加大产品流量闭环广告出价', 85, 0),
(5, '关键词上首页TOS', '关键词上首页【TOS广告、冲量关键词法】（或优化已开广告）', 86, 0),
(5, '50+词TOS广告', '每个出单品做50个以上相关词的TOS广告', 87, 0),
(5, 'ASIN广告加竞品', '将首页的竞品加入到ASIN广告（或检查已有的对应广告的表现效果并做优化）', 88, 0),
(5, '多做ASIN广告', '多做ASIN广告：找同款或相似相搭配的产品来做产品广告（或优化已开广告）', 89, 0),
(5, '类目跨类目广告', '开类目、跨类目广告（或优化已开广告）', 90, 0),
(5, '细化类目广告', '用新的方式--细化开类目、跨类目广告（或优化已开广告）', 91, 0),
(5, '受众TV广告', '对比较有特色或很吸引人的产品做SD受众广告和TV广告（耗费比较高，慎做）', 92, 0),
(5, '新品改为提升与降低', '新品凡是有经常出单，或有大量出单希望的，或广告效果好的，出价策略改为提升与降低', 93, 0),
(5, '按销售速度调预算', '按销售速度调广告分组的预算（和转移广告活动一起体系）', 94, 0),
(5, '不断否定不相关词', '不断否定广告跑出来的不相关词或ASIN商品（每次至少否定5-20个词或ASIN）', 95, 0),
(5, '关键词否定新方法', '实操关键词否定新方法：用关键词扩展工具来收集不相关词来否定', 96, 0),
(5, '精美SBV视频', '做一个很吸引人的SBV视频广告来吸引人进入产品页面或进行旗舰店页面', 97, 0),
(5, '提前联想广告方式', '像去年广告加入了情感词广告，夏季产品也要提前通过GPT多联想广告方式和广告词，以在黑五期间获取更高曝光', 98, 0),
(5, '小词精准广告', '扩展一些小词开精准广告并拿AC（或检查已有的对应广告的表现效果并做优化）', 99, 0),
(5, '万物皆可检检漏广告', '用"万物皆可检"打法做各个产品的检漏广告（低价高广告位的方法开够500个以上的广告词）', 100, 0),
(5, '低价自动广告', '开低价自动广告（四种匹配全开）（自动海王广告）', 101, 0),
(5, '广告曝光打法', '做"广告曝光打法"提升低曝光量广告的曝光量', 102, 0),
(5, '扩展礼品情感关键词', '扩展礼品类，情感类的关键词', 103, 0),
(5, '按卖点分组重投广告', '按卖点分组广告词重新投放广告', 104, 0),
(5, '大曝光SP加视频', '将曝光量大的SP广告都加上视频提高点击', 105, 0),
(5, '好表现活动移无限额', '把表现好的广告活动从分组里脱离出去移动到无限额的分组', 106, 0),
(5, '分析销量上涨ASIN补库存', '近期销量上涨的ASIN及时分析是否需要增补库存', 107, 0);

-- 站外推广 (模块ID=6)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(6, '更新时间', '', 108, 1),
(6, '站外站点', '', 109, 1),
(6, 'RebateKey', '', 110, 1),
(6, 'SNAGSHOUT', '', 111, 1),
(6, 'Rebaid', '', 112, 1),
(6, '上传rebatekey', '上传产品到rebatekey平台', 113, 0),
(6, '上传Snagshout', '上传产品到snagshout平台', 114, 0),
(6, '上传Rebaid', '上传产品到rebaid平台', 115, 0),
(6, '服务商站外推广', '通过服务商进行站外推广', 116, 0),
(6, '秒杀后站外维持', '秒杀后的第二天安排一场站外以维持排名和销量', 117, 0);

-- 关联流量 (模块ID=7)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(7, '更新时间', '', 118, 1),
(7, '已A+关联', '', 119, 1),
(7, 'POST计划表', '', 120, 1),
(7, 'A+关联引流', '做好A+关联，通过关联页面引流', 121, 0),
(7, '做POST', '发帖做POST增加曝光', 122, 0),
(7, '合并变体', '合并变体集中流量', 123, 0),
(7, '旗舰店横幅宣告', '新品上架后让美工做旗舰店首页的横幅在旗舰店宣告', 124, 0),
(7, '独立站Google Ads', '独立站投放广告：Google Ads广告，投放品牌词或产品关键词等，导流至亚马逊Listing', 125, 0),
(7, '独立站+社交多平台发布', '产品上架前，第一时间在独立站上传和发布，并让美工发布图文或视频到YouTube, X, FB, IG, Pinterest, TK等平台', 126, 0),
(7, '加入内容创作者计划', '把产品加入亚马逊内容创作者计划', 127, 0),
(7, '做虚拟捆绑', '做虚拟捆绑增加关联', 128, 0),
(7, '像素级属性对标', '蹭大卖流量：极致的"像素级"属性对标，确保类目节点完全一致，核心属性高度重合，放到同一个对比栏里吸走流量', 129, 0);

-- 促销流量 (模块ID=8)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(8, '更新时间', '', 130, 1),
(8, '秒杀推荐', '', 131, 1),
(8, '有无参考价', '', 132, 1),
(8, '竞品价格分析', '竞品价格分析，把竞品的最高价、最低价、平均做统计并总结我们的价格是否有竞争力和是否需要调价', 133, 0),
(8, '检查PRIME折扣和优惠券', '检查产品是否能做PRIME折扣和优惠券', 134, 0),
(8, '品牌定制促销', '做品牌定制促销', 135, 0),
(8, '购物车优惠券', '为产品设置购物车优惠券，使加购而不购买者回购', 136, 0),
(8, '设置目标价', '设置目标价（使其达20%利润）：算广告费/不算广告费', 137, 0),
(8, '设置优惠券', '设置优惠券，30美元以上开启降具体金额而不是百分比', 138, 0),
(8, '积极申报BD,LD做WOOT', '积极申报BD,LD，做WOOT秒杀', 139, 0),
(8, '买一送一带动销量', '对多选项产品通过买一送一活动把其它选项的销量带起来，类似做引流款', 140, 0),
(8, '企业价格和批发价格', '填写企业价格和设置好批发价格（数量折扣）', 141, 0),
(8, '螺旋打法提升出单', '用"螺旋打法"提升产品出单量—螺旋打法一个季度内至少做4次', 142, 0),
(8, '利润分析', '结合实际的推广费用及其它杂费，做一次具体的利润分析', 143, 0),
(8, '设置引流款和利润款', '设置引流款和利润款', 144, 0),
(8, '9.99美元引流打法', '9.99美元引流打法', 145, 0),
(8, '参考价/GIFT选项/最大订单数量', '参考价，GIFT选项、最大订单数量填写', 146, 0),
(8, '多站点同步', '把夏季产品用上传表格的方式手动同步到墨西哥和加拿大站并在墨加站设置好折扣（欧洲同步到小站点）', 147, 0);

-- 产品属性优化 (模块ID=9)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(9, '优化产品属性', '通过填写完整的产品属性（如适用年龄、材质、安全认证等），提高列表的相关性，让RUFUS更容易收录', 148, 0);

-- 视觉优化 (模块ID=10)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(10, '更新时间', '', 149, 1),
(10, '转化率/浏览量/点击量', '查看产品的转化率，浏览量，点击量等数据', 150, 1),
(10, '视频数量及顺序', '', 151, 1),
(10, '视频标题', '', 152, 1),
(10, '分析转化差原因', '分析转化差，点击量低的原因，并提出改进措施', 153, 0),
(10, '主图不符合美国审美优化', '把不符合美国审美的主图做个任务给美工做优化', 154, 0),
(10, '卖点广告视频方案', '专门针对2个以上的重点卖点做不同的广告视频方案给美工做视频并将视频应用去开广告', 155, 0),
(10, '国外风格图片方案', '参考国外卖家相似产品的图片风格A+风格做一套更符合国外审美的图片方案', 156, 0),
(10, '美化主图', '美化主图，找更好的主图方案', 157, 0),
(10, '主图加季节元素', '主图能加上夏季元素的尽量加上去（新品，出单极少产品可考虑在主图上加上圣诞元素）', 158, 0),
(10, '灵魂拷问广告视频开头', '做一个灵魂拷问的广告视频开头(痛点打法、焦虑打法的延伸)：15s/30s脚本模板', 159, 0),
(10, '主图/视频安全焦虑打法', '主图/视频安全焦虑打法：开场MOUTH-SAFE CHECK + 跌落耐摔镜头 + 宝宝玩耍 + CTA', 160, 0),
(10, '红人视频', '安排红人拍摄产品使用视频', 161, 0),
(10, 'GPT图片优化', '结合GPT进行图片优化：主图和附图A+', 162, 0),
(10, '附图更新到最新版', '附图更新到最新版', 163, 0),
(10, 'A+更新到最新版', 'A+更新到最新版', 164, 0),
(10, '主附图AB测试', '主附图做AB测试', 165, 0),
(10, '品牌感染力视频', '为此产品做一个精美且更多生活使用场景且更有品牌感染力的视频', 166, 0),
(10, '5种视频类型', '安排美工做够5种视频：产品细节展示视频，场景视频（红人视频），无人自动的逐帧动画视频，图文介绍视频', 167, 0),
(10, '持续添加够5个视频', '持续把产品添加够5个视频', 168, 0),
(10, 'GPT重做主图场景图', '让GPT重新做一版主图和场景图，有重要卖点，场景图也要突出重要卖点', 169, 0);

-- 其它 (模块ID=11)
INSERT INTO sop_items (module_id, name, instruction_text, sort_order, is_data_column) VALUES
(11, '更新时间', '', 170, 1),
(11, '减少低效产品投入', '把不打算继续投放时间运营的产品减少广告投入--减bid减预算', 171, 0);
