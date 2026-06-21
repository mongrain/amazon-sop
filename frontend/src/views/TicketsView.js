import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { buildQuery, http } from '@/utils/index.js';

const TICKET_STATUSES = ['TODO', 'PENDING_DESIGN', 'WAITING_VERIFY', 'RESOLVED', 'FAILED'];
export default {
    name: 'TicketsView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const tickets = ref([]);
        const users = ref([]);
        const filters = ref({ asin: '', status: '', owner_id: '' });
        const loading = ref(true);

        onMounted(() => {
            const qp = route.query;
            filters.value.asin = qp.asin || '';
            filters.value.status = qp.status || '';
            filters.value.owner_id = qp.owner_id || '';
            loadData();
        });

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/tickets' + buildQuery(filters.value));
                tickets.value = data.tickets || [];
                users.value = data.users || [];
                if (data.current_asin !== undefined) filters.value.asin = data.current_asin || '';
                if (data.current_status !== undefined) filters.value.status = data.current_status || '';
                if (data.current_owner_id !== undefined) filters.value.owner_id = data.current_owner_id || '';
            } catch (e) {
                tickets.value = [];
            } finally {
                loading.value = false;
            }
        }

        function applyFilters() {
            window.history.replaceState(null, '', '/tickets' + buildQuery(filters.value));
            loadData();
        }

        function slaStyle(t) {
            if (t.sla_deadline && t.is_overdue) {
                return { color: '#f56c6c', fontWeight: '700' };
            }
            return {};
        }

        return { tickets, users, filters, loading, TICKET_STATUSES, applyFilters, slaStyle };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <h1>工单看板</h1>
                        <div class="page-desc">TODO -> PENDING_DESIGN -> WAITING_VERIFY -> RESOLVED/FAILED</div>
                    </div>
                    <router-link class="btn-sm" to="/metrics/manual">去填报数据</router-link>
                </div>
                <div class="header-actions">
                    <form @submit.prevent="applyFilters" class="search-form">
                        <input type="text" v-model="filters.asin" placeholder="筛选 ASIN..." class="search-input">
                        <select v-model="filters.status" class="filter-select" @change="applyFilters">
                            <option value="">全部状态</option>
                            <option v-for="s in TICKET_STATUSES" :key="s" :value="s">{{ s }}</option>
                        </select>
                        <select v-model="filters.owner_id" class="filter-select" @change="applyFilters">
                            <option value="">全部负责人</option>
                            <option v-for="u in users" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
                        </select>
                        <button type="submit" class="btn-secondary">筛选</button>
                    </form>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:60px">ID</th>
                            <th style="min-width:120px">ASIN</th>
                            <th style="min-width:120px">类型</th>
                            <th style="min-width:80px">等级</th>
                            <th style="min-width:140px">状态</th>
                            <th style="min-width:120px">负责人</th>
                            <th style="min-width:120px">协作</th>
                            <th style="min-width:180px">SLA截止</th>
                            <th style="min-width:220px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="9" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="!tickets.length">
                            <td colspan="9" style="text-align:center; padding:40px; color:#999;">暂无工单</td>
                        </tr>
                        <tr v-for="t in tickets" :key="t.id">
                            <td>{{ t.id }}</td>
                            <td><code>{{ t.asin }}</code></td>
                            <td>{{ t.ticket_type }}</td>
                            <td>{{ t.severity || '-' }}</td>
                            <td><span class="status-badge">{{ t.status }}</span></td>
                            <td>{{ t.owner_name || '-' }}</td>
                            <td>{{ t.co_owner_name || '-' }}</td>
                            <td :style="slaStyle(t)">{{ t.sla_deadline || '-' }}</td>
                            <td>
                                <a class="btn-sm" :href="'/tickets/' + t.id">打开</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>`
};
