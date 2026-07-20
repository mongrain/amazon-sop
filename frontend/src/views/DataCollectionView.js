import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { getApiError, http } from '@/utils/index.js';

const API_BASE = '/api/data-collection';

const STATUS_LABELS = {
    pending: '等待中',
    running: '爬取中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    active: '可用',
    exhausted: '已失效',
    disabled: '已禁用',
    processing: '处理中',
    success: '成功'
};

const POLL_INTERVAL_MS = 4000;

const SPARKLINE = {
    width: 132,
    height: 40,
    pad: 3
};

const TREND_WINDOW = 12;
const TREND_THRESHOLD = 0.05;

const TABS = [
    { key: 'tokens', label: 'Token' },
    { key: 'asin', label: 'ASIN 爬虫' },
    { key: 'trends', label: 'Google Trends' }
];

function formatNumber(value) {
    if (value == null || Number.isNaN(value)) return '—';
    return Number(value).toLocaleString('zh-CN');
}

function getTrendPoints(item) {
    const rows = Array.isArray(item.data) ? item.data : (Array.isArray(item.points) ? item.points : []);
    return rows.filter(point => point && !point.empty);
}

function averageSearches(points) {
    if (!points.length) return 0;
    const sum = points.reduce((total, point) => total + Number(point.searches || 0), 0);
    return sum / points.length;
}

function analyzeTrend(points) {
    if (!points.length) {
        return { trend: 'none', trendLabel: '—', latestSearches: null, changePct: null };
    }

    const latest = points[points.length - 1];
    const latestSearches = Number(latest.searches);
    const windowPoints = points.slice(-TREND_WINDOW);

    if (windowPoints.length < 2) {
        return {
            trend: 'flat',
            trendLabel: '持平',
            latestSearches: Number.isFinite(latestSearches) ? latestSearches : null,
            changePct: 0
        };
    }

    const half = Math.floor(windowPoints.length / 2);
    const earlierAvg = averageSearches(windowPoints.slice(0, half));
    const recentAvg = averageSearches(windowPoints.slice(half));
    let trend = 'flat';
    let trendLabel = '持平';
    let changePct = 0;

    if (earlierAvg > 0) {
        changePct = ((recentAvg - earlierAvg) / earlierAvg) * 100;
        if (changePct > TREND_THRESHOLD * 100) {
            trend = 'up';
            trendLabel = '上升';
        } else if (changePct < -TREND_THRESHOLD * 100) {
            trend = 'down';
            trendLabel = '下降';
        }
    } else if (recentAvg > earlierAvg) {
        trend = 'up';
        trendLabel = '上升';
        changePct = 100;
    } else if (recentAvg < earlierAvg) {
        trend = 'down';
        trendLabel = '下降';
        changePct = -100;
    }

    return {
        trend,
        trendLabel,
        latestSearches: Number.isFinite(latestSearches) ? latestSearches : null,
        changePct: Math.round(changePct)
    };
}

function buildSparkline(points, trend) {
    const windowPoints = points
        .slice(-TREND_WINDOW)
        .filter(point => Number.isFinite(Number(point.searches)));
    if (windowPoints.length < 2) return null;

    const values = windowPoints.map(point => Number(point.searches));

    let yMin = Math.min(...values);
    let yMax = Math.max(...values);
    if (yMin === yMax) {
        yMin = Math.max(0, yMin - 1);
        yMax = yMax + 1;
    }

    const plotW = SPARKLINE.width - SPARKLINE.pad * 2;
    const plotH = SPARKLINE.height - SPARKLINE.pad * 2;
    const xStep = plotW / (values.length - 1);

    const plotPoints = windowPoints.map((point, index) => {
        const value = values[index];
        const ratio = (value - yMin) / (yMax - yMin);
        const x = SPARKLINE.pad + xStep * index;
        const y = SPARKLINE.pad + plotH * (1 - ratio);
        return {
            x,
            y,
            date: point.date,
            formattedTime: point.formattedTime || point.date,
            searches: value
        };
    });

    const path = plotPoints.map((point, index) => {
        return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    }).join(' ');

    const stroke = trend === 'up' ? '#67c23a' : trend === 'down' ? '#f56c6c' : '#909399';

    return { path, stroke, plotPoints };
}

