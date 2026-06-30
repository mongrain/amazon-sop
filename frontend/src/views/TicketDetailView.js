import { onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

const STATUS_OPTIONS = ['TODO', 'PENDING_DESIGN', 'WAITING_VERIFY', 'RESOLVED', 'FAILED'];

function resolveTicketId(route) {
    return route.params.id ? String(route.params.id) : null;
}
export default {
    name: 'TicketDetailView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const ticketId = ref(resolveTicketId(route));
        const ticket = ref(null);
        const users = ref([]);
        const error = ref('');
        const assignForm = reactive({ owner_id: '', co_owner_id: '' });
        const statusForm = reactive({ status: '' });
        const designForm = reactive({ design_request: '' });
        const verifyForm = reactive({ result: '', verify_evidence: '' });
        const designFile = ref(null);
        const verifyFile = ref(null);
        const busy = ref('');

        async function loadTicket() {
            if (!ticketId.value) {
                error.value = '无效的工单 ID';
                return;
            }
            try {
                const { data } = await http.get('/api/tickets/' + ticketId.value);
                ticket.value = data.ticket;
                users.value = data.users || [];
                if (ticket.value) {
                    assignForm.owner_id = ticket.value.owner_id != null ? String(ticket.value.owner_id) : '';
                    assignForm.co_owner_id = ticket.value.co_owner_id != null ? String(ticket.value.co_owner_id) : '';
                    statusForm.status = ticket.value.status || 'TODO';
                    designForm.design_request = ticket.value.design_request || '';
                    verifyForm.verify_evidence = ticket.value.verify_evidence || '';
                }
                error.value = data.error || '';
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        async function saveAssign() {
            error.value = '';
            busy.value = 'assign';
            try {
                await http.post('/api/tickets/' + ticketId.value + '/assign', {
                    owner_id: assignForm.owner_id || null,
                    co_owner_id: assignForm.co_owner_id || null
                });
                await loadTicket();
            } catch (e) {
                error.value = getApiError(e, '指派失败');
            } finally {
                busy.value = '';
            }
        }

        async function updateStatus() {
            error.value = '';
            busy.value = 'status';
            try {
                await http.post('/api/tickets/' + ticketId.value + '/status', { status: statusForm.status });
                await loadTicket();
            } catch (e) {
                error.value = getApiError(e, '更新状态失败');
            } finally {
                busy.value = '';
            }
        }

        async function submitDesignRequest() {
            error.value = '';
            busy.value = 'design';
            try {
                await http.post('/api/tickets/' + ticketId.value + '/design-request', {
                    design_request: designForm.design_request
                });
                await loadTicket();
            } catch (e) {
                error.value = getApiError(e, '提交视觉需求失败');
            } finally {
                busy.value = '';
            }
        }

        async function uploadDesignAsset() {
            if (!designFile.value) return alert('请选择文件');
            error.value = '';
            busy.value = 'asset';
            const fd = new FormData();
            fd.append('file', designFile.value);
            try {
                await http.post('/tickets/' + ticketId.value + '/design-asset', fd, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                designFile.value = null;
                await loadTicket();
            } catch (e) {
                error.value = getApiError(e, '上传失败');
            } finally {
                busy.value = '';
            }
        }

        async function submitVerify() {
            error.value = '';
            busy.value = 'verify';
            const fd = new FormData();
            fd.append('result', verifyForm.result);
            fd.append('verify_evidence', verifyForm.verify_evidence);
            if (verifyFile.value) fd.append('file', verifyFile.value);
            try {
                await http.post('/tickets/' + ticketId.value + '/verify', fd, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                verifyFile.value = null;
                await loadTicket();
            } catch (e) {
                error.value = getApiError(e, '提交验收失败');
            } finally {
                busy.value = '';
            }
        }

        function onDesignFileChange(e) {
            designFile.value = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        }

        function onVerifyFileChange(e) {
            verifyFile.value = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        }

        async function sendToAiOffice() {
            if (!ticket.value) return;
            error.value = '';
            busy.value = 'ai-office';
            try {
                const { data } = await http.post('/api/ai-office/tasks', {
                    title: `工单 #${ticketId.value}: ${ticket.value.ticket_type}`,
                    description: [ticket.value.trigger_reason, ticket.value.design_request].filter(Boolean).join('\n\n'),
                    assigned_agent_code: 'boss',
                    context_json: {
                        source: 'ticket',
                        id: Number(ticketId.value),
                        asin: ticket.value.asin
                    }
                });
                router.push('/ai-office/tasks/' + data.task.id);
            } catch (e) {
                error.value = getApiError(e, '提交 AI 办公室失败');
            } finally {
                busy.value = '';
            }
        }

        onMounted(loadTicket);

        return {
            ticket, users, error, assignForm, statusForm, designForm, verifyForm,
            busy, STATUS_OPTIONS, saveAssign, updateStatus, submitDesignRequest,
            uploadDesignAsset, submitVerify, onDesignFileChange, onVerifyFileChange, sendToAiOffice
        };
    },
    template: `<router-link to="/tickets" class="back-link">← 返回工单看板</router-link>
            <div class="page-header">
                <h1>工单详情</h1>
                <div v-if="ticket" class="page-desc">ID：{{ ticket.id }} · ASIN：<code>{{ ticket.asin }}</code> · 类型：{{ ticket.ticket_type }} · 等级：{{ ticket.severity || '-' }}</div>
                <div v-if="ticket" style="margin-top:10px;">
                    <button type="button" class="btn-secondary" :disabled="busy === 'ai-office'" @click="sendToAiOffice">
                        {{ busy === 'ai-office' ? '提交中...' : '交给 AI 办公室' }}
                    </button>
                </div>
            </div>

            <div v-if="error" style="background:#fef0f0; border:1px solid #fde2e2; color:#f56c6c; padding:12px 16px; border-radius:8px; margin-bottom:16px;">
                {{ error }}
            </div>

            <template v-if="ticket">
                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">当前状态</div></div>
                    <div class="module-body">
                        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                            <span class="status-badge">{{ ticket.status }}</span>
                            <span style="font-size:13px; color:#606266;">SLA截止：{{ ticket.sla_deadline || '-' }}</span>
                            <span style="font-size:13px; color:#606266;">负责人：{{ ticket.owner_name || '-' }}</span>
                            <span style="font-size:13px; color:#606266;">协作：{{ ticket.co_owner_name || '-' }}</span>
                        </div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">触发原因</div></div>
                    <div class="module-body">
                        <div style="white-space:pre-wrap; font-size:13px; color:#303133;">{{ ticket.trigger_reason || '-' }}</div>
                    </div>
                </div>

                <div class="module-card" style="margin-bottom:16px;">
                    <div class="module-header" style="cursor:default;"><div class="module-name">动作区</div></div>
                    <div class="module-body">
                        <form @submit.prevent="saveAssign" style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; margin-bottom:16px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">负责人</div>
                                <select v-model="assignForm.owner_id" class="filter-select">
                                    <option value="">未指定</option>
                                    <option v-for="u in users" :key="'o' + u.id" :value="String(u.id)">{{ u.name }} ({{ u.role }})</option>
                                </select>
                            </div>
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">协作人</div>
                                <select v-model="assignForm.co_owner_id" class="filter-select">
                                    <option value="">未指定</option>
                                    <option v-for="u in users" :key="'c' + u.id" :value="String(u.id)">{{ u.name }} ({{ u.role }})</option>
                                </select>
                            </div>
                            <button class="btn-secondary" type="submit" :disabled="busy === 'assign'">{{ busy === 'assign' ? '保存中...' : '保存指派' }}</button>
                        </form>

                        <form @submit.prevent="updateStatus" style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; margin-bottom:16px;">
                            <div>
                                <div style="font-size:13px; color:#606266; margin-bottom:6px;">调整状态</div>
                                <select v-model="statusForm.status" class="filter-select" required>
                                    <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                                </select>
                            </div>
                            <button class="btn-secondary" type="submit" :disabled="busy === 'status'">{{ busy === 'status' ? '更新中...' : '更新状态' }}</button>
                        </form>

                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:16px;">
                            <div style="border:1px solid #e4e7ed; border-radius:8px; padding:14px 16px;">
                                <div style="font-weight:700; margin-bottom:10px;">发起视觉需求</div>
                                <form @submit.prevent="submitDesignRequest">
                                    <textarea v-model="designForm.design_request" class="sop-remark" rows="5" placeholder="填写修改意见（提交后流转至 PENDING_DESIGN）" required></textarea>
                                    <button class="btn-primary" type="submit" style="margin-top:10px;" :disabled="busy === 'design'">{{ busy === 'design' ? '提交中...' : '提交视觉需求' }}</button>
                                </form>
                            </div>

                            <div style="border:1px solid #e4e7ed; border-radius:8px; padding:14px 16px;">
                                <div style="font-weight:700; margin-bottom:10px;">视觉资产交付</div>
                                <form @submit.prevent="uploadDesignAsset">
                                    <input type="file" required @change="onDesignFileChange">
                                    <div v-if="ticket.design_asset_url" style="margin-top:10px; font-size:13px;">
                                        当前资产：<a :href="ticket.design_asset_url" target="_blank" style="color:#409eff;">打开</a>
                                    </div>
                                    <button class="btn-primary" type="submit" style="margin-top:10px;" :disabled="busy === 'asset'">{{ busy === 'asset' ? '上传中...' : '上传并交付' }}</button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="module-card">
                    <div class="module-header" style="cursor:default;"><div class="module-name">举证式验收</div></div>
                    <div class="module-body">
                        <form @submit.prevent="submitVerify" style="max-width:900px;">
                            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                                <select v-model="verifyForm.result" class="filter-select" required>
                                    <option value="">请选择验收结果</option>
                                    <option value="RESOLVED">指标已达标 (RESOLVED)</option>
                                    <option value="FAILED">未达标 (FAILED)</option>
                                </select>
                                <span style="font-size:13px; color:#606266;">必须填写最新指标值或上传截图</span>
                            </div>
                            <div style="margin-top:10px;">
                                <textarea v-model="verifyForm.verify_evidence" class="sop-remark" rows="4" placeholder="填写当前最新指标值 / 结论说明（或仅上传文件也可）"></textarea>
                            </div>
                            <div style="margin-top:10px;">
                                <input type="file" @change="onVerifyFileChange">
                                <div v-if="ticket.verify_file_url" style="margin-top:10px; font-size:13px;">
                                    当前凭证：<a :href="ticket.verify_file_url" target="_blank" style="color:#409eff;">打开</a>
                                </div>
                            </div>
                            <button class="btn-primary" type="submit" style="margin-top:10px;" :disabled="busy === 'verify'">{{ busy === 'verify' ? '提交中...' : '提交验收' }}</button>
                        </form>
                    </div>
                </div>
            </template>`
};
