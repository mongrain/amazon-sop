import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getApiError, getMarkdownIt, http } from '@/utils/index.js';
import DOMPurify from 'dompurify';

const STATUS_LABELS = {
    PENDING: '排队中',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    FAILED: '失败'
};

const POLL_INTERVAL_MS = 3000;

export default {
    name: 'ProductSelectionView',
    setup() {
        const router = useRouter();
        const error = ref('');
        const submitting = ref(false);
        const currentAnalysis = ref(null);
        const history = ref([]);
        const historyLoading = ref(true);
        let pollTimer = null;

        const form = reactive({
            asin: '',
            competitor_url: '',
            box_length: '',
            box_width: '',
            box_height: '',
            box_gross_weight: '',
            box_quantity: '',
            purchase_price: ''
        });

        const isPolling = computed(() => {
            const status = currentAnalysis.value && currentAnalysis.value.status;
            return status === 'PENDING' || status === 'PROCESSING';
        });

        const statusLabel = computed(() => {
            if (!currentAnalysis.value) return '';
            return STATUS_LABELS[currentAnalysis.value.status] || currentAnalysis.value.status;
        });

        const reportHtml = computed(() => {
            const report = currentAnalysis.value && currentAnalysis.value.report;
            if (!report) return '';
            const md = getMarkdownIt();
            return DOMPurify.sanitize(md.render(report));
        });

        function resetForm() {
            form.asin = '';
            form.competitor_url = '';
            form.box_length = '';
            form.box_width = '';
            form.box_height = '';
            form.box_gross_weight = '';
            form.box_quantity = '';
            form.purchase_price = '';
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        async function fetchAnalysis(id) {
            const { data } = await http.get('/api/product-selection/analyses/' + id);
            currentAnalysis.value = data.analysis;
            if (data.analysis.status === 'COMPLETED' || data.analysis.status === 'FAILED') {
                stopPolling();
                loadHistory();
            }
        }

        function startPolling(id) {
            stopPolling();
            pollTimer = setInterval(() => {
                fetchAnalysis(id).catch(() => {});
            }, POLL_INTERVAL_MS);
        }

        async function loadHistory() {
            historyLoading.value = true;
            try {
                const { data } = await http.get('/api/product-selection/analyses?page=1&page_size=10');
                history.value = data.items || [];
            } catch (e) {
                // 历史列表加载失败不阻断主流程
            } finally {
                historyLoading.value = false;
            }
        }

        async function submitAnalysis() {
            error.value = '';
            submitting.value = true;
            stopPolling();
            try {
                const { data } = await http.post('/api/product-selection/analyses', { ...form });
                currentAnalysis.value = data.analysis;
                resetForm();
                startPolling(data.analysis.id);
                loadHistory();
            } catch (e) {
                error.value = getApiError(e, '提交失败');
            } finally {
                submitting.value = false;
            }
        }

        async function viewHistoryItem(item) {
            error.value = '';
            stopPolling();
            try {
                await fetchAnalysis(item.id);
                if (item.status === 'PENDING' || item.status === 'PROCESSING') {
                    startPolling(item.id);
                }
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        async function sendToAiOffice() {
            if (!currentAnalysis.value || currentAnalysis.value.status !== 'COMPLETED') return;
            error.value = '';
            try {
                const a = currentAnalysis.value;
                const { data } = await http.post('/api/ai-office/tasks', {
                    title: `选品分析 #${a.id}: ${a.asin}`,
                    description: a.report || '',
                    assigned_agent_code: 'boss',
                    context_json: {
                        source: 'product_selection',
                        id: a.id,
                        asin: a.asin
                    }
                });
                router.push('/ai-office/tasks/' + data.task.id);
            } catch (e) {
                error.value = getApiError(e, '提交 AI 办公室失败');
            }
        }

        onMounted(loadHistory);
        onUnmounted(stopPolling);

        return {
            form,
            error,
            submitting,
            currentAnalysis,
            history,
            historyLoading,
            isPolling,
            statusLabel,
            reportHtml,
            submitAnalysis,
            viewHistoryItem,
            sendToAiOffice,
            STATUS_LABELS
        };
    },
    template: `<div class="page-header">
                <h1>选品分析</h1>
                <p class="page-desc">录入 ASIN、竞品库地址、箱规与进货价，提交后系统将异步生成分析报告</p>
            </div>

            <div v-if="error" class="selection-alert selection-alert-error">{{ error }}</div>

            <div class="selection-layout">
                <div class="selection-form-card module-card">
                    <div class="module-header" style="cursor:default;">
                        <div class="module-name">录入信息</div>
                    </div>
                    <div class="module-body">
                        <form @submit.prevent="submitAnalysis" class="selection-form">
                            <div class="selection-form-group">
                                <label class="selection-label">ASIN <span class="required">*</span></label>
                                <input v-model="form.asin" class="search-input selection-input-full" placeholder="B012EBC0OG" maxlength="10" required>
                            </div>
                            <div class="selection-form-group">
                                <label class="selection-label">竞品库地址 <span class="required">*</span></label>
                                <input v-model="form.competitor_url" class="search-input selection-input-full" placeholder="https://..." required>
                            </div>
                            <div class="selection-form-row">
                                <div class="selection-form-group">
                                    <label class="selection-label">长 (cm) <span class="required">*</span></label>
                                    <input v-model="form.box_length" type="number" step="0.01" min="0" class="search-input selection-input-full" required>
                                </div>
                                <div class="selection-form-group">
                                    <label class="selection-label">宽 (cm) <span class="required">*</span></label>
                                    <input v-model="form.box_width" type="number" step="0.01" min="0" class="search-input selection-input-full" required>
                                </div>
                                <div class="selection-form-group">
                                    <label class="selection-label">高 (cm) <span class="required">*</span></label>
                                    <input v-model="form.box_height" type="number" step="0.01" min="0" class="search-input selection-input-full" required>
                                </div>
                            </div>
                            <div class="selection-form-row">
                                <div class="selection-form-group">
                                    <label class="selection-label">毛重 (kg) <span class="required">*</span></label>
                                    <input v-model="form.box_gross_weight" type="number" step="0.001" min="0" class="search-input selection-input-full" required>
                                </div>
                                <div class="selection-form-group">
                                    <label class="selection-label">箱装数量 <span class="required">*</span></label>
                                    <input v-model="form.box_quantity" type="number" step="1" min="1" class="search-input selection-input-full" required>
                                </div>
                                <div class="selection-form-group">
                                    <label class="selection-label">进货价 (¥) <span class="required">*</span></label>
                                    <input v-model="form.purchase_price" type="number" step="0.01" min="0" class="search-input selection-input-full" required>
                                </div>
                            </div>
                            <div class="selection-form-actions">
                                <button type="submit" class="btn-primary" :disabled="submitting || isPolling">
                                    {{ submitting ? '提交中…' : (isPolling ? '处理中…' : '开始处理') }}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="selection-result-card module-card">
                    <div class="module-header" style="cursor:default;">
                        <div class="module-name">分析结果</div>
                        <span v-if="currentAnalysis" class="selection-status-badge" :class="'selection-status-' + currentAnalysis.status">
                            {{ statusLabel }}
                            <span v-if="isPolling" class="selection-polling-dot">…</span>
                        </span>
                    </div>
                    <div class="module-body">
                        <div v-if="!currentAnalysis" class="selection-empty">填写信息并点击「开始处理」后，将在此显示分析进度与报告</div>
                        <template v-else>
                            <div v-if="currentAnalysis.status === 'FAILED'" class="selection-alert selection-alert-error">
                                {{ currentAnalysis.error_message || '分析失败，请重试' }}
                            </div>
                            <div v-else-if="isPolling" class="selection-processing">
                                <div class="selection-spinner"></div>
                                <p>正在处理中，请稍候…</p>
                                <p class="selection-processing-hint">系统会自动刷新状态，无需手动操作</p>
                            </div>
                            <div v-else-if="currentAnalysis.status === 'COMPLETED' && reportHtml" class="selection-report markdown-body" v-html="reportHtml"></div>
                            <div v-if="currentAnalysis.status === 'COMPLETED'" style="margin-top:12px;">
                                <button type="button" class="btn-secondary" @click="sendToAiOffice">交给 AI 办公室</button>
                            </div>
                        </template>
                    </div>
                </div>
            </div>

            <div class="selection-history module-card" style="margin-top:16px;">
                <div class="module-header" style="cursor:default;">
                    <div class="module-name">历史记录</div>
                </div>
                <div class="module-body">
                    <div v-if="historyLoading" class="selection-empty">加载中…</div>
                    <div v-else-if="!history.length" class="selection-empty">暂无历史记录</div>
                    <div v-else class="table-container" style="max-height:none;">
                        <table class="product-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>ASIN</th>
                                    <th>竞品库地址</th>
                                    <th>进货价</th>
                                    <th>状态</th>
                                    <th>创建时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="item in history" :key="item.id">
                                    <td>{{ item.id }}</td>
                                    <td>{{ item.asin }}</td>
                                    <td class="selection-url-cell" :title="item.competitor_url">{{ item.competitor_url }}</td>
                                    <td>¥{{ item.purchase_price }}</td>
                                    <td>
                                        <span class="selection-status-badge" :class="'selection-status-' + item.status">
                                            {{ STATUS_LABELS[item.status] || item.status }}
                                        </span>
                                    </td>
                                    <td>{{ item.created_at }}</td>
                                    <td><button type="button" class="btn-link" @click="viewHistoryItem(item)">查看</button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`
};