function findNearestPlotPoint(svg, plotPoints, clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return null;

    const svgX = ((clientX - rect.left) / rect.width) * SPARKLINE.width;
    let nearest = plotPoints[0];
    let minDist = Infinity;

    for (const point of plotPoints) {
        const dist = Math.abs(point.x - svgX);
        if (dist < minDist) {
            minDist = dist;
            nearest = point;
        }
    }

    return nearest;
}

function buildRow(item) {
    const points = getTrendPoints(item);
    const trendInfo = analyzeTrend(points);
    const error = item.error || (item.success === false ? item.message : '');

    return {
        keyword: item.keyword,
        source: item.source,
        error,
        points,
        ...trendInfo,
        sparkline: error ? null : buildSparkline(points, trendInfo.trend)
    };
}

export default {
    name: 'DataCollectionView',
    setup() {
        const activeTab = ref('tokens');

        // —— Token / ASIN ——
        const tokens = ref([]);
        const activeTokenCount = ref(0);
        const jobs = ref([]);
        const currentJob = ref(null);
        const currentItems = ref([]);
        const loading = ref(false);
        const error = ref('');
        const successMessage = ref('');
        const tokenSaving = ref(false);
        const jobCreating = ref(false);
        const expandedJobId = ref(null);
        const jsonPreview = ref(null);
        const jsonPreviewLoading = ref(false);
        let pollTimer = null;

        const tokenForm = reactive({
            token: '',
            label: ''
        });

        const jobForm = reactive({
            asins: '',
            amazon_domain: 'amazon.com'
        });

        const progressPercent = computed(() => {
            const job = currentJob.value;
            if (!job || !job.total_count) return 0;
            const done = Number(job.success_count || 0) + Number(job.fail_count || 0);
            return Math.min(100, Math.round((done / job.total_count) * 100));
        });

        const isJobActive = computed(() => {
            const status = currentJob.value?.status;
            return status === 'pending' || status === 'running';
        });

        // —— Google Trends ——
        const keywordsText = ref('');
        const forceRefresh = ref(false);
        const trendsLoading = ref(false);
        const trendsError = ref('');
        const batchResult = ref(null);
        const sparklineTooltip = ref(null);

        const rowList = computed(() => {
            if (!batchResult.value || !batchResult.value.results) return [];
            return batchResult.value.results.map(buildRow);
        });

        const summary = computed(() => {
            if (!batchResult.value) return null;
            return {
                total: batchResult.value.total || 0,
                success: batchResult.value.success_count || 0
            };
        });

        function statusLabel(status) {
            return STATUS_LABELS[status] || status;
        }

        function statusClass(status) {
            if (status === 'completed' || status === 'success' || status === 'active') return 'status-done';
            if (status === 'failed' || status === 'exhausted') return 'status-failed';
            if (status === 'running' || status === 'processing' || status === 'pending') return 'status-progress';
            return '';
        }

        async function loadTokens() {
            const { data } = await http.get(`${API_BASE}/tokens`);
            tokens.value = data.tokens || [];
            activeTokenCount.value = data.active_count || 0;
        }

        async function loadJobs() {
            const { data } = await http.get(`${API_BASE}/asin/jobs`);
            jobs.value = data.jobs || [];
        }

        async function loadCurrentJobDetail() {
            if (!currentJob.value?.id) return;
            const [jobRes, itemsRes] = await Promise.all([
                http.get(`${API_BASE}/asin/jobs/` + currentJob.value.id),
                http.get(`${API_BASE}/asin/jobs/` + currentJob.value.id + '/items')
            ]);
            currentJob.value = jobRes.data.job;
            currentItems.value = itemsRes.data.items || [];
            const idx = jobs.value.findIndex(j => j.id === currentJob.value.id);
            if (idx >= 0) jobs.value[idx] = currentJob.value;
        }

        async function loadData() {
            try {
                await Promise.all([loadTokens(), loadJobs()]);
                if (currentJob.value?.id) {
                    await loadCurrentJobDetail();
                }
                error.value = '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            } finally {
                loading.value = false;
            }
        }

        function startPolling() {
            stopPolling();
            pollTimer = setInterval(() => {
                if (activeTab.value !== 'asin') return;
                loadData().catch(() => {});
            }, POLL_INTERVAL_MS);
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        async function addToken() {
            error.value = '';
            successMessage.value = '';
            tokenSaving.value = true;
            try {
                const { data } = await http.post(`${API_BASE}/tokens`, { ...tokenForm });
                tokenForm.token = '';
                tokenForm.label = '';
                await loadTokens();
                if (data.added_count > 1) {
                    successMessage.value = `已成功添加 ${data.added_count} 个 Token`;
                }
            } catch (e) {
                error.value = getApiError(e, '添加 token 失败');
            } finally {
                tokenSaving.value = false;
            }
        }

        async function disableToken(id) {
            error.value = '';
            try {
                await http.post(`${API_BASE}/tokens/` + id + '/disable');
                await loadTokens();
            } catch (e) {
                error.value = getApiError(e, '禁用失败');
            }
        }

        async function resetToken(id) {
            error.value = '';
            try {
                await http.post(`${API_BASE}/tokens/` + id + '/reset');
                await loadTokens();
            } catch (e) {
                error.value = getApiError(e, '重置失败');
            }
        }

        async function createJob() {
            error.value = '';
            jobCreating.value = true;
            try {
                const { data } = await http.post(`${API_BASE}/asin/jobs`, {
                    asins: jobForm.asins,
                    amazon_domain: jobForm.amazon_domain
                });
                currentJob.value = data.job;
                jobForm.asins = '';
                if (data.warnings?.length) {
                    error.value = data.warnings.join('；');
                }
                await loadJobs();
                await loadCurrentJobDetail();
                startPolling();
            } catch (e) {
                error.value = getApiError(e, '创建任务失败');
            } finally {
                jobCreating.value = false;
            }
        }

        async function selectJob(job) {
            currentJob.value = job;
            expandedJobId.value = job.id;
            await loadCurrentJobDetail();
            if (job.status === 'pending' || job.status === 'running') {
                startPolling();
            }
        }

        async function cancelJob(job) {
            if (!confirm('确认取消任务 #' + job.id + '？')) return;
            error.value = '';
            try {
                const { data } = await http.post(`${API_BASE}/asin/jobs/` + job.id + '/cancel');
                if (currentJob.value?.id === job.id) {
                    currentJob.value = data.job;
                }
                await loadData();
            } catch (e) {
                error.value = getApiError(e, '取消失败');
            }
        }

        function downloadXlsx(jobId) {
            window.open(`${API_BASE}/asin/jobs/` + jobId + '/export.xlsx', '_blank');
        }

        function downloadJson(jobId) {
            window.open(`${API_BASE}/asin/jobs/` + jobId + '/export.json', '_blank');
        }

        async function previewItemJson(item) {
            if (!item?.id || !item.has_json) return;
            jsonPreviewLoading.value = true;
            error.value = '';
            try {
                const { data } = await http.get(`${API_BASE}/asin/items/` + item.id + '/json');
                jsonPreview.value = {
                    asin: data.item.asin,
                    text: JSON.stringify(data.item.data, null, 2)
                };
            } catch (e) {
                error.value = getApiError(e, '加载 JSON 失败');
            } finally {
                jsonPreviewLoading.value = false;
            }
        }

        function closeJsonPreview() {
            jsonPreview.value = null;
        }

        function toggleItems(jobId) {
            expandedJobId.value = expandedJobId.value === jobId ? null : jobId;
            if (expandedJobId.value === jobId) {
                const job = jobs.value.find(j => j.id === jobId);
                if (job) selectJob(job);
            }
        }

        function onSparklineMove(event, row) {
            const plotPoints = row.sparkline?.plotPoints;
            if (!plotPoints?.length) return;

            const nearest = findNearestPlotPoint(event.currentTarget, plotPoints, event.clientX);
            if (!nearest) return;

            sparklineTooltip.value = {
                keyword: row.keyword,
                label: nearest.formattedTime || nearest.date,
                value: nearest.searches,
                x: nearest.x,
                y: nearest.y
            };
        }

        function clearSparklineTooltip() {
            sparklineTooltip.value = null;
        }

        async function searchTrends() {
            trendsError.value = '';
            trendsLoading.value = true;
            batchResult.value = null;
            sparklineTooltip.value = null;

            try {
                const { data } = await http.post(`${API_BASE}/trends`, {
                    keywords: keywordsText.value,
                    interval: 'w',
                    force_refresh: forceRefresh.value
                });
                batchResult.value = data;
            } catch (e) {
                trendsError.value = getApiError(e, '查询失败');
            } finally {
                trendsLoading.value = false;
            }
        }

        async function switchTab(tab) {
            if (activeTab.value === tab) return;
            activeTab.value = tab;
        }

        watch(activeTab, async (tab, prev) => {
            if (prev === 'asin') stopPolling();

            if (tab === 'tokens') {
                try {
                    await loadTokens();
                    error.value = '';
                } catch (e) {
                    error.value = getApiError(e, '加载失败');
                }
            } else if (tab === 'asin') {
                loading.value = true;
                await loadData();
                if (isJobActive.value) startPolling();
            }
        });

        onMounted(async () => {
            try {
                await loadTokens();
                error.value = '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        });
        onUnmounted(stopPolling);

        return {
            TABS,
            activeTab,
            switchTab,
            tokens,
            activeTokenCount,
            jobs,
            currentJob,
            currentItems,
            loading,
            error,
            successMessage,
            tokenSaving,
            jobCreating,
            tokenForm,
            jobForm,
            progressPercent,
            isJobActive,
            expandedJobId,
            jsonPreview,
            jsonPreviewLoading,
            statusLabel,
            statusClass,
            addToken,
            disableToken,
            resetToken,
            createJob,
            selectJob,
            cancelJob,
            downloadXlsx,
            downloadJson,
            previewItemJson,
            closeJsonPreview,
            toggleItems,
            loadData,
            keywordsText,
            forceRefresh,
            trendsLoading,
            trendsError,
            batchResult,
            rowList,
            summary,
            formatNumber,
            searchTrends,
            sparklineTooltip,
            onSparklineMove,
            clearSparklineTooltip,
            SPARKLINE
        };
    },
    template: `<div class="page-header">
                <h1>数据采集</h1>
                <p class="page-desc">SearchAPI · Token · ASIN 爬虫 · Google Trends</p>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid var(--border-color, #e5e7eb);padding-bottom:8px;">
                <button
                    v-for="tab in TABS"
                    :key="tab.key"
                    type="button"
                    :class="activeTab === tab.key ? 'btn-primary' : 'btn-secondary'"
                    @click="switchTab(tab.key)"
                >{{ tab.label }}</button>
            </div>

            <div v-if="error && activeTab !== 'trends'" style="background:#fef0f0;border:1px solid #fde2e2;color:#f56c6c;padding:12px 16px;border-radius:8px;margin-bottom:16px;">{{ error }}</div>
            <div v-if="successMessage && activeTab === 'tokens'" style="background:#f0f9eb;border:1px solid #e1f3d8;color:#67c23a;padding:12px 16px;border-radius:8px;margin-bottom:16px;">{{ successMessage }}</div>

            <template v-if="activeTab === 'tokens'">
                <div class="module-card" style="margin-bottom:20px;">
                    <div class="module-header" style="cursor:default;">
                        <div class="module-name">Token 管理</div>
                        <div style="font-size:13px;color:#909399;">可用 {{ activeTokenCount }} 个</div>
                    </div>
                    <div class="module-body">
                        <form @submit.prevent="addToken" style="display:grid;gap:12px;max-width:720px;margin-bottom:16px;">
                            <textarea v-model="tokenForm.token" class="sop-remark" rows="4" placeholder="每行一个 SearchAPI Token" required></textarea>
                            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
                                <input v-model="tokenForm.label" class="search-input" placeholder="备注（可选，批量添加时共用）" style="flex:1;min-width:200px;">
                                <button type="submit" class="btn-primary" :disabled="tokenSaving">{{ tokenSaving ? '添加中...' : '添加 Token' }}</button>
                            </div>
                        </form>
                        <div class="table-container">
                            <table class="product-table">
                                <thead>
                                    <tr>
                                        <th>备注</th>
                                        <th>Token</th>
                                        <th>状态</th>
                                        <th>失败次数</th>
                                        <th>最后使用</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="!tokens.length"><td colspan="6" style="text-align:center;color:#909399;">暂无 Token</td></tr>
                                    <tr v-for="token in tokens" :key="token.id">
                                        <td>{{ token.label || '—' }}</td>
                                        <td><code>{{ token.token_masked }}</code></td>
                                        <td><span class="status-badge" :class="statusClass(token.status)">{{ statusLabel(token.status) }}</span></td>
                                        <td>{{ token.fail_count }}</td>
                                        <td>{{ token.last_used_at || '—' }}</td>
                                        <td style="white-space:nowrap;">
                                            <button v-if="token.status !== 'disabled'" type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-right:6px;" @click="disableToken(token.id)">禁用</button>
                                            <button v-if="token.status !== 'active'" type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;" @click="resetToken(token.id)">重置</button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </template>

            <template v-if="activeTab === 'asin'">
                <div class="module-card" style="margin-bottom:20px;">
                    <div class="module-header" style="cursor:default;">
                        <div class="module-name">新建爬取任务</div>
                        <div style="font-size:13px;color:#909399;">可用 Token {{ activeTokenCount }} 个</div>
                    </div>
                    <div class="module-body">
                        <form @submit.prevent="createJob" style="display:grid;gap:12px;max-width:720px;">
                            <textarea v-model="jobForm.asins" class="sop-remark" rows="8" placeholder="每行一个 ASIN，例如：&#10;B0CGCMS31N&#10;B0TEST1234" required></textarea>
                            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
                                <input v-model="jobForm.amazon_domain" class="search-input" placeholder="amazon.com" style="max-width:220px;">
                                <button type="submit" class="btn-primary" :disabled="jobCreating">{{ jobCreating ? '创建中...' : '开始爬取' }}</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div v-if="currentJob" class="module-card" style="margin-bottom:20px;">
                    <div class="module-header" style="cursor:default;">
                        <div class="module-name">当前任务 #{{ currentJob.id }}</div>
                        <span class="status-badge" :class="statusClass(currentJob.status)">{{ statusLabel(currentJob.status) }}</span>
                    </div>
                    <div class="module-body">
                        <div style="margin-bottom:12px;">
                            <div style="height:8px;background:#ebeef5;border-radius:4px;overflow:hidden;">
                                <div :style="{ width: progressPercent + '%', height: '100%', background: '#409eff', transition: 'width 0.3s' }"></div>
                            </div>
                            <div style="margin-top:8px;font-size:13px;color:#606266;">
                                成功 {{ currentJob.success_count }} / 失败 {{ currentJob.fail_count }} / 总计 {{ currentJob.total_count }}
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
                            <button v-if="currentJob.status === 'completed'" type="button" class="btn-primary" @click="downloadXlsx(currentJob.id)">下载 Excel</button>
                            <button v-if="currentJob.status === 'completed'" type="button" class="btn-secondary" @click="downloadJson(currentJob.id)">下载 JSON</button>
                            <button v-if="currentJob.status === 'pending' || currentJob.status === 'running'" type="button" class="btn-secondary" @click="cancelJob(currentJob)">取消任务</button>
                        </div>
                        <div v-if="currentItems.length" class="table-container">
                            <table class="product-table">
                                <thead>
                                    <tr><th>ASIN</th><th>状态</th><th>错误</th><th>操作</th></tr>
                                </thead>
                                <tbody>
                                    <tr v-for="item in currentItems" :key="item.id">
                                        <td>{{ item.asin }}</td>
                                        <td><span class="status-badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span></td>
                                        <td style="color:#f56c6c;font-size:12px;">{{ item.error_message || '—' }}</td>
                                        <td style="white-space:nowrap;">
                                            <button
                                                v-if="item.has_json"
                                                type="button"
                                                class="btn-secondary"
                                                style="padding:4px 10px;font-size:12px;"
                                                :disabled="jsonPreviewLoading"
                                                @click="previewItemJson(item)"
                                            >JSON</button>
                                            <span v-else style="color:#909399;">—</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="module-card">
                    <div class="module-header" style="cursor:default;"><div class="module-name">历史任务</div></div>
                    <div class="module-body">
                        <div class="table-container">
                            <table class="product-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>状态</th>
                                        <th>进度</th>
                                        <th>站点</th>
                                        <th>创建时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="loading"><td colspan="6" style="text-align:center;color:#909399;">加载中...</td></tr>
                                    <tr v-else-if="!jobs.length"><td colspan="6" style="text-align:center;color:#909399;">暂无任务</td></tr>
                                    <tr v-for="job in jobs" :key="job.id">
                                        <td>{{ job.id }}</td>
                                        <td><span class="status-badge" :class="statusClass(job.status)">{{ statusLabel(job.status) }}</span></td>
                                        <td>{{ job.success_count }}/{{ job.total_count }} 成功，{{ job.fail_count }} 失败</td>
                                        <td>{{ job.amazon_domain }}</td>
                                        <td>{{ job.created_at }}</td>
                                        <td style="white-space:nowrap;">
                                            <button type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-right:6px;" @click="selectJob(job)">查看</button>
                                            <button v-if="job.status === 'completed'" type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-right:6px;" @click="downloadXlsx(job.id)">Excel</button>
                                            <button v-if="job.status === 'completed'" type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-right:6px;" @click="downloadJson(job.id)">JSON</button>
                                            <button v-if="job.status === 'pending' || job.status === 'running'" type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;color:#f56c6c;" @click="cancelJob(job)">取消</button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div
                    v-if="jsonPreview"
                    style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;"
                    @click.self="closeJsonPreview"
                >
                    <div style="background:#fff;border-radius:10px;width:min(960px,100%);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 12px 32px rgba(0,0,0,0.18);">
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #ebeef5;">
                            <div style="font-size:16px;font-weight:600;">JSON 预览 · {{ jsonPreview.asin }}</div>
                            <button type="button" class="btn-secondary" @click="closeJsonPreview">关闭</button>
                        </div>
                        <pre style="margin:0;padding:20px;overflow:auto;font-size:12px;line-height:1.6;background:#fafafa;flex:1;">{{ jsonPreview.text }}</pre>
                    </div>
                </div>
            </template>

            <template v-if="activeTab === 'trends'">
                <div class="trends-search-card module-card">
                    <div class="module-body">
                        <div class="trends-search-row">
                            <div class="trends-form-group trends-form-grow">
                                <label for="trends-keywords">关键词（每行一个，也支持逗号分隔）</label>
                                <textarea
                                    id="trends-keywords"
                                    v-model="keywordsText"
                                    class="trends-textarea"
                                    rows="4"
                                    placeholder="dog&#10;cat&#10;fish tank"
                                ></textarea>
                            </div>
                            <div class="trends-search-side">
                                <label class="trends-checkbox">
                                    <input type="checkbox" v-model="forceRefresh" />
                                    强制刷新
                                </label>
                                <button type="button" class="btn-primary" :disabled="trendsLoading || !keywordsText.trim()" @click="searchTrends">
                                    {{ trendsLoading ? '查询中…' : '开始查询' }}
                                </button>
                                <span v-if="trendsLoading" class="trends-hint">批量查询中（每批最多 5 个关键词）…</span>
                            </div>
                        </div>
                        <div v-if="trendsError" class="trends-alert trends-alert-error">{{ trendsError }}</div>
                    </div>
                </div>

                <div class="trends-list-card module-card">
                    <div class="module-header" style="cursor:default;">
                        <div class="module-name">趋势列表</div>
                        <span v-if="summary" class="trends-summary">成功 {{ summary.success }} / {{ summary.total }}</span>
                    </div>
                    <div class="module-body trends-list-body">
                        <div v-if="!batchResult && !trendsLoading" class="trends-empty">输入关键词后点击「开始查询」</div>
                        <div v-else-if="trendsLoading" class="trends-empty">正在查询趋势数据…</div>
                        <div v-else-if="!rowList.length" class="trends-empty">暂无结果</div>
                        <div v-else class="trends-list">
                            <div
                                v-for="row in rowList"
                                :key="row.keyword"
                                class="trends-row"
                                :class="{ 'is-error': row.error }"
                            >
                                <div class="trends-row-left">
                                    <div class="trends-row-keyword">{{ row.keyword }}</div>
                                    <template v-if="row.error">
                                        <div class="trends-row-error">{{ row.error }}</div>
                                    </template>
                                    <template v-else>
                                        <div class="trends-row-stats">
                                            <span class="trends-trend-badge" :class="'trends-trend-' + row.trend">
                                                {{ row.trendLabel }}
                                            </span>
                                            <span class="trends-volume-label">热度指数</span>
                                            <span class="trends-volume-value">{{ formatNumber(row.latestSearches) }}</span>
                                            <span v-if="row.changePct != null" class="trends-change" :class="'trends-trend-' + row.trend">
                                                {{ row.changePct > 0 ? '+' : '' }}{{ row.changePct }}%
                                            </span>
                                        </div>
                                    </template>
                                </div>
                                <div class="trends-row-right">
                                    <div
                                        v-if="row.sparkline"
                                        class="trends-sparkline-wrap"
                                        @mouseleave="clearSparklineTooltip"
                                    >
                                        <svg
                                            class="trends-sparkline"
                                            :viewBox="'0 0 ' + SPARKLINE.width + ' ' + SPARKLINE.height"
                                            preserveAspectRatio="none"
                                            role="img"
                                            :aria-label="row.keyword + ' 趋势'"
                                            @mousemove="onSparklineMove($event, row)"
                                        >
                                            <path
                                                :d="row.sparkline.path"
                                                fill="none"
                                                :stroke="row.sparkline.stroke"
                                                stroke-width="1.8"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            />
                                            <circle
                                                v-if="sparklineTooltip && sparklineTooltip.keyword === row.keyword"
                                                :cx="sparklineTooltip.x"
                                                :cy="sparklineTooltip.y"
                                                r="2.8"
                                                :fill="row.sparkline.stroke"
                                                stroke="#fff"
                                                stroke-width="1.2"
                                            />
                                        </svg>
                                        <div
                                            v-if="sparklineTooltip && sparklineTooltip.keyword === row.keyword"
                                            class="trends-sparkline-tooltip"
                                            :style="{
                                                left: (sparklineTooltip.x / SPARKLINE.width * 100) + '%',
                                                top: (sparklineTooltip.y / SPARKLINE.height * 100) + '%'
                                            }"
                                        >
                                            <div class="trends-sparkline-tooltip-date">{{ sparklineTooltip.label }}</div>
                                            <div class="trends-sparkline-tooltip-value">热度 {{ formatNumber(sparklineTooltip.value) }}</div>
                                        </div>
                                    </div>
                                    <span v-else-if="!row.error" class="trends-sparkline-empty">—</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>`
};
