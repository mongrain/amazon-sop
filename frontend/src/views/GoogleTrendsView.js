import { computed, ref } from 'vue';
import { getApiError, http } from '@/utils/index.js';

const SPARKLINE = {
    width: 132,
    height: 40,
    pad: 3
};

const TREND_WINDOW = 12;
const TREND_THRESHOLD = 0.05;

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
    name: 'GoogleTrendsView',
    setup() {
        const keywordsText = ref('');
        const forceRefresh = ref(false);
        const loading = ref(false);
        const error = ref('');
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
            error.value = '';
            loading.value = true;
            batchResult.value = null;
            sparklineTooltip.value = null;

            try {
                const { data } = await http.post('/api/google-trends', {
                    keywords: keywordsText.value,
                    interval: 'w',
                    force_refresh: forceRefresh.value
                });
                batchResult.value = data;
            } catch (e) {
                error.value = getApiError(e, '查询失败');
            } finally {
                loading.value = false;
            }
        }

        return {
            keywordsText,
            forceRefresh,
            loading,
            error,
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
                <h1>Google Trends</h1>
                <p class="page-subtitle">批量查询关键词搜索趋势，列表展示热度指数与走势</p>
            </div>

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
                            <button type="button" class="btn-primary" :disabled="loading || !keywordsText.trim()" @click="searchTrends">
                                {{ loading ? '查询中…' : '开始查询' }}
                            </button>
                            <span v-if="loading" class="trends-hint">逐个查询，约每 3 秒 1 个关键词</span>
                        </div>
                    </div>
                    <div v-if="error" class="trends-alert trends-alert-error">{{ error }}</div>
                </div>
            </div>

            <div class="trends-list-card module-card">
                <div class="module-header" style="cursor:default;">
                    <div class="module-name">趋势列表</div>
                    <span v-if="summary" class="trends-summary">成功 {{ summary.success }} / {{ summary.total }}</span>
                </div>
                <div class="module-body trends-list-body">
                    <div v-if="!batchResult && !loading" class="trends-empty">输入关键词后点击「开始查询」</div>
                    <div v-else-if="loading" class="trends-empty">正在查询趋势数据…</div>
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
            </div>`
};
