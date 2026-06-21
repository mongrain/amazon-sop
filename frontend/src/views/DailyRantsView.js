import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { buildQuery, fmtDateTime, http } from '@/utils/index.js';

export default {
    name: 'DailyRantsView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const rants = ref([]);
        const keyword = ref('');
        const page = ref(1);
        const totalPages = ref(1);
        const total = ref(0);
        const isManager = ref(false);
        const currentUser = ref(null);
        const loading = ref(true);

        onMounted(() => {
            const qp = route.query;
            keyword.value = qp.keyword || '';
            page.value = Math.max(1, parseInt(qp.page) || 1);
            loadData();
        });

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/daily-rants' + buildQuery({ keyword: keyword.value, page: page.value }));
                rants.value = data.rants || [];
                keyword.value = data.keyword || keyword.value;
                page.value = data.page || page.value;
                totalPages.value = data.totalPages || 1;
                total.value = data.total || 0;
                isManager.value = !!data.isManager;
                currentUser.value = data.currentUser || null;
            } catch (e) {
                rants.value = [];
            } finally {
                loading.value = false;
            }
        }

        function search() {
            page.value = 1;
            window.history.replaceState(null, '', '/daily-rants' + buildQuery({ keyword: keyword.value, page: page.value }));
            loadData();
        }

        function resetSearch() {
            keyword.value = '';
            page.value = 1;
            window.history.replaceState(null, '', '/daily-rants');
            loadData();
        }

        function goPage(p) {
            page.value = p;
            window.history.replaceState(null, '', '/daily-rants' + buildQuery({ keyword: keyword.value, page: page.value }));
            loadData();
        }

        function fmtDate(dt) {
            if (!dt) return '-';
            if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
            const d = dt instanceof Date ? dt : new Date(dt);
            if (Number.isNaN(d.getTime())) return String(dt);
            return d.toLocaleDateString('zh-CN');
        }

        function excerpt(text, len) {
            const plain = String(text || '').replace(/[#>*`[\]()!|-]/g, ' ').replace(/\s+/g, ' ').trim();
            if (!plain) return '-';
            return plain.length > len ? plain.slice(0, len) + '…' : plain;
        }

        function goRant(id) {
            router.push('/daily-rants/' + id);
        }

        return { rants, keyword, page, totalPages, total, isManager, currentUser, loading, search, resetSearch, goPage, fmtDate, fmtDateTime, excerpt, goRant };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div>
                        <h1>每日吐槽</h1>
                        <div class="page-desc">{{ isManager ? '记录每日心声，支持 Markdown；管理员可查看全员吐槽' : '记录每日心声，支持 Markdown；仅显示你自己的吐槽' }}</div>
                        <form @submit.prevent="search" class="search-form" style="margin-top:12px;">
                            <input type="text" v-model="keyword" class="search-input" :placeholder="isManager ? '搜索内容或作者' : '搜索内容'">
                            <button type="submit" class="btn-secondary" style="padding:8px 16px;">搜索</button>
                            <a v-if="keyword" href="javascript:void(0)" @click.prevent="resetSearch" class="btn-secondary" style="padding:8px 16px;">重置</a>
                        </form>
                    </div>
                    <router-link to="/daily-rants/new" class="btn-primary">+ 写吐槽</router-link>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:50px">ID</th>
                            <th style="min-width:110px">日期</th>
                            <th style="min-width:100px">作者</th>
                            <th style="min-width:360px">摘要</th>
                            <th style="min-width:160px">更新时间</th>
                            <th style="min-width:80px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="6" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="!rants.length">
                            <td colspan="6" style="text-align:center; padding:40px; color:#999;">
                                {{ keyword ? '未找到相关吐槽' : '暂无吐槽，点击右上角「写吐槽」开始' }}
                            </td>
                        </tr>
                        <tr v-for="rant in rants" :key="rant.id" class="product-row" @click="goRant(rant.id)">
                            <td>{{ rant.id }}</td>
                            <td>{{ fmtDate(rant.rant_date) }}</td>
                            <td>
                                <span style="font-weight:500;">{{ rant.author_name }}</span>
                                <span v-if="currentUser && rant.user_id === currentUser.id" style="font-size:11px; color:var(--primary); margin-left:4px;">我</span>
                            </td>
                            <td style="color:var(--text-secondary); max-width:480px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ excerpt(rant.content, 80) }}</td>
                            <td>{{ fmtDateTime(rant.updated_at) }}</td>
                            <td @click.stop>
                                <a :href="'/daily-rants/' + rant.id" style="color:var(--primary); text-decoration:none; font-size:13px;">查看</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div v-if="totalPages > 1" style="display:flex; justify-content:center; gap:8px; margin-top:20px; align-items:center;">
                <a v-if="page > 1" href="javascript:void(0)" @click.prevent="goPage(page - 1)" class="btn-secondary" style="padding:6px 14px;">上一页</a>
                <span style="font-size:13px; color:var(--text-secondary);">第 {{ page }} / {{ totalPages }} 页（共 {{ total }} 条）</span>
                <a v-if="page < totalPages" href="javascript:void(0)" @click.prevent="goPage(page + 1)" class="btn-secondary" style="padding:6px 14px;">下一页</a>
            </div>`
};
