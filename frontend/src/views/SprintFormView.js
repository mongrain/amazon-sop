import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';
import {
    calcEndDate,
    calcRequiredImpressions,
    calcBudgetCap,
    calcInventoryDays,
    calcFinanceDefaults,
    toFiniteOrNull
} from '@/utils/sprint-form-calc.js';

function resolveSprintId(route) {
    if (route.query.id) return String(route.query.id);
    if (route.params.id) return String(route.params.id);
    return null;
}
export default {
    name: 'SprintFormView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const sprintId = ref(resolveSprintId(route));
        const users = ref([]);
        const error = ref('');
        const saving = ref(false);
        const querying = ref(false);
        const hydrating = ref(false);
        const lastProfitUsd = ref(null);
        const form = reactive({
            asin: '', owner_id: '', status: 'ACTIVE', start_date: '', end_date: '',
            target_cycle_days: 14, current_daily_orders: '', target_daily_orders: '',
            current_rank: '', target_rank: '',
            sprint_goal: '', sprint_keywords: '',
            ctr_7d: '', cvr_7d: '', cpc: '', required_impressions: '',
            promo_tacos_limit: '', stable_tacos_target: '',
            max_loss_7d: '', profit_margin: '', budget_cap: '',
            fba_warehouse_qty: '', inventory_days: '',
            page_ok: false, exit_conditions: ''
        });

        const isEdit = computed(() => !!sprintId.value);
        const pageTitle = computed(() => isEdit.value ? '编辑冲刺广告' : '新建冲刺广告');

        function recalcDerived() {
            const end = calcEndDate(form.start_date, form.target_cycle_days);
            if (end) form.end_date = end;

            const impressions = calcRequiredImpressions(
                form.target_daily_orders,
                form.ctr_7d,
                form.cvr_7d
            );
            if (impressions != null) form.required_impressions = impressions;

            const cap = calcBudgetCap(form.required_impressions, form.cpc);
            if (cap != null) form.budget_cap = cap;
        }

        function recalcMaxLossFromOrders() {
            if (lastProfitUsd.value == null) return;
            const d = calcFinanceDefaults({
                profitMarginRatio: null,
                profitUsd: lastProfitUsd.value,
                currentDailyOrders: form.current_daily_orders
            });
            if (d.max_loss_7d != null) form.max_loss_7d = d.max_loss_7d;
        }

        async function loadForm() {
            try {
                const qs = sprintId.value ? ('?id=' + encodeURIComponent(sprintId.value)) : '';
                const { data } = await http.get('/api/sprints/form' + qs);
                users.value = data.users || [];
                hydrating.value = true;
                try {
                    if (data.sprint) {
                        const s = data.sprint;
                        form.asin = s.asin || '';
                        form.owner_id = s.owner_id != null ? String(s.owner_id) : '';
                        form.status = s.status || 'ACTIVE';
                        form.start_date = s.start_date || '';
                        form.end_date = s.end_date || '';
                        form.target_cycle_days = s.target_cycle_days != null ? s.target_cycle_days : 14;
                        form.current_daily_orders = s.current_daily_orders != null ? s.current_daily_orders : '';
                        form.target_daily_orders = s.target_daily_orders != null ? s.target_daily_orders : '';
                        form.current_rank = s.current_rank != null ? s.current_rank : '';
                        form.target_rank = s.target_rank != null ? s.target_rank : '';
                        form.sprint_goal = s.sprint_goal || '';
                        form.sprint_keywords = s.sprint_keywords || '';
                        form.ctr_7d = s.ctr_7d != null ? s.ctr_7d : '';
                        form.cvr_7d = s.cvr_7d != null ? s.cvr_7d : '';
                        form.cpc = s.cpc != null ? s.cpc : '';
                        form.required_impressions = s.required_impressions != null ? s.required_impressions : '';
                        form.promo_tacos_limit = s.promo_tacos_limit != null ? s.promo_tacos_limit : '';
                        form.stable_tacos_target = s.stable_tacos_target != null ? s.stable_tacos_target : '';
                        form.max_loss_7d = s.max_loss_7d != null ? s.max_loss_7d : '';
                        form.profit_margin = s.profit_margin != null ? s.profit_margin : '';
                        form.budget_cap = s.budget_cap != null ? s.budget_cap : '';
                        form.fba_warehouse_qty = s.fba_warehouse_qty != null ? s.fba_warehouse_qty : '';
                        form.inventory_days = s.inventory_days != null ? s.inventory_days : '';
                        form.page_ok = Number(s.page_ok) === 1;
                        form.exit_conditions = s.exit_conditions || '';
                    }
                    await nextTick();
                } finally {
                    hydrating.value = false;
                }
                error.value = data.error || '';
                if (!sprintId.value) recalcDerived();
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        async function queryAsin() {
            const asin = String(form.asin || '').trim();
            if (!asin) {
                error.value = '请先填写 ASIN';
                return;
            }
            querying.value = true;
            error.value = '';
            try {
                const { data } = await http.get('/api/product/' + encodeURIComponent(asin));
                const c = data.economics && data.economics.computed;
                if (!c) {
                    error.value = '无产品经济数据';
                    return;
                }
                lastProfitUsd.value = toFiniteOrNull(c.profit_usd);
                const d = calcFinanceDefaults({
                    profitMarginRatio: c.profit_margin,
                    profitUsd: c.profit_usd,
                    currentDailyOrders: form.current_daily_orders
                });
                if (d.profit_margin_pct != null) form.profit_margin = d.profit_margin_pct;
                if (d.promo_tacos_limit != null) form.promo_tacos_limit = d.promo_tacos_limit;
                if (d.stable_tacos_target != null) form.stable_tacos_target = d.stable_tacos_target;
                if (d.max_loss_7d != null) form.max_loss_7d = d.max_loss_7d;
            } catch (e) {
                error.value = getApiError(e, '查询失败');
            } finally {
                querying.value = false;
            }
        }

        async function submitForm() {
            error.value = '';
            saving.value = true;
            const payload = { ...form, page_ok: form.page_ok ? 1 : 0, acos_limit: null };
            try {
                if (isEdit.value) {
                    await http.post('/api/sprints/' + sprintId.value, payload);
                } else {
                    await http.post('/api/sprints', payload);
                }
                router.push('/sprints');
            } catch (e) {
                error.value = getApiError(e, '保存失败');
            } finally {
                saving.value = false;
            }
        }

        watch(
            () => [form.start_date, form.target_cycle_days],
            () => {
                if (hydrating.value) return;
                const end = calcEndDate(form.start_date, form.target_cycle_days);
                if (end) form.end_date = end;
            }
        );

        watch(
            () => [form.target_daily_orders, form.ctr_7d, form.cvr_7d],
            () => {
                if (hydrating.value) return;
                const impressions = calcRequiredImpressions(
                    form.target_daily_orders,
                    form.ctr_7d,
                    form.cvr_7d
                );
                if (impressions != null) form.required_impressions = impressions;
                const cap = calcBudgetCap(form.required_impressions, form.cpc);
                if (cap != null) form.budget_cap = cap;
            }
        );

        watch(
            () => [form.required_impressions, form.cpc],
            () => {
                if (hydrating.value) return;
                const cap = calcBudgetCap(form.required_impressions, form.cpc);
                if (cap != null) form.budget_cap = cap;
            }
        );

        watch(
            () => form.current_daily_orders,
            () => {
                if (hydrating.value) return;
                recalcMaxLossFromOrders();
            }
        );

        watch(
            () => [form.fba_warehouse_qty, form.current_daily_orders],
            () => {
                if (hydrating.value) return;
                const days = calcInventoryDays(form.fba_warehouse_qty, form.current_daily_orders);
                if (days != null) form.inventory_days = days;
            }
        );

        onMounted(loadForm);

        return {
            sprintId, users, error, saving, querying, form, isEdit, pageTitle,
            submitForm, queryAsin
        };
    },
    template: `<router-link to="/sprints" class="back-link">← 返回冲刺广告</router-link>
            <div class="page-header">
                <h1>{{ pageTitle }}</h1>
                <div class="page-desc">字段校验严格，ASIN 唯一</div>
            </div>

            <div v-if="error" style="background:#fef0f0; border:1px solid #fde2e2; color:#f56c6c; padding:12px 16px; border-radius:8px; margin-bottom:16px;">
                {{ error }}
            </div>

            <form @submit.prevent="submitForm" style="max-width:980px;">
                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">基础信息</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">ASIN *</div>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <input v-model="form.asin" class="search-input" style="width:100%;" :readonly="isEdit" required>
                                    <button type="button" class="btn-sm" :disabled="querying" @click="queryAsin">{{ querying ? '查询中...' : '查询' }}</button>
                                </div>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">负责人</div>
                                <select v-model="form.owner_id" class="filter-select" style="width:100%;">
                                    <option value="">未指定</option>
                                    <option v-for="u in users" :key="u.id" :value="String(u.id)">{{ u.name }} ({{ u.role }})</option>
                                </select>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">状态</div>
                                <select v-model="form.status" class="filter-select" style="width:100%;" required>
                                    <option value="ACTIVE">ACTIVE</option>
                                    <option value="MAINTENANCE">MAINTENANCE</option>
                                    <option value="STOPPED">STOPPED</option>
                                </select>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">开始日期 *</div>
                                <input v-model="form.start_date" class="search-input" style="width:100%;" type="date" required>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">结束日期 *</div>
                                <input v-model="form.end_date" class="search-input" style="width:100%;" type="date" required>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">目标周期(天)</div>
                                <input v-model.number="form.target_cycle_days" class="search-input" style="width:100%;" type="number" min="0" step="any" required>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">业务目标</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">当前日均单量</div>
                                <input v-model="form.current_daily_orders" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">目标日均单量</div>
                                <input v-model="form.target_daily_orders" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">当前排名</div>
                                <input v-model="form.current_rank" class="search-input" style="width:100%;" type="text" placeholder="请输入小类排名xx名, 大类排名xx名">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">目标排名</div>
                                <input v-model="form.target_rank" class="search-input" style="width:100%;" type="text" placeholder="请输入小类排名xx名, 大类排名xx名">
                            </div>
                            <div style="grid-column: span 4;">
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">冲刺目标</div>
                                <input v-model="form.sprint_goal" class="search-input" style="width:100%;" type="text" maxlength="500">
                            </div>
                            <div style="grid-column: span 4;">
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">冲刺关键词</div>
                                <textarea v-model="form.sprint_keywords" class="sop-remark" rows="3" placeholder="一行一个或逗号分隔"></textarea>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">7日日均CTR(%)</div>
                                <input v-model="form.ctr_7d" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">7日日均CVR(%)</div>
                                <input v-model="form.cvr_7d" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">CPC($)</div>
                                <input v-model="form.cpc" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">所需曝光</div>
                                <input v-model="form.required_impressions" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">财务风控</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">推广期允许TACOS(%)</div>
                                <input v-model="form.promo_tacos_limit" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">稳定期目标TACOS(%)</div>
                                <input v-model="form.stable_tacos_target" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">7天最大亏损额度($)</div>
                                <input v-model="form.max_loss_7d" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">利润率(%)</div>
                                <input v-model="form.profit_margin" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">预算上限($)</div>
                                <input v-model="form.budget_cap" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">市场与供应链</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">FBA仓库数量</div>
                                <input v-model="form.fba_warehouse_qty" class="search-input" style="width:100%;" type="number" min="0" step="any">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">库存可支撑天数</div>
                                <input v-model="form.inventory_days" class="search-input" style="width:100%;" type="number" min="0" step="1">
                                <div style="font-size:12px; color:#909399; margin-top:4px;">低于 30 天会在列表标黄预警</div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; padding-top:22px;">
                                <input v-model="form.page_ok" type="checkbox" :true-value="true" :false-value="false">
                                <span style="font-size:14px;">页面是否达标</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">退出条件</div></div>
                    <div class="module-body">
                        <textarea v-model="form.exit_conditions" class="sop-remark" rows="4" placeholder="如：触发7天最大亏损额度 / 连续7天单量未达标"></textarea>
                    </div>
                </div>

                <div style="display:flex; gap:12px; align-items:center;">
                    <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                    <router-link class="btn-secondary" to="/sprints">取消</router-link>
                </div>
            </form>`
};
