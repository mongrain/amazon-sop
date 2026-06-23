import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { buildQuery, fmtDateTime, http } from '@/utils/index.js';

export default {
    name: 'KnowledgeView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const docs = ref([]);
        const keyword = ref('');
        const page = ref(1);
        const totalPages = ref(1);
        const total = ref(0);
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
                const { data } = await http.get('/api/knowledge' + buildQuery({ keyword: keyword.value, page: page.value }));
                docs.value = data.docs || [];
                keyword.value = data.keyword || keyword.value;
                page.value = data.page || page.value;
                totalPages.value = data.totalPages || 1;
                total.value = data.total || 0;
            } catch (e) {
                docs.value = [];
            } finally {
                loading.value = false;
            }
        }

        function search() {
            page.value = 1;
            window.history.replaceState(null, '', '/knowledge' + buildQuery({ keyword: keyword.value, page: page.value }));
            loadData();
        }

        function resetSearch() {
            keyword.value = '';
            page.value = 1;
            window.history.replaceState(null, '', '/knowledge');
            loadData();
        }

        function goPage(p) {
            page.value = p;
            window.history.replaceState(null, '', '/knowledge' + buildQuery({ keyword: keyword.value, page: page.value }));
            loadData();
        }

        function excerptText(text) {
            if (!text) return '-';
            return String(text).replace(/\s+/g, ' ').trim();
        }

        async function goNewKnowledgeDoc() {
            try {
                const { data } = await http.get('/api/knowledge/draft');
                const draft = data && data.draft;
                const hasDraft = draft && (String(draft.title || '').trim() || String(draft.content || '').trim());
                if (hasDraft && confirm('检测到未发布的草稿，是否恢复？')) {
                    location.href = '/knowledge/new?load_draft=1';
                    return;
                }
            } catch (e) { /* ignore */ }
            location.href = '/knowledge/new';
        }

        function goDoc(id) {
            router.push('/knowledge/' + id);
        }

        return { docs, keyword, page, totalPages, total, loading, search, resetSearch, goPage, excerptText, fmtDateTime, goNewKnowledgeDoc, goDoc };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div>
                        <h1>知识库</h1>
                        <div class="page-desc">Write and save operational documents, support direct pasting of Word / Excel / table content</div>
                        <form @submit.prevent="search" class="search-form" style="margin-top:12px;">
                            <input type="text" v-model="keyword" class="search-input" placeholder="搜索标题或正文">
                            <button type="submit" class="btn-secondary" style="padding:8px 16px;">搜索</button>
                            <a v-if="keyword" href="javascript:void(0)" @click.prevent="resetSearch" class="btn-secondary" style="padding:8px 16px;">重置</a>
                        </form>
                    </div>
                    <a href="javascript:void(0)" class="btn-primary" @click.prevent="goNewKnowledgeDoc">+ 新建文档</a>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:50px">ID</th>
                            <th style="min-width:280px">标题</th>
                            <th style="min-width:360px">摘要</th>
                            <th style="min-width:180px">更新时间</th>
                            <th style="min-width:100px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="5" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="!docs.length">
                            <td colspan="5" style="text-align:center; padding:40px; color:#999;">
                                {{ keyword ? ('未找到包含「' + keyword + '」的文档') : '暂无文档，点击右上角「新建文档」开始编写' }}
                            </td>
                        </tr>
                        <tr v-for="doc in docs" :key="doc.id" class="product-row" @click="goDoc(doc.id)">
                            <td>{{ doc.id }}</td>
                            <td style="font-weight:500;">{{ doc.title }}</td>
                            <td style="color:var(--text-secondary); max-width:480px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ excerptText(doc.excerpt) }}</td>
                            <td>{{ fmtDateTime(doc.updated_at) }}</td>
                            <td @click.stop>
                                <a :href="'/knowledge/' + doc.id" style="color:var(--primary); text-decoration:none; font-size:13px;">打开</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div v-if="totalPages > 1" style="display:flex; justify-content:center; gap:8px; margin-top:20px; align-items:center;">
                <a v-if="page > 1" href="javascript:void(0)" @click.prevent="goPage(page - 1)" class="btn-secondary" style="padding:6px 14px;">上一页</a>
                <span style="font-size:13px; color:var(--text-secondary);">第 {{ page }} / {{ totalPages }} 页（共 {{ total }} 篇）</span>
                <a v-if="page < totalPages" href="javascript:void(0)" @click.prevent="goPage(page + 1)" class="btn-secondary" style="padding:6px 14px;">下一页</a>
            </div>`
};
