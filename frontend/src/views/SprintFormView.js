import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

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
        const form = reactive({
            asin: '', owner_id: '', status: 'ACTIVE', start_date: '', end_date: '',
            target_cycle_days: 14, current_daily_orders: '', target_daily_orders: '',
            current_rank: '', target_rank: '', promo_tacos_limit: '', stable_tacos_target: '',
            max_loss_7d: '', acos_limit: '', profit_margin: '', inventory_days: '',
            competitor_action: '', page_ok: false, exit_conditions: ''
        });

        const isEdit = computed(() => !!sprintId.value);
        const pageTitle = computed(() => isEdit.value ? '编辑冲刺项目' : '新建冲刺项目');

        async function loadForm() {
            try {
                const qs = sprintId.value ? ('?id=' + encodeURIComponent(sprintId.value)) : '';
                const { data } = await http.get('/api/sprints/form' + qs);
                users.value = data.users || [];
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
                    form.promo_tacos_limit = s.promo_tacos_limit != null ? s.promo_tacos_limit : '';
                    form.stable_tacos_target = s.stable_tacos_target != null ? s.stable_tacos_target : '';
                    form.max_loss_7d = s.max_loss_7d != null ? s.max_loss_7d : '';
                    form.acos_limit = s.acos_limit != null ? s.acos_limit : '';
                    form.profit_margin = s.profit_margin != null ? s.profit_margin : '';
                    form.inventory_days = s.inventory_days != null ? s.inventory_days : '';
                    form.competitor_action = s.competitor_action || '';
                    form.page_ok = Number(s.page_ok) === 1;
                    form.exit_conditions = s.exit_conditions || '';
                }
                error.value = data.error || '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        async function submitForm() {
            error.value = '';
            saving.value = true;
            const payload = { ...form, page_ok: form.page_ok ? 1 : 0 };
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

        onMounted(loadForm);

        return { sprintId, users, error, saving, form, isEdit, pageTitle, submitForm };
    },
    template: `<router-link to="/sprints" class="back-link">← 返回冲刺项目</router-link>
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
                                <input v-model="form.asin" class="search-input" style="width:100%;" :readonly="isEdit" required>
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
                                <input v-model="form.current_rank" class="search-input" style="width:100%;" type="number" min="0">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">目标排名</div>
                                <input v-model="form.target_rank" class="search-input" style="width:100%;" type="number" min="0">
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
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">ACOS上限(%)</div>
                                <input v-model="form.acos_limit" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">利润率(%)</div>
                                <input v-model="form.profit_margin" class="search-input" style="width:100%;" type="number" step="0.01" min="0">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">市场与供应链</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">库存可支撑天数</div>
                                <input v-model="form.inventory_days" class="search-input" style="width:100%;" type="number" min="0">
                                <div style="font-size:12px; color:#909399; margin-top:4px;">低于 30 天会在列表标黄预警</div>
                            </div>
                            <div style="grid-column: span 2;">
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">竞品当前动作</div>
                                <input v-model="form.competitor_action" class="search-input" style="width:100%;">
                            </div>
                            <div style="grid-column: span 3; display:flex; align-items:center; gap:8px; padding-top:4px;">
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
