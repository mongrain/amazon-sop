import { computed } from 'vue';
import {
    barPercent,
    compareTone,
    dayBarHeight,
    weekMax,
    finiteOrNull
} from '@/utils/review-visual.js';

function statusLabel(status) {
    if (status === 'filled') return '已填';
    if (status === 'missing') return '缺填';
    if (status === 'upcoming') return '未到';
    return '-';
}

function fmtVal(v) {
    return v === null || v === undefined || v === '' ? '-' : v;
}

function dateShort(ymd) {
    const s = String(ymd || '');
    return s.length >= 10 ? s.slice(5, 10) : s || '-';
}

function buildCard(name, actual, target, higherBetter, always) {
    const a = finiteOrNull(actual);
    if (!always && a === null) return null;
    const t = finiteOrNull(target);
    const tone = compareTone(a, t, higherBetter);
    let mark = '';
    if (t === null) mark = '目标未设';
    else if (tone === 'bad' && !higherBetter) mark = '已超';
    else if (tone === 'bad' && higherBetter) mark = '未达标';
    return {
        name,
        actualLabel: a === null ? '-' : a,
        targetLabel: t === null ? '目标未设' : t,
        mark,
        tone,
        pct: barPercent(a, t)
    };
}

export default {
    name: 'ReviewWeekVisual',
    props: {
        week: { type: Object, default: null },
        sprint: { type: Object, default: null }
    },
    setup(props) {
        const visible = computed(() => !!(props.week && Array.isArray(props.week.days)));
        const days = computed(() => (props.week && props.week.days) || []);
        const totals = computed(() => (props.week && props.week.totals) || {});
        const sprint = computed(() => props.sprint || {});

        const maxOrders = computed(() => weekMax(days.value, 'orders'));
        const maxSpend = computed(() => weekMax(days.value, 'ad_spend'));

        const dayBars = computed(() => days.value.map((d) => {
            const filled = d.status === 'filled';
            return {
                date: d.date,
                short: dateShort(d.date),
                status: statusLabel(d.status),
                ordersH: filled ? dayBarHeight(d.orders, maxOrders.value) : 0,
                spendH: filled ? dayBarHeight(d.ad_spend, maxSpend.value) : 0
            };
        }));

        const cards = computed(() => {
            const t = totals.value;
            const s = sprint.value;
            const list = [
                buildCard('花费 vs 7天最大亏损额度', t.actual_max_loss, s.max_loss_7d, false, true),
                buildCard('TACOS vs 推广期允许', t.actual_tacos, s.promo_tacos_limit, false, true),
                buildCard('日均单量 vs 目标', t.avg_daily_orders, s.target_daily_orders, true, true),
                buildCard('CTR(%) vs 目标', t.ctr, s.ctr_7d, true, false),
                buildCard('CVR(%) vs 目标', t.cvr, s.cvr_7d, true, false),
                buildCard('CPC vs 目标', t.cpc, s.cpc, false, false)
            ];
            return list.filter(Boolean);
        });

        return { visible, days, dayBars, cards, sprint, fmtVal, statusLabel };
    },
    template: `<div v-if="visible">
            <div class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">本周数据</div></div>
                <div class="module-body">
                    <div class="review-week-legend">
                        <span><i class="lg-orders"></i>订单</span>
                        <span><i class="lg-spend"></i>花费</span>
                    </div>
                    <div class="review-day-bars">
                        <div class="review-day-col" v-for="d in dayBars" :key="d.date">
                            <div class="review-twin">
                                <span class="bar-orders" :style="{ height: d.ordersH + '%' }"></span>
                                <span class="bar-spend" :style="{ height: d.spendH + '%' }"></span>
                            </div>
                            <div class="review-day-label">{{ d.short }}<br>{{ d.status }}</div>
                        </div>
                    </div>
                    <div class="table-container" style="max-height:none;">
                        <table class="product-table">
                            <thead>
                                <tr>
                                    <th>日期</th>
                                    <th>状态</th>
                                    <th>订单</th>
                                    <th>广告花费</th>
                                    <th>总销售额</th>
                                    <th>TACOS</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="d in days" :key="d.date">
                                    <td>{{ d.date }}</td>
                                    <td>{{ statusLabel(d.status) }}</td>
                                    <td>{{ fmtVal(d.orders) }}</td>
                                    <td>{{ fmtVal(d.ad_spend) }}</td>
                                    <td>{{ fmtVal(d.total_sales) }}</td>
                                    <td>{{ fmtVal(d.tacos) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">对照</div></div>
                <div class="module-body">
                    <div v-if="sprint.sprint_goal" class="review-goal-text">冲刺目标：{{ sprint.sprint_goal }}</div>
                    <div class="review-compare-grid">
                        <div class="review-compare-card" v-for="c in cards" :key="c.name">
                            <div class="review-compare-name">{{ c.name }}</div>
                            <div class="review-compare-nums">
                                实际 {{ c.actualLabel }}
                                <span v-if="c.targetLabel === '目标未设'"> · 目标未设</span>
                                <span v-else> / 目标 {{ c.targetLabel }}</span>
                                <span v-if="c.mark && c.mark !== '目标未设'" :class="'review-tone-' + c.tone"> {{ c.mark }}</span>
                            </div>
                            <div v-if="c.pct != null" class="progress-bar">
                                <div class="progress-fill" :class="c.tone" :style="{ width: c.pct + '%' }"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`
};
