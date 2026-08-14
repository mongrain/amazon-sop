import { onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

function resolveReviewId(route) {
    return route.params.id ? String(route.params.id) : null;
}

function isEmptyField(v) {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function applySuggestion(form, suggestion) {
    if (!suggestion) return;
    const keys = ['actual_max_loss', 'actual_tacos', 'decision', 'summary'];
    for (const key of keys) {
        if (isEmptyField(form[key]) && suggestion[key] !== null && suggestion[key] !== undefined && suggestion[key] !== '') {
            form[key] = suggestion[key];
        }
    }
}

function statusLabel(status) {
    if (status === 'filled') return '已填';
    if (status === 'missing') return '缺填';
    if (status === 'upcoming') return '未到';
    return '-';
}

function fmtVal(v) {
    return v === null || v === undefined || v === '' ? '-' : v;
}

export default {
    name: 'ReviewFormView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const reviewId = ref(resolveReviewId(route));
        const review = ref(null);
        const sprint = ref(null);
        const week = ref(null);
        const error = ref('');
        const pullMsg = ref('');
        const saving = ref(false);
        const pulling = ref(false);
        const form = reactive({
            actual_max_loss: '', actual_tacos: '', decision: '', status: 'PENDING', summary: ''
        });

        function hydrateReview(data, { fillSuggestion }) {
            review.value = data.review;
            sprint.value = data.sprint || null;
            week.value = data.week || null;
            if (!review.value || !fillSuggestion) return;
            form.actual_max_loss = review.value.actual_max_loss != null ? review.value.actual_max_loss : '';
            form.actual_tacos = review.value.actual_tacos != null ? review.value.actual_tacos : '';
            form.decision = review.value.decision || '';
            form.status = review.value.status || 'PENDING';
            form.summary = review.value.summary || '';
            if (review.value.status !== 'COMPLETED') {
                applySuggestion(form, data.suggestion);
            }
        }

        async function loadReview(fillSuggestion) {
            if (!reviewId.value) {
                error.value = '无效的复盘 ID';
                return;
            }
            try {
                const { data } = await http.get('/api/reviews/' + reviewId.value);
                hydrateReview(data, { fillSuggestion: fillSuggestion !== false });
                error.value = data.error || '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        async function pullLingxing() {
            if (!reviewId.value) return;
            if (pulling.value) return;
            pulling.value = true;
            pullMsg.value = '';
            error.value = '';
            try {
                const { data } = await http.post('/api/reviews/' + reviewId.value + '/lingxing-pull');
                week.value = data.week || week.value;
                pullMsg.value = `已补 ${data.filled || 0} 天，跳过已录入 ${data.skipped_existing || 0} 天，领星无数据 ${data.missing_in_lingxing || 0} 天`;
                if (review.value && review.value.status !== 'COMPLETED') {
                    applySuggestion(form, data.suggestion);
                }
            } catch (e) {
                error.value = getApiError(e, '领星拉取失败');
                await loadReview(false);
            } finally {
                pulling.value = false;
            }
        }

        async function submitForm() {
            error.value = '';
            saving.value = true;
            try {
                await http.post('/api/reviews/' + reviewId.value, { ...form });
                router.push('/reviews?sprint_id=' + (review.value && review.value.sprint_id ? review.value.sprint_id : ''));
            } catch (e) {
                error.value = getApiError(e, '保存失败');
            } finally {
                saving.value = false;
            }
        }

        onMounted(() => loadReview(true));

        return {
            review, sprint, week, error, pullMsg, saving, pulling, form,
            submitForm, pullLingxing, statusLabel, fmtVal
        };
    },
    template: `<a v-if="review" :href="'/reviews?sprint_id=' + review.sprint_id" class="back-link">← 返回周复盘列表</a>
            <div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <h1>周复盘填写</h1>
                        <div v-if="review" class="page-desc">ASIN：<code>{{ review.asin }}</code> · 周起始日：{{ review.week_start_date }}</div>
                    </div>
                    <button v-if="review && review.status !== 'COMPLETED'" class="btn-secondary" type="button" :disabled="pulling || saving" @click="pullLingxing">{{ pulling ? '拉取中...' : '从领星拉取' }}</button>
                </div>
            </div>

            <div v-if="error" style="background:#fef0f0; border:1px solid #fde2e2; color:#f56c6c; padding:12px 16px; border-radius:8px; margin-bottom:16px;">
                {{ error }}
            </div>
            <div v-if="pullMsg" style="font-size:13px; color:#606266; margin-bottom:16px;">{{ pullMsg }}</div>

            <div v-if="week" class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">本周数据</div></div>
                <div class="module-body">
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
                                <tr v-for="d in week.days" :key="d.date">
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

            <div v-if="week && sprint" class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">对照</div></div>
                <div class="module-body" style="font-size:13px; color:#303133; line-height:1.8;">
                    <div v-if="sprint.sprint_goal">冲刺目标：{{ sprint.sprint_goal }}</div>
                    <div>花费合计：{{ fmtVal(week.totals && week.totals.actual_max_loss) }} vs 7天最大亏损额度：{{ fmtVal(sprint.max_loss_7d) }}</div>
                    <div>本周 TACOS：{{ fmtVal(week.totals && week.totals.actual_tacos) }} vs 推广期允许：{{ fmtVal(sprint.promo_tacos_limit) }} / 稳定期目标：{{ fmtVal(sprint.stable_tacos_target) }}</div>
                    <div>日均单量：{{ fmtVal(week.totals && week.totals.avg_daily_orders) }} vs 目标日均单量：{{ fmtVal(sprint.target_daily_orders) }}</div>
                    <div v-if="week.totals && week.totals.ctr != null">本周 CTR(%)：{{ week.totals.ctr }} vs 目标：{{ fmtVal(sprint.ctr_7d) }}</div>
                    <div v-if="week.totals && week.totals.cvr != null">本周 CVR(%)：{{ week.totals.cvr }} vs 目标：{{ fmtVal(sprint.cvr_7d) }}</div>
                    <div v-if="week.totals && week.totals.cpc != null">本周 CPC：{{ week.totals.cpc }} vs 目标：{{ fmtVal(sprint.cpc) }}</div>
                </div>
            </div>

            <form v-if="review" @submit.prevent="submitForm" style="max-width:900px;">
                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">核对</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">本周实际最大亏损($) *</div>
                                <input v-model="form.actual_max_loss" class="search-input" style="width:100%;" type="number" step="0.01" required>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">当前实际TACOS(%) *</div>
                                <input v-model="form.actual_tacos" class="search-input" style="width:100%;" type="number" step="0.01" required>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">评估与决策</div></div>
                    <div class="module-body">
                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">决策 *</div>
                                <select v-model="form.decision" class="filter-select" style="width:100%;" required>
                                    <option value="">请选择</option>
                                    <option value="CONTINUE">继续冲刺 (CONTINUE)</option>
                                    <option value="MAINTENANCE">转维护期 (MAINTENANCE)</option>
                                    <option value="STOPPED">停止 (STOPPED)</option>
                                </select>
                                <div style="font-size:12px; color:#909399; margin-top:4px;">选择 MAINTENANCE/STOPPED 会同步更新项目状态</div>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">复盘状态</div>
                                <select v-model="form.status" class="filter-select" style="width:100%;" required>
                                    <option value="PENDING">PENDING</option>
                                    <option value="COMPLETED">COMPLETED</option>
                                </select>
                            </div>
                        </div>
                        <div style="margin-top:12px;">
                            <div style="font-size:13px; color:#606266; margin-bottom:6px;">复盘结论记录 *</div>
                            <textarea v-model="form.summary" class="sop-remark" rows="6" required></textarea>
                        </div>
                    </div>
                </div>

                <div style="display:flex; gap:12px; align-items:center;">
                    <button type="submit" class="btn-primary" :disabled="saving || pulling">{{ saving ? '保存中...' : '保存' }}</button>
                    <a class="btn-secondary" :href="'/reviews?sprint_id=' + review.sprint_id">取消</a>
                </div>
            </form>`
};
