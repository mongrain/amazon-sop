import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';
import AiOfficeScene from '@/components/AiOfficeScene.vue';

const STATUS_LABELS = {
    QUEUED: '排队中',
    IN_PROGRESS: '执行中',
    PENDING_REVIEW: '待审核',
    DONE: '已完成',
    REJECTED: '已打回',
    FAILED: '失败'
};

const AGENT_STATUS_LABELS = {
    idle: '空闲',
    busy: '忙碌',
    reviewing: '审核中'
};

const POLL_INTERVAL_MS = 4000;

export default {
    name: 'AiOfficeView',
    components: { AiOfficeScene },
    setup() {
        const router = useRouter();
        const agents = ref([]);
        const tasks = ref([]);
        const loading = ref(true);
        const error = ref('');
        const creating = ref(false);
        const filterStatus = ref('');
        const filterAgentId = ref('');
        let pollTimer = null;

        const form = reactive({
            title: '',
            description: '',
            assigned_agent_code: 'boss',
            priority: 'NORMAL'
        });

        const executableAgents = computed(() =>
            agents.value.filter(a => a.code !== 'supervisor')
        );

        const filteredTasks = computed(() => tasks.value.filter(t => {
            if (filterStatus.value && t.status !== filterStatus.value) return false;
            if (filterAgentId.value && String(t.assigned_agent_id || '') !== filterAgentId.value) return false;
            return true;
        }));

        function statusLabel(status) {
            return STATUS_LABELS[status] || status;
        }

        function agentStatusLabel(status) {
            return AGENT_STATUS_LABELS[status] || status;
        }

        function statusClass(status) {
            if (status === 'DONE') return 'status-done';
            if (status === 'FAILED') return 'status-failed';
            if (status === 'IN_PROGRESS') return 'status-progress';
            if (status === 'PENDING_REVIEW') return 'status-review';
            return '';
        }

        async function loadData() {
            try {
                const [agentsRes, tasksRes] = await Promise.all([
                    http.get('/api/ai-office/agents'),
                    http.get('/api/ai-office/tasks')
                ]);
                agents.value = agentsRes.data.agents || [];
                tasks.value = tasksRes.data.tasks || [];
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
                loadData().catch(() => {});
            }, POLL_INTERVAL_MS);
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        async function createTask() {
            error.value = '';
            creating.value = true;
            try {
                const { data } = await http.post('/api/ai-office/tasks', { ...form });
                form.title = '';
                form.description = '';
                await loadData();
                startPolling();
                if (data.task && data.task.id) {
                    router.push('/ai-office/tasks/' + data.task.id);
                }
            } catch (e) {
                error.value = getApiError(e, '创建失败');
            } finally {
                creating.value = false;
            }
        }

        async function reprocessTask(task) {
            if (!confirm('确认重新处理任务「' + task.title + '」？已完成的子任务会保留，仅重跑未完成/失败的任务。')) return;
            error.value = '';
            try {
                await http.post('/api/ai-office/tasks/' + task.id + '/reprocess');
                await loadData();
            } catch (e) {
                error.value = getApiError(e, '重新处理失败');
            }
        }

        async function deleteTask(task) {
            if (!confirm('确认删除任务「' + task.title + '」？子任务与日志将一并删除，不可恢复。')) return;
            error.value = '';
            try {
                await http.delete('/api/ai-office/tasks/' + task.id);
                await loadData();
            } catch (e) {
                error.value = getApiError(e, '删除失败');
            }
        }

        function filterByAgent(agentId) {
            filterAgentId.value = filterAgentId.value === String(agentId) ? '' : String(agentId);
            loadData();
        }

        onMounted(async () => {
            await loadData();
            startPolling();
        });
        onUnmounted(stopPolling);

        return {
            agents,
            tasks,
            loading,
            error,
            creating,
            form,
            filterStatus,
            filterAgentId,
            executableAgents,
            filteredTasks,
            statusLabel,
            statusClass,
            loadData,
            createTask,
            reprocessTask,
            deleteTask,
            filterByAgent
        };
    },
    template: `<div class="page-header">
                <h1>AI 办公室</h1>
                <p class="page-desc">5 名 AI 员工协作 · 指派即执行 · 主管必审 · 老板可自动拆单分派</p>
            </div>

            <div v-if="error" style="background:#fef0f0;border:1px solid #fde2e2;color:#f56c6c;padding:12px 16px;border-radius:8px;margin-bottom:16px;">{{ error }}</div>

            <AiOfficeScene
                :agents="agents"
                :tasks="tasks"
                :selected-agent-id="filterAgentId"
                @select-agent="filterByAgent"
            />

            <div class="module-card" style="margin-bottom:20px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">新建任务</div></div>
                <div class="module-body">
                    <form @submit.prevent="createTask" style="display:grid;gap:12px;max-width:720px;">
                        <input v-model="form.title" class="search-input" placeholder="任务标题" required>
                        <textarea v-model="form.description" class="sop-remark" rows="4" placeholder="任务描述（可选）"></textarea>
                        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
                            <select v-model="form.assigned_agent_code" class="filter-select" required>
                                <option v-for="a in executableAgents" :key="a.code" :value="a.code">
                                    {{ a.avatar_emoji }} {{ a.name }}
                                </option>
                            </select>
                            <select v-model="form.priority" class="filter-select">
                                <option value="LOW">低优先级</option>
                                <option value="NORMAL">普通</option>
                                <option value="HIGH">高优先级</option>
                            </select>
                            <button type="submit" class="btn-primary" :disabled="creating">{{ creating ? '创建中...' : '创建并执行' }}</button>
                        </div>
                    </form>
                </div>
            </div>

            <div class="page-header" style="margin-bottom:12px;">
                <div class="header-actions">
                    <select v-model="filterStatus" class="filter-select" @change="loadData">
                        <option value="">全部状态</option>
                        <option value="IN_PROGRESS">执行中</option>
                        <option value="PENDING_REVIEW">待审核</option>
                        <option value="DONE">已完成</option>
                        <option value="FAILED">失败</option>
                    </select>
                    <button type="button" class="btn-secondary" @click="filterAgentId=''; filterStatus=''; loadData();">清除筛选</button>
                </div>
            </div>

            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>标题</th>
                            <th>指派</th>
                            <th>状态</th>
                            <th>优先级</th>
                            <th>创建时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading"><td colspan="7" style="text-align:center;color:#909399;">加载中...</td></tr>
                        <tr v-else-if="!filteredTasks.length"><td colspan="7" style="text-align:center;color:#909399;">暂无任务</td></tr>
                        <tr v-for="task in filteredTasks" :key="task.id">
                            <td>{{ task.id }}</td>
                            <td><router-link :to="'/ai-office/tasks/' + task.id" style="color:#409eff;">{{ task.title }}</router-link></td>
                            <td>{{ task.agent_emoji }} {{ task.agent_name || '-' }}</td>
                            <td><span class="status-badge" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span></td>
                            <td>{{ task.priority }}</td>
                            <td>{{ task.created_at }}</td>
                            <td style="white-space:nowrap;">
                                <button type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-right:6px;" @click="reprocessTask(task)">重新处理</button>
                                <button type="button" class="btn-secondary" style="padding:4px 10px;font-size:12px;color:#f56c6c;" @click="deleteTask(task)">删除</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>`
};
