import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { http } from '@/utils/index.js';

export default {
    name: 'SprintsView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const sprints = ref([]);
        const loading = ref(true);

        onMounted(loadData);

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/sprints');
                sprints.value = data.sprints || [];
            } catch (e) {
                sprints.value = [];
            } finally {
                loading.value = false;
            }
        }

        function invStyle(sp) {
            if (sp.inventory_days !== null && sp.inventory_days !== undefined && sp.inventory_days < 30) {
                return { color: '#e6a23c', fontWeight: '700' };
            }
            return {};
        }

        function fmtVal(v) {
            return v === null || v === undefined ? '-' : v;
        }

        return { sprints, loading, invStyle, fmtVal };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <h1>冲刺项目</h1>
                        <div class="page-desc">立项 -> 数据追踪 -> 规则诊断 -> 工单流转 -> 举证验收</div>
                    </div>
                    <router-link class="btn-primary" to="/sprints/new">+ 新建冲刺项目</router-link>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:50px">ID</th>
                            <th style="min-width:120px">ASIN</th>
                            <th style="min-width:120px">负责人</th>
                            <th style="min-width:120px">状态</th>
                            <th style="min-width:160px">周期</th>
                            <th style="min-width:140px">库存天数</th>
                            <th style="min-width:140px">利润率%</th>
                            <th style="min-width:160px">亏损额度(7D)</th>
                            <th style="min-width:160px">ACOS上限</th>
                            <th style="min-width:200px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="10" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="!sprints.length">
                            <td colspan="10" style="text-align:center; padding:40px; color:#999;">暂无冲刺项目</td>
                        </tr>
                        <tr v-for="sp in sprints" :key="sp.id">
                            <td>{{ sp.id }}</td>
                            <td><code>{{ sp.asin }}</code></td>
                            <td>{{ sp.owner_name || '-' }}</td>
                            <td><span class="status-badge">{{ sp.status }}</span></td>
                            <td>{{ sp.start_date }} ~ {{ sp.end_date }}</td>
                            <td :style="invStyle(sp)">{{ fmtVal(sp.inventory_days) }}</td>
                            <td>{{ fmtVal(sp.profit_margin) }}</td>
                            <td>{{ fmtVal(sp.max_loss_7d) }}</td>
                            <td>{{ fmtVal(sp.acos_limit) }}</td>
                            <td>
                                <a class="btn-sm" :href="'/sprints/' + sp.id">编辑</a>
                                <a class="btn-sm" :href="'/tickets?asin=' + encodeURIComponent(sp.asin)">查看工单</a>
                                <a class="btn-sm" :href="'/reviews?sprint_id=' + sp.id">周复盘</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>`
};
