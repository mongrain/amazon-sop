import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getApiError, getMarkdownIt, http } from '@/utils/index.js';
import DOMPurify from 'dompurify';

const STATUS_LABELS = {
    QUEUED: '排队中',
    IN_PROGRESS: '执行中',
    PENDING_REVIEW: '待审核',
    DONE: '已完成',
    REJECTED: '已打回',
    FAILED: '失败'
};

const POLL_INTERVAL_MS = 4000;

export default {
    name: 'AiOfficeTaskView',
    setup() {
        const route = useRoute();
        const router = useRouter();
        const taskId = ref(route.params.id ? String(route.params.id) : '');
        const detail = ref(null);
        const error = ref('');
        const loading = ref(true);
        const acting = ref(false);
        let pollTimer = null;

        const task = computed(() => detail.value && detail.value.task);
        const logs = computed(() => (detail.value && detail.value.logs) || []);
        const subtasks = computed(() => (detail.value && detail.value.subtasks) || []);

        const isActive = computed(() => {
            const s = task.value && task.value.status;
            return s === 'QUEUED' || s === 'IN_PROGRESS' || s === 'PENDING_REVIEW';
        });

        const outputHtml = computed(() => {
            const md = task.value && task.value.output_markdown;
            if (!md) return '';
            return DOMPurify.sanitize(getMarkdownIt().render(md));
        });

        function statusLabel(status) {
            return STATUS_LABELS[status] || status;
        }

        async function loadDetail() {
            if (!taskId.value) {
                error.value = '无效的任务 ID';
                loading.value = false;
                return;
            }
            try {
                const { data } = await http.get('/api/ai-office/tasks/' + taskId.value);
                detail.value = data;
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
                loadDetail().catch(() => {});
            }, POLL_INTERVAL_MS);
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        async function reprocessTask() {
            if (!task.value) return;
            if (!confirm('确认重新处理任务「' + task.value.title + '」？已完成的子任务会保留，仅重跑未完成/失败的任务。')) return;
            acting.value = true;
            error.value = '';
            try {
                await http.post('/api/ai-office/tasks/' + taskId.value + '/reprocess');
                await loadDetail();
                startPolling();
            } catch (e) {
                error.value = getApiError(e, '重新处理失败');
            } finally {
                acting.value = false;
            }
        }

        async function deleteTask() {
            if (!task.value) return;
            if (!confirm('确认删除任务「' + task.value.title + '」？子任务与日志将一并删除，不可恢复。')) return;
            acting.value = true;
            error.value = '';
            try {
                await http.delete('/api/ai-office/tasks/' + taskId.value);
                router.push('/ai-office');
            } catch (e) {
                error.value = getApiError(e, '删除失败');
                acting.value = false;
            }
        }

        onMounted(async () => {
            await loadDetail();
            startPolling();
        });
        onUnmounted(stopPolling);

        return {
            task,
            logs,
            subtasks,
            error,
            loading,
            acting,
            isActive,
            outputHtml,
            statusLabel,
            reprocessTask,
            deleteTask
        };
    },
    template: `<router-link to="/ai-office" class="back-link">← 返回 AI 办公室</router-link>

            <div class="page-header">
                <h1>任务详情</h1>
                <div v-if="task" class="page-desc">
                    ID：{{ task.id }} · {{ task.agent_emoji }} {{ task.agent_name || '未指派' }} ·
                    <span class="status-badge">{{ statusLabel(task.status) }}</span>
                    <span v-if="isActive" style="margin-left:8px;font-size:12px;color:#909399;">自动刷新中</span>
                </div>
                <div v-if="task" class="header-actions" style="margin-top:12px;">
                    <button type="button" class="btn-secondary" :disabled="acting" @click="reprocessTask">重新处理</button>
                    <button type="button" class="btn-secondary" style="color:#f56c6c;" :disabled="acting" @click="deleteTask">删除</button>
                </div>
            </div>

            <div v-if="error" style="background:#fef0f0;border:1px solid #fde2e2;color:#f56c6c;padding:12px 16px;border-radius:8px;margin-bottom:16px;">{{ error }}</div>

            <template v-if="task">
                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">任务信息</div></div>
                    <div class="module-body">
                        <div style="font-weight:700;font-size:16px;margin-bottom:8px;">{{ task.title }}</div>
                        <div style="white-space:pre-wrap;font-size:13px;color:#303133;">{{ task.description || '（无描述）' }}</div>
                        <div style="margin-top:12px;font-size:12px;color:#909399;">
                            优先级：{{ task.priority }} · 创建：{{ task.created_at }}
                            <span v-if="task.completed_at"> · 完成：{{ task.completed_at }}</span>
                        </div>
                        <div v-if="task.review_comment" style="margin-top:10px;font-size:13px;color:#606266;">
                            审核意见：{{ task.review_comment }}
                        </div>
                        <div v-if="task.error_message" style="margin-top:10px;font-size:13px;color:#f56c6c;">
                            错误：{{ task.error_message }}
                        </div>
                    </div>
                </div>

                <div v-if="subtasks.length" class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">子任务（老板拆单）</div></div>
                    <div class="module-body">
                        <table class="product-table">
                            <thead>
                                <tr><th>ID</th><th>标题</th><th>指派</th><th>状态</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="sub in subtasks" :key="sub.id">
                                    <td>{{ sub.id }}</td>
                                    <td><router-link :to="'/ai-office/tasks/' + sub.id" style="color:#409eff;">{{ sub.title }}</router-link></td>
                                    <td>{{ sub.agent_emoji }} {{ sub.agent_name }}</td>
                                    <td><span class="status-badge">{{ statusLabel(sub.status) }}</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div v-if="outputHtml" class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">产出结果</div></div>
                    <div class="module-body markdown-body" v-html="outputHtml"></div>
                </div>

                <div class="module-card">
                    <div class="module-header" style="cursor:default;"><div class="module-name">执行日志</div></div>
                    <div class="module-body">
                        <div v-if="!logs.length" style="color:#909399;font-size:13px;">暂无日志</div>
                        <div v-for="log in logs" :key="log.id" style="border-bottom:1px solid #ebeef5;padding:10px 0;">
                            <div style="font-size:12px;color:#909399;margin-bottom:4px;">
                                {{ log.created_at }}
                                <span v-if="log.agent_emoji">{{ log.agent_emoji }}</span>
                                {{ log.agent_name || '' }}
                                · {{ log.log_type }}
                            </div>
                            <div style="font-size:13px;white-space:pre-wrap;max-height:200px;overflow:auto;">{{ log.content }}</div>
                        </div>
                    </div>
                </div>
            </template>`
};
