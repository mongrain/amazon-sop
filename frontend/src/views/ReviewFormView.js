import { onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

function resolveReviewId(route) {
    return route.params.id ? String(route.params.id) : null;
}
export default {
    name: 'ReviewFormView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const reviewId = ref(resolveReviewId(route));
        const review = ref(null);
        const error = ref('');
        const saving = ref(false);
        const form = reactive({
            actual_max_loss: '', actual_tacos: '', decision: '', status: 'PENDING', summary: ''
        });

        async function loadReview() {
            if (!reviewId.value) {
                error.value = '无效的复盘 ID';
                return;
            }
            try {
                const { data } = await http.get('/api/reviews/' + reviewId.value);
                review.value = data.review;
                if (review.value) {
                    form.actual_max_loss = review.value.actual_max_loss != null ? review.value.actual_max_loss : '';
                    form.actual_tacos = review.value.actual_tacos != null ? review.value.actual_tacos : '';
                    form.decision = review.value.decision || '';
                    form.status = review.value.status || 'PENDING';
                    form.summary = review.value.summary || '';
                }
                error.value = data.error || '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
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

        onMounted(loadReview);

        return { review, error, saving, form, submitForm };
    },
    template: `<a v-if="review" :href="'/reviews?sprint_id=' + review.sprint_id" class="back-link">← 返回周复盘列表</a>
            <div class="page-header">
                <h1>周复盘填写</h1>
                <div v-if="review" class="page-desc">ASIN：<code>{{ review.asin }}</code> · 周起始日：{{ review.week_start_date }}</div>
            </div>

            <div v-if="error" style="background:#fef0f0; border:1px solid #fde2e2; color:#f56c6c; padding:12px 16px; border-radius:8px; margin-bottom:16px;">
                {{ error }}
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
                    <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                    <a class="btn-secondary" :href="'/reviews?sprint_id=' + review.sprint_id">取消</a>
                </div>
            </form>`
};
