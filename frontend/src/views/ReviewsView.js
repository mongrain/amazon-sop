import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { buildQuery, http } from '@/utils/index.js';

export default {
    name: 'ReviewsView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const reviews = ref([]);
        const sprints = ref([]);
        const filters = ref({ sprint_id: '', status: '' });
        const loading = ref(true);

        onMounted(() => {
            const qp = route.query;
            filters.value.sprint_id = qp.sprint_id || '';
            filters.value.status = qp.status || '';
            loadData();
        });

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/reviews' + buildQuery(filters.value));
                reviews.value = data.reviews || [];
                sprints.value = data.sprints || [];
                if (data.current_sprint_id !== undefined) filters.value.sprint_id = data.current_sprint_id || '';
                if (data.current_status !== undefined) filters.value.status = data.current_status || '';
            } catch (e) {
                reviews.value = [];
            } finally {
                loading.value = false;
            }
        }

        function onFilterChange() {
            const qs = buildQuery(filters.value);
            window.history.replaceState(null, '', '/reviews' + qs);
            loadData();
        }

        function fmtVal(v) {
            return v === null || v === undefined ? '-' : v;
        }

        return { reviews, sprints, filters, loading, onFilterChange, fmtVal };
    },
    template: `<router-link to="/sprints" class="back-link">← 返回冲刺项目</router-link>
            <div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <h1>周复盘</h1>
                        <div class="page-desc">每周一 00:00 自动生成 ACTIVE 项目的复盘待办</div>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                        <select class="filter-select" v-model="filters.sprint_id" @change="onFilterChange">
                            <option value="">全部项目</option>
                            <option v-for="sp in sprints" :key="sp.id" :value="String(sp.id)">{{ sp.asin }} ({{ sp.status }})</option>
                        </select>
                        <select class="filter-select" v-model="filters.status" @change="onFilterChange">
                            <option value="">全部状态</option>
                            <option value="PENDING">PENDING</option>
                            <option value="COMPLETED">COMPLETED</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:60px">ID</th>
                            <th style="min-width:120px">ASIN</th>
                            <th style="min-width:120px">状态</th>
                            <th style="min-width:140px">周起始日</th>
                            <th style="min-width:160px">本周最大亏损</th>
                            <th style="min-width:140px">当前TACOS</th>
                            <th style="min-width:160px">决策</th>
                            <th style="min-width:200px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="8" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="!reviews.length">
                            <td colspan="8" style="text-align:center; padding:40px; color:#999;">暂无复盘记录</td>
                        </tr>
                        <tr v-for="r in reviews" :key="r.id">
                            <td>{{ r.id }}</td>
                            <td><code>{{ r.asin }}</code></td>
                            <td><span class="status-badge">{{ r.status }}</span></td>
                            <td>{{ r.week_start_date }}</td>
                            <td>{{ fmtVal(r.actual_max_loss) }}</td>
                            <td>{{ fmtVal(r.actual_tacos) }}</td>
                            <td>{{ r.decision || '-' }}</td>
                            <td>
                                <a class="btn-sm" :href="'/reviews/' + r.id">填写/查看</a>
                                <a class="btn-sm" :href="'/tickets?asin=' + encodeURIComponent(r.asin)">查看工单</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>`
};
