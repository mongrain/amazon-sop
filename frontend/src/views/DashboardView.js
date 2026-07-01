import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { buildQuery, computeOperatingDays, fmtDateTime, getApiError, http, pct } from '@/utils/index.js';
import { PRODUCT_SITES } from '@/constants/product-sites.js';
import { PRODUCT_CATEGORIES } from '@/constants/product-categories.js';

export default {
    name: 'DashboardView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const loading = ref(true);
        const products = ref([]);
        const modules = ref([]);
        const categories = ref([]);
        const stats = ref({ total: 0, '待处理': 0, '进行中': 0, '已完成': 0, '跳过': 0, '已放弃': 0 });
        const filters = reactive({ search: '', category: '', status: '' });
        const page = ref(1);
        const pageSize = ref(15);
        const total = ref(0);
        const totalPages = ref(1);

        const showAddModal = ref(false);
        const showEditModal = ref(false);
        const addForm = reactive({ asin: '', name: '', category: '', site: '' });
        const editForm = reactive({ asin: '', name: '', category: '', site: '' });
        const addError = ref('');
        const editError = ref('');

        const startItem = computed(() => total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1);
        const endItem = computed(() => Math.min(page.value * pageSize.value, total.value));

        const pagination = computed(() => {
            const winSize = 5;
            let winStart = Math.max(1, page.value - Math.floor(winSize / 2));
            let winEnd = Math.min(totalPages.value, winStart + winSize - 1);
            if (winEnd - winStart < winSize - 1) winStart = Math.max(1, winEnd - winSize + 1);
            const pages = [];
            for (let p = winStart; p <= winEnd; p++) pages.push(p);
            return { winStart, winEnd, pages };
        });

        function formatOperatingDays(startedAt) {
            const days = computeOperatingDays(startedAt);
            return days != null ? `${days} 天` : '—';
        }

        async function loadData(newPage) {
            if (newPage) page.value = newPage;
            loading.value = true;
            try {
                const qs = buildQuery({
                    search: filters.search,
                    category: filters.category,
                    status: filters.status,
                    page: page.value > 1 ? page.value : undefined
                });
                const { data } = await http.get('/api/dashboard' + qs);
                products.value = data.products || [];
                modules.value = data.modules || [];
                categories.value = data.categories || [];
                stats.value = data.stats || stats.value;
                page.value = data.page || page.value;
                pageSize.value = data.pageSize || pageSize.value;
                total.value = data.total || 0;
                totalPages.value = data.totalPages || 1;
                filters.search = data.current_search || filters.search;
                filters.category = data.current_category || '';
                filters.status = data.current_status || '';
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
            }
        }

        function applyFilters() {
            loadData(1);
        }

        function goProduct(asin) {
            router.push('/product/' + asin);
        }

        function openAddModal() {
            addForm.asin = '';
            addForm.name = '';
            addForm.category = '';
            addForm.site = '';
            addError.value = '';
            showAddModal.value = true;
        }

        function openEditModal(p) {
            editForm.asin = p.asin;
            editForm.name = p.name || '';
            editForm.category = p.category || '';
            editForm.site = p.seq || '';
            editError.value = '';
            showEditModal.value = true;
        }

        async function addProduct() {
            addError.value = '';
            if (!addForm.asin.trim()) {
                addError.value = 'ASIN 为必填项';
                return;
            }
            try {
                const { data } = await http.post('/api/product', {
                    asin: addForm.asin.trim(),
                    name: addForm.name.trim(),
                    category: addForm.category.trim(),
                    site: addForm.site || null
                });
                showAddModal.value = false;
                router.push('/product/' + (data.asin || addForm.asin.trim()));
            } catch (e) {
                addError.value = getApiError(e, '新增失败');
            }
        }

        async function saveEditProduct() {
            editError.value = '';
            try {
                await http.put('/api/product/' + encodeURIComponent(editForm.asin), {
                    name: editForm.name.trim(),
                    category: editForm.category.trim(),
                    site: editForm.site || null
                });
                showEditModal.value = false;
                loadData();
            } catch (e) {
                editError.value = getApiError(e, '保存失败');
            }
        }

        async function deleteProduct(asin) {
            if (!confirm('确认删除产品 ' + asin + '？此操作不可恢复。')) return;
            try {
                await http.post('/api/product/' + encodeURIComponent(asin) + '/delete');
                loadData();
            } catch (e) {
                alert('删除失败: ' + getApiError(e, '未知错误'));
            }
        }

        onMounted(() => {
            const q = route.query;
            filters.search = q.search || '';
            filters.category = q.category || '';
            filters.status = q.status || '';
            page.value = Math.max(1, parseInt(q.page) || 1);
            loadData();
        });

        return {
            loading, products, modules, categories, stats, filters,
            page, total, totalPages, startItem, endItem, pagination,
            showAddModal, showEditModal, addForm, editForm, addError, editError,
            productSites: PRODUCT_SITES, productCategories: PRODUCT_CATEGORIES,
            pct, fmtDateTime, formatOperatingDays, loadData, applyFilters, goProduct, openAddModal, openEditModal,
            addProduct, saveEditProduct, deleteProduct
        };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div><h1>产品看板</h1></div>
                    <button class="btn-primary" type="button" @click="openAddModal">+ 新增产品</button>
                </div>
                <div class="header-actions">
                    <form class="search-form" @submit.prevent="applyFilters">
                        <input v-model="filters.search" type="text" placeholder="搜索ASIN或产品名称..." class="search-input">
                        <select v-model="filters.category" class="filter-select" @change="applyFilters">
                            <option value="">全部类别</option>
                            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
                        </select>
                        <select v-model="filters.status" class="filter-select" @change="applyFilters">
                            <option value="">全部状态</option>
                            <option value="待处理">待处理</option>
                            <option value="进行中">进行中</option>
                            <option value="已完成">已完成</option>
                            <option value="跳过">跳过</option>
                            <option value="已放弃">已放弃</option>
                        </select>
                        <button type="submit" class="btn-sm" style="display:none">搜索</button>
                    </form>
                </div>
            </div>

            <div class="stats-bar">
                <div class="stat-card"><span class="stat-number">{{ stats.total }}</span><span class="stat-label">总产品</span></div>
                <div class="stat-card"><span class="stat-number warning">{{ stats['待处理'] }}</span><span class="stat-label">待处理</span></div>
                <div class="stat-card"><span class="stat-number info">{{ stats['进行中'] }}</span><span class="stat-label">进行中</span></div>
                <div class="stat-card"><span class="stat-number success">{{ stats['已完成'] }}</span><span class="stat-label">已完成</span></div>
            </div>

            <div id="product-table">
                <div class="table-container">
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th style="min-width:50px">ID</th>
                                <th>ASIN</th>
                                <th style="min-width:200px">产品名称</th>
                                <th style="min-width:80px">站点</th>
                                <th style="min-width:100px">分类</th>
                                <th style="min-width:80px">状态</th>
                                <th style="min-width:110px">上架日期</th>
                                <th style="min-width:80px">运营天数</th>
                                <th v-for="m in modules" :key="m.id" style="min-width:100px" :title="m.name">{{ m.name.substring(0, 4) }}</th>
                                <th style="min-width:100px">总进度</th>
                                <th style="min-width:180px">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="loading">
                                <td :colspan="modules.length + 10" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                            </tr>
                            <template v-else>
                                <tr v-if="products.length === 0">
                                    <td :colspan="modules.length + 10" style="text-align:center; padding:40px; color:#999;">
                                        暂无产品数据，请先<router-link to="/import" style="color:#409eff;">导入Excel数据</router-link>
                                        或<a href="javascript:void(0)" @click.prevent="openAddModal" style="color:#409eff;">新增产品</a>
                                    </td>
                                </tr>
                                <tr v-for="p in products" :key="p.id" class="product-row" @click="goProduct(p.asin)">
                                <td>{{ p.id }}</td>
                                <td><code>{{ p.asin }}</code></td>
                                <td>{{ p.name || '-' }}</td>
                                <td>{{ p.seq || '-' }}</td>
                                <td>{{ p.category || '-' }}</td>
                                <td><span class="status-badge" :class="'status-' + (p.status || '待处理')">{{ p.status || '待处理' }}</span></td>
                                <td>{{ p.listed_at ? fmtDateTime(p.listed_at) : '—' }}</td>
                                <td>{{ formatOperatingDays(p.operating_started_at) }}</td>
                                <td v-for="m in modules" :key="m.id">
                                    <div class="mini-progress">
                                        <div class="mini-bar" :style="{ width: pct((p.module_progress[m.id] || {}).percentage) + '%' }"></div>
                                        <span class="mini-text">{{ (p.module_progress[m.id] || {}).completed || 0 }}/{{ (p.module_progress[m.id] || {}).total || 0 }}</span>
                                    </div>
                                </td>
                                <td>
                                    <div class="progress-bar">
                                        <div class="progress-fill" :style="{ width: pct(p.overall_progress) + '%' }"></div>
                                        <span class="progress-text">{{ pct(p.overall_progress) }}%</span>
                                    </div>
                                </td>
                                <td @click.stop style="display:flex; gap:6px;">
                                    <a :href="'/product/' + p.asin" class="btn-sm whitespace-nowrap">详情</a>
                                    <button class="btn-sm whitespace-nowrap" type="button" @click="openEditModal(p)">编辑</button>
                                    <button class="btn-sm whitespace-nowrap" type="button" style="color:var(--danger);border-color:var(--danger);" @click="deleteProduct(p.asin)">删除</button>
                                </td>
                            </tr>
                            </template>
                        </tbody>
                    </table>
                </div>
            </div>

            <div v-if="totalPages > 1 || total > 0" class="pagination-bar">
                <div class="pagination-info">共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页 · 显示 {{ startItem }}-{{ endItem }}</div>
                <div class="pagination">
                    <button type="button" class="page-btn" :class="{ disabled: page <= 1 || loading }" :disabled="page <= 1 || loading" @click="loadData(page - 1)">上一页</button>
                    <template v-if="pagination.winStart > 1">
                        <button type="button" class="page-btn" :disabled="loading" @click="loadData(1)">1</button>
                        <span v-if="pagination.winStart > 2" class="page-ellipsis">…</span>
                    </template>
                    <template v-for="p in pagination.pages" :key="p">
                        <span v-if="p === page" class="page-btn active">{{ p }}</span>
                        <button v-else type="button" class="page-btn" :disabled="loading" @click="loadData(p)">{{ p }}</button>
                    </template>
                    <template v-if="pagination.winEnd < totalPages">
                        <span v-if="pagination.winEnd < totalPages - 1" class="page-ellipsis">…</span>
                        <button type="button" class="page-btn" :disabled="loading" @click="loadData(totalPages)">{{ totalPages }}</button>
                    </template>
                    <button type="button" class="page-btn" :class="{ disabled: page >= totalPages || loading }" :disabled="page >= totalPages || loading" @click="loadData(page + 1)">下一页</button>
                </div>
            </div>

            <div class="modal-overlay" :class="{ active: showAddModal }" @click.self="showAddModal = false">
                <div class="modal-box">
                    <div class="modal-header">
                        <h3>新增产品</h3>
                        <button class="modal-close" type="button" @click="showAddModal = false">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label class="required">ASIN</label>
                            <input v-model="addForm.asin" type="text" class="form-input" placeholder="例如: B0ABC12345">
                        </div>
                        <div class="form-group">
                            <label>产品名称</label>
                            <input v-model="addForm.name" type="text" class="form-input" placeholder="可选">
                        </div>
                        <div class="form-group">
                            <label>站点</label>
                            <select v-model="addForm.site" class="form-input">
                                <option value="">未设置</option>
                                <option v-for="s in productSites" :key="s" :value="s">{{ s }}</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>分类</label>
                            <select v-model="addForm.category" class="form-input">
                                <option value="">可选</option>
                                <option v-for="c in productCategories" :key="c" :value="c">{{ c }}</option>
                            </select>
                        </div>
                        <div class="modal-error">{{ addError }}</div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel" type="button" @click="showAddModal = false">取消</button>
                        <button class="btn-submit" type="button" @click="addProduct">确认新增</button>
                    </div>
                </div>
            </div>

            <div class="modal-overlay" :class="{ active: showEditModal }" @click.self="showEditModal = false">
                <div class="modal-box">
                    <div class="modal-header">
                        <h3>编辑产品</h3>
                        <button class="modal-close" type="button" @click="showEditModal = false">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>ASIN（不可修改）</label>
                            <input v-model="editForm.asin" type="text" class="form-input" readonly style="background:#f5f5f5;">
                        </div>
                        <div class="form-group">
                            <label>产品名称</label>
                            <input v-model="editForm.name" type="text" class="form-input">
                        </div>
                        <div class="form-group">
                            <label>站点</label>
                            <select v-model="editForm.site" class="form-input">
                                <option value="">未设置</option>
                                <option v-for="s in productSites" :key="s" :value="s">{{ s }}</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>分类</label>
                            <select v-model="editForm.category" class="form-input">
                                <option value="">可选</option>
                                <option v-for="c in productCategories" :key="c" :value="c">{{ c }}</option>
                                <option v-if="editForm.category && !productCategories.includes(editForm.category)" :value="editForm.category">{{ editForm.category }}</option>
                            </select>
                        </div>
                        <div class="modal-error">{{ editError }}</div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel" type="button" @click="showEditModal = false">取消</button>
                        <button class="btn-submit" type="button" @click="saveEditProduct">保存修改</button>
                    </div>
                </div>
            </div>`
};
