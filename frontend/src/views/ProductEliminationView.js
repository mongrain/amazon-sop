import { computed, ref } from 'vue';
import { getApiError, http, fmtDateTime, computeOperatingDays } from '@/utils/index.js';

function formatMoney(value) {
    if (value == null || Number.isNaN(value)) return '—';
    return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value, suffix = '%') {
    if (value == null || Number.isNaN(value)) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value}${suffix}`;
}

function trendClass(value, invert = false) {
    if (value == null || Number.isNaN(value) || value === 0) return 'trend-flat';
    const positive = invert ? value < 0 : value > 0;
    return positive ? 'trend-up' : 'trend-down';
}

function amazonDpUrl(asin) {
    if (!asin) return '#';
    return 'https://www.amazon.com/dp/' + encodeURIComponent(asin);
}

const STATUS_OPTIONS = ['待处理', '进行中', '已完成', '跳过', '已放弃'];

export default {
    name: 'ProductEliminationView',
    setup() {
        const fileInput = ref(null);
        const selectedFile = ref(null);
        const loading = ref(false);
        const error = ref('');
        const result = ref(null);
        const expandedAsin = ref(null);
        const filterStore = ref('');
        const filterAsin = ref('');
        const salesSort = ref('desc');
        const fetchingOperatingDays = ref(false);
        const operatingDaysFetchMsg = ref('');

        function formatOperatingDays(startedAt) {
            const days = computeOperatingDays(startedAt);
            return days != null ? `${days} 天` : '—';
        }

        const summary = computed(() => {
            if (!result.value) return null;
            return {
                totalOrders: result.value.totalOrders,
                totalProducts: result.value.totalProducts,
                catalogProductCount: result.value.catalogProductCount,
                withOrdersCount: result.value.withOrdersCount,
                withoutOrdersCount: result.value.withoutOrdersCount,
                sites: result.value.sites || result.value.stores || [],
                sourceFile: result.value.sourceFile,
                dataDateRange: result.value.dataDateRange,
                periodLabel: result.value.periodLabel,
                skippedCanceled: result.value.skippedCanceled,
                skippedNonUsChannel: result.value.skippedNonUsChannel,
                skippedUnmappedStore: result.value.skippedUnmappedStore,
                importFormatLabel: result.value.importFormatLabel,
                salesChannel: result.value.salesChannel
            };
        });

        const siteOptions = computed(() => {
            if (!result.value?.sites) return result.value?.stores || [];
            return [...result.value.sites].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        });

        const filteredResults = computed(() => {
            if (!result.value?.results) return [];
            let rows = [...result.value.results];

            if (filterStore.value) {
                rows = rows.filter(row => row.site === filterStore.value || row.store === filterStore.value);
            }

            const asinQuery = filterAsin.value.trim().toUpperCase();
            if (!asinQuery) {
                rows = rows.filter(row => row.productStatus !== '已放弃');
            } else {
                rows = rows.filter(row => {
                    const asinPool = [
                        row.asin,
                        ...(row.linkGroupAsins || []),
                        ...(row.relatedAsins || [])
                    ].map(a => String(a || '').toUpperCase());
                    return asinPool.some(a => a.includes(asinQuery));
                });
            }

            const dir = salesSort.value === 'asc' ? 1 : -1;
            rows.sort((a, b) => {
                const aAbandoned = a.productStatus === '已放弃' ? 1 : 0;
                const bAbandoned = b.productStatus === '已放弃' ? 1 : 0;
                if (aAbandoned !== bAbandoned) return aAbandoned - bAbandoned;
                return dir * ((a.groupSalesAmount ?? a.salesAmount ?? 0) - (b.groupSalesAmount ?? b.salesAmount ?? 0));
            });
            return rows;
        });

        const hasActiveFilters = computed(() => Boolean(filterStore.value || filterAsin.value.trim()));

        function resetFilters() {
            filterStore.value = '';
            filterAsin.value = '';
            salesSort.value = 'desc';
        }

        function clearFilters() {
            resetFilters();
        }

        function onFileChange(e) {
            const file = e.target.files && e.target.files[0];
            selectedFile.value = file || null;
            error.value = '';
        }

        function clearFile() {
            selectedFile.value = null;
            if (fileInput.value) fileInput.value.value = '';
        }

        function toggleExpand(asin) {
            expandedAsin.value = expandedAsin.value === asin ? null : asin;
        }

        function updateProductStatus(row, status) {
            if (!row?.asin || !row.productStatus) return;
            http.patch('/api/product/' + encodeURIComponent(row.asin), { status })
                .then(() => {
                    row.productStatus = status;
                })
                .catch(e => {
                    alert(getApiError(e, '状态更新失败'));
                });
        }

        async function analyze() {
            if (!selectedFile.value) {
                error.value = '请先选择订单文件（TXT 或 Excel）';
                return;
            }
            error.value = '';
            loading.value = true;
            result.value = null;
            expandedAsin.value = null;
            resetFilters();

            try {
                const form = new FormData();
                form.append('file', selectedFile.value);
                const { data } = await http.post('/api/product-elimination/analyze', form, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                result.value = data;
            } catch (e) {
                error.value = getApiError(e, '分析失败');
            } finally {
                loading.value = false;
            }
        }

        async function analyzeSample(format) {
            error.value = '';
            loading.value = true;
            result.value = null;
            expandedAsin.value = null;
            resetFilters();
            selectedFile.value = null;
            if (fileInput.value) fileInput.value.value = '';

            try {
                const { data } = await http.post('/api/product-elimination/analyze-sample', { format });
                result.value = data;
            } catch (e) {
                error.value = getApiError(e, '示例分析失败');
            } finally {
                loading.value = false;
            }
        }

        async function fetchAllOperatingDays() {
            if (!confirm('将为所有未放弃产品加入运营天数抓取队列（约每 5 秒 1 条），确认继续？')) return;
            operatingDaysFetchMsg.value = '';
            fetchingOperatingDays.value = true;
            try {
                const { data } = await http.post('/api/operating-days/fetch-all');
                operatingDaysFetchMsg.value = `已加入队列 ${data.enqueued ?? 0} 个产品${data.skipped ? `，${data.skipped} 个已有运营开始日期已跳过` : ''}，后台抓取中`;
            } catch (e) {
                operatingDaysFetchMsg.value = getApiError(e, '抓取任务提交失败');
            } finally {
                fetchingOperatingDays.value = false;
            }
        }

        return {
            fileInput,
            selectedFile,
            loading,
            error,
            result,
            summary,
            expandedAsin,
            filterStore,
            filterAsin,
            salesSort,
            fetchingOperatingDays,
            operatingDaysFetchMsg,
            siteOptions,
            filteredResults,
            hasActiveFilters,
            clearFilters,
            onFileChange,
            clearFile,
            analyze,
            analyzeSample,
            fetchAllOperatingDays,
            formatOperatingDays,
            toggleExpand,
            updateProductStatus,
            amazonDpUrl,
            statusOptions: STATUS_OPTIONS,
            formatMoney,
            formatPct,
            trendClass,
            fmtDateTime
        };
    },
    template: `<div class="page-header elimination-page-header">
                <div>
                    <h1>产品淘汰分析</h1>
                    <p class="page-subtitle">支持 Amazon 订单 TXT 与领星订单 Excel 两种格式，按站点列出产品库中非已放弃产品并覆盖订单数据</p>
                </div>
                <div class="elimination-header-actions">
                    <button
                        type="button"
                        class="btn-secondary"
                        :disabled="fetchingOperatingDays"
                        @click="fetchAllOperatingDays"
                    >{{ fetchingOperatingDays ? '提交中…' : '一键抓取运营天数' }}</button>
                </div>
            </div>
            <p v-if="operatingDaysFetchMsg" class="elimination-meta">{{ operatingDaysFetchMsg }}</p>

            <div class="elimination-upload-card module-card">
                <div class="module-body">
                    <div class="elimination-upload-row">
                        <div class="elimination-form-group">
                            <label>订单文件</label>
                            <input ref="fileInput" type="file" accept=".txt,.xlsx,.xls" @change="onFileChange" />
                            <p class="elimination-hint">
                                格式一：Amazon 后台导出的 Tab 分隔 TXT（仅分析 sales-channel = Amazon.com）<br />
                                格式二：领星等导出的 Excel（含店铺、ASIN、订购日期、销售额(Item Price) 等字段）
                            </p>
                        </div>
                        <div class="elimination-upload-actions elimination-upload-actions-stack">
                            <div class="elimination-sample-btns">
                                <button type="button" class="btn-secondary" :disabled="loading" @click="analyzeSample('amazon-txt')">
                                    示例 TXT
                                </button>
                                <button type="button" class="btn-secondary" :disabled="loading" @click="analyzeSample('lingxing-excel')">
                                    示例 Excel
                                </button>
                            </div>
                            <button type="button" class="btn-secondary" :disabled="!selectedFile" @click="clearFile">清除</button>
                            <button type="button" class="btn-primary" :disabled="loading || !selectedFile" @click="analyze">
                                {{ loading ? '分析中…' : '开始分析' }}
                            </button>
                        </div>
                    </div>
                    <div v-if="selectedFile" class="elimination-file-name">已选择：{{ selectedFile.name }}</div>
                    <div v-if="error" class="elimination-alert elimination-alert-error">{{ error }}</div>
                </div>
            </div>

            <div v-if="summary" class="stats-bar">
                <div class="stat-card">
                    <div class="stat-number">{{ summary.totalProducts }}</div>
                    <div class="stat-label">产品库产品</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number success">{{ summary.withOrdersCount }}</div>
                    <div class="stat-label">有卖出订单</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number warning">{{ summary.withoutOrdersCount }}</div>
                    <div class="stat-label">无卖出订单</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number info">{{ summary.sites.length }}</div>
                    <div class="stat-label">涉及站点</div>
                </div>
            </div>
            <p v-if="summary && summary.dataDateRange" class="elimination-meta">
                <span v-if="summary.sourceFile">数据源：{{ summary.sourceFile }}</span>
                <span v-if="summary.dataDateRange.min"> · 订单区间：{{ summary.dataDateRange.min }} ~ {{ summary.dataDateRange.max }}</span>
                <span v-if="summary.periodLabel"> · {{ summary.periodLabel }}</span>
                <span v-if="summary.importFormatLabel"> · 导入格式：{{ summary.importFormatLabel }}</span>
                <span v-if="summary.salesChannel"> · 分析渠道：{{ summary.salesChannel }}</span>
                <span v-if="summary.skippedCanceled"> · 已排除取消订单 {{ summary.skippedCanceled }} 条</span>
                <span v-if="summary.skippedNonUsChannel"> · 已排除非美国站订单 {{ summary.skippedNonUsChannel }} 条</span>
                <span v-if="summary.skippedUnmappedStore"> · 未匹配产品库站点订单 {{ summary.skippedUnmappedStore }} 条</span>
            </p>

            <div v-if="result" class="elimination-result-card module-card">
                <div class="module-header" style="cursor:default;">
                    <div class="module-name">分析结果</div>
                    <span class="elimination-result-count">显示 {{ filteredResults.length }} / {{ result.results.length }} 条</span>
                </div>
                <div class="module-body">
                    <div class="elimination-filter-bar search-form">
                        <select v-model="filterStore" class="filter-select elimination-filter-store">
                            <option value="">全部站点</option>
                            <option v-for="site in siteOptions" :key="site" :value="site">{{ site }}</option>
                        </select>
                        <input
                            v-model="filterAsin"
                            type="text"
                            class="search-input elimination-filter-asin"
                            placeholder="筛选 ASIN"
                        />
                        <select v-model="salesSort" class="filter-select">
                            <option value="desc">组销售额：从高到低</option>
                            <option value="asc">组销售额：从低到高</option>
                        </select>
                        <button
                            v-if="hasActiveFilters"
                            type="button"
                            class="btn-secondary"
                            @click="clearFilters"
                        >清除筛选</button>
                    </div>
                    <div v-if="!filteredResults.length" class="elimination-empty">没有符合筛选条件的产品</div>
                    <div v-else class="table-container">
                        <table class="product-table elimination-table">
                            <thead>
                                <tr>
                                    <th>站点</th>
                                    <th>排名</th>
                                    <th>ASIN</th>
                                    <th>关联 ASIN</th>
                                    <th>标题</th>
                                    <th>产品状态</th>
                                    <th>运营天数</th>
                                    <th>卖出情况</th>
                                    <th>销售额</th>
                                    <th>组销售额</th>
                                    <th>占比</th>
                                    <th>毛利贡献</th>
                                    <th>下半段增长</th>
                                    <th>90天增长</th>
                                    <th>自然单占比</th>
                                    <th>TACOS</th>
                                    <th>ACOS</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                <template v-for="row in filteredResults" :key="row.site + '-' + row.asin">
                                    <tr class="elimination-row" :class="{ 'elimination-row-no-order': !row.hasOrders }" @click="toggleExpand(row.site + row.asin)">
                                        <td>{{ row.site }}</td>
                                        <td><span class="elimination-rank">#{{ row.salesRank }}</span></td>
                                        <td @click.stop>
                                            <a :href="amazonDpUrl(row.asin)" target="_blank" rel="noopener noreferrer"><code>{{ row.asin }}</code></a>
                                        </td>
                                        <td class="elimination-related-cell" @click.stop>
                                            <template v-if="row.relatedAsins && row.relatedAsins.length">
                                                <template v-for="(ra, idx) in row.relatedAsins" :key="ra">
                                                    <a :href="amazonDpUrl(ra)" target="_blank" rel="noopener noreferrer"><code>{{ ra }}</code></a><span v-if="idx < row.relatedAsins.length - 1">, </span>
                                                </template>
                                            </template>
                                            <span v-else>—</span>
                                        </td>
                                        <td class="elimination-title-cell">{{ row.title || '—' }}</td>
                                        <td @click.stop>
                                            <select
                                                v-if="row.productStatus"
                                                class="status-select px-2 py-0.5 text-xs"
                                                :value="row.productStatus"
                                                @change="updateProductStatus(row, $event.target.value)"
                                            >
                                                <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
                                            </select>
                                            <span v-else class="elimination-note">不在产品库</span>
                                        </td>
                                        <td class="elimination-operating-days">{{ formatOperatingDays(row.operatingStartedAt) }}</td>
                                        <td>
                                            <span v-if="row.hasOrders" class="elimination-has-order">有订单</span>
                                            <span v-else class="elimination-no-order">无卖出订单</span>
                                        </td>
                                        <td>{{ row.hasOrders ? formatMoney(row.salesAmount) : '—' }}</td>
                                        <td>
                                            <span v-if="row.relatedAsins && row.relatedAsins.length">{{ formatMoney(row.groupSalesAmount) }}</span>
                                            <span v-else>{{ row.hasOrders ? formatMoney(row.groupSalesAmount) : '—' }}</span>
                                        </td>
                                        <td>{{ row.salesSharePct != null ? row.salesSharePct + '%' : '—' }}</td>
                                        <td>
                                            <span v-if="row.costError" class="elimination-cost-error">{{ row.costError }}</span>
                                            <span v-else>{{ formatMoney(row.grossProfitContribution) }}</span>
                                        </td>
                                        <td :class="trendClass(row.growth.sales30d.changePct)">
                                            {{ formatPct(row.growth.sales30d.changePct) }}
                                        </td>
                                        <td :class="trendClass(row.growth.sales90d.changePct)">
                                            {{ formatPct(row.growth.sales90d.changePct) }}
                                        </td>
                                        <td>
                                            {{ row.growth.organicRatio.current != null ? row.growth.organicRatio.current + '%' : '—' }}
                                            <span v-if="row.growth.organicRatio.changePct != null" :class="trendClass(row.growth.organicRatio.changePct)">
                                                ({{ formatPct(row.growth.organicRatio.changePct, 'pp') }})
                                            </span>
                                        </td>
                                        <td>{{ row.adScaling.tacos != null ? (row.adScaling.tacos * 100).toFixed(1) + '%' : '—' }}</td>
                                        <td>{{ row.adScaling.acos != null ? (row.adScaling.acos * 100).toFixed(1) + '%' : '—' }}</td>
                                        <td class="elimination-expand-icon">{{ expandedAsin === row.site + row.asin ? '▼' : '▶' }}</td>
                                    </tr>
                                    <tr v-if="expandedAsin === row.site + row.asin" class="elimination-detail-row">
                                        <td colspan="18">
                                            <div class="elimination-detail-grid">
                                                <div class="elimination-detail-section">
                                                    <h4>销售与毛利</h4>
                                                    <ul>
                                                        <li>站点：{{ row.site }}</li>
                                                        <li v-if="row.orderStores && row.orderStores.length">订单店铺：{{ row.orderStores.join('、') }}</li>
                                                        <li>运营天数：{{ formatOperatingDays(row.operatingStartedAt) }}</li>
                                                        <li>卖出情况：{{ row.hasOrders ? '有订单' : '无卖出订单' }}</li>
                                                        <li>订单数量：{{ row.hasOrders ? row.orderCount : 0 }}</li>
                                                        <li>店铺销售额占比：{{ row.salesSharePct != null ? row.salesSharePct + '%' : '—' }}</li>
                                                        <li>毛利（估算）：{{ row.costError ? row.costError : formatMoney(row.grossProfit) }}</li>
                                                        <li v-if="row.cost">成本：¥{{ row.cost.costPriceRmb ?? '—' }} / \${{ row.cost.costPriceUsd ?? '—' }}</li>
                                                    </ul>
                                                </div>
                                                <div class="elimination-detail-section">
                                                    <h4>增长趋势</h4>
                                                    <ul>
                                                        <li>{{ row.growth.sales30d.periodLabel || '近30天' }}销售额：{{ formatMoney(row.growth.sales30d.current) }} vs {{ formatMoney(row.growth.sales30d.previous) }}
                                                            <span :class="trendClass(row.growth.sales30d.changePct)">({{ formatPct(row.growth.sales30d.changePct) }})</span>
                                                        </li>
                                                        <li>{{ row.growth.sales90d.periodLabel || '近90天' }}：
                                                            <template v-if="row.growth.sales90d.note">{{ row.growth.sales90d.note }}</template>
                                                            <template v-else>{{ formatMoney(row.growth.sales90d.current) }} vs {{ formatMoney(row.growth.sales90d.previous) }}
                                                                <span :class="trendClass(row.growth.sales90d.changePct)">({{ formatPct(row.growth.sales90d.changePct) }})</span>
                                                            </template>
                                                        </li>
                                                        <li>同比：
                                                            <template v-if="row.growth.yoyMonth.note">{{ row.growth.yoyMonth.note }}</template>
                                                            <template v-else>
                                                                {{ row.growth.yoyMonth.monthLabel }} vs {{ row.growth.yoyMonth.compareMonthLabel }}：
                                                                {{ formatMoney(row.growth.yoyMonth.current) }} vs {{ formatMoney(row.growth.yoyMonth.previous) }}
                                                                <span :class="trendClass(row.growth.yoyMonth.changePct)">({{ formatPct(row.growth.yoyMonth.changePct) }})</span>
                                                            </template>
                                                        </li>
                                                        <li>自然单占比：{{ row.growth.organicRatio.current ?? '—' }}% → 前30天 {{ row.growth.organicRatio.previous ?? '—' }}%</li>
                                                        <li>关键词排名：{{ row.keywordRank.current ?? '—' }} vs {{ row.keywordRank.previous ?? '—' }}
                                                            <span v-if="row.keywordRank.change != null" :class="trendClass(row.keywordRank.change, true)">
                                                                ({{ row.keywordRank.change > 0 ? '+' : '' }}{{ row.keywordRank.change }})
                                                            </span>
                                                            <span v-if="row.keywordRank.note"> — {{ row.keywordRank.note }}</span>
                                                        </li>
                                                    </ul>
                                                </div>
                                                <div class="elimination-detail-section">
                                                    <h4>广告放量能力</h4>
                                                    <ul>
                                                        <li>SP ACOS：{{ row.adScaling.acos != null ? (row.adScaling.acos * 100).toFixed(2) + '%' : '—' }}</li>
                                                        <li>TACOS：{{ row.adScaling.tacos != null ? (row.adScaling.tacos * 100).toFixed(2) + '%' : '—' }}</li>
                                                        <li>CTR：{{ row.adScaling.ctr != null ? (row.adScaling.ctr * 100).toFixed(2) + '%' : '—' }}</li>
                                                        <li>CVR：{{ row.adScaling.cvr != null ? (row.adScaling.cvr * 100).toFixed(2) + '%' : '—' }}</li>
                                                        <li>加预算后订单增长：{{ row.adScaling.budgetIncrease.orderGrowthPct != null ? formatPct(row.adScaling.budgetIncrease.orderGrowthPct) : '—' }}
                                                            <span v-if="row.adScaling.budgetIncrease.note" class="elimination-note">（{{ row.adScaling.budgetIncrease.note }}）</span>
                                                        </li>
                                                        <li>加预算后 ACOS 恶化：{{ row.adScaling.budgetIncrease.acosDeteriorated === true ? '是' : row.adScaling.budgetIncrease.acosDeteriorated === false ? '否' : '—' }}</li>
                                                        <li>高转化关键词数：{{ row.adScaling.highConvKeywordCount.note }}</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div v-else-if="!loading" class="elimination-empty module-card">
                <div class="module-body">上传订单 TXT 或 Excel 后点击「开始分析」</div>
            </div>`
};
