import { computed, nextTick, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { buildQuery, fmtDateTime, getApiError, http } from '@/utils/index.js';
import { openViewer } from '@/utils/viewer.js';

function getInitialFilters(route) {
    const q = route.query;
    return {
        keyword: q.keyword || '',
        action_from: q.action_from || '',
        action_to: q.action_to || '',
        action_preset: q.action_preset || '',
        page: Math.max(1, parseInt(q.page) || 1)
    };
}
export default {
    name: 'CompetitorsView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const loading = ref(true);
        const filters = ref(getInitialFilters(route));
        const competitors = ref([]);
        const recentActions = ref({});
        const actionTotals = ref({});
        const latestMonitorRecords = ref({});
        const monitorTotals = ref({});
        const total = ref(0);
        const pageSize = ref(15);
        const totalPages = ref(1);
        const hasActionDateFilter = ref(false);
        const actionPreset = ref('');

        const addModalOpen = ref(false);
        const addBrandName = ref('');
        const addBrandCategory = ref('');
        const addStoreUrl = ref('');
        const addError = ref('');

        const editModalOpen = ref(false);
        const editId = ref('');
        const editBrandName = ref('');
        const editBrandCategory = ref('');
        const editStoreUrl = ref('');
        const editError = ref('');

        const actionModalOpen = ref(false);
        const actionCompetitorId = ref('');
        const actionBrandName = ref('');
        const actionText = ref('');
        const actionError = ref('');

        const allActionsModalOpen = ref(false);
        const allActionsTitle = ref('所有动作');
        const allActionsBody = ref('');
        const allActionsLoading = ref(false);
        const allActionsState = ref({ competitorId: null, brandName: '' });

        const monitorModalOpen = ref(false);
        const monitorRecordsTitle = ref('监控历史');
        const monitorRecordsBody = ref('');
        const monitorLoading = ref(false);
        const monitorRecordsState = ref({ competitorId: null, brandName: '' });

        const hasAnyFilter = computed(() => filters.value.keyword || hasActionDateFilter.value);
        const startItem = computed(() => total.value === 0 ? 0 : (filters.value.page - 1) * pageSize.value + 1);
        const endItem = computed(() => Math.min(filters.value.page * pageSize.value, total.value));
        const pageWindow = computed(() => {
            const pageWindowSize = 5;
            const page = filters.value.page;
            const tp = totalPages.value;
            let winStart = Math.max(1, page - Math.floor(pageWindowSize / 2));
            let winEnd = Math.min(tp, winStart + pageWindowSize - 1);
            if (winEnd - winStart < pageWindowSize - 1) winStart = Math.max(1, winEnd - pageWindowSize + 1);
            const pages = [];
            for (let p = winStart; p <= winEnd; p++) pages.push(p);
            return { winStart, winEnd, pages };
        });

        function escapeHtml(text) {
            if (text === null || text === undefined) return '';
            return String(text)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function buildPageHref(p) {
            const params = {};
            if (filters.value.keyword) params.keyword = filters.value.keyword;
            if (actionPreset.value) params.action_preset = actionPreset.value;
            else {
                if (filters.value.action_from) params.action_from = filters.value.action_from;
                if (filters.value.action_to) params.action_to = filters.value.action_to;
            }
            if (p > 1) params.page = String(p);
            return '/competitors' + buildQuery(params);
        }

        function weekHref() {
            const params = {};
            if (filters.value.keyword) params.keyword = filters.value.keyword;
            params.action_preset = 'week';
            return '/competitors' + buildQuery(params);
        }

        async function loadData(newPage) {
            if (newPage != null) filters.value.page = newPage;
            loading.value = true;
            try {
                const params = { ...filters.value };
                const { data } = await http.get('/api/competitors', { params });
                competitors.value = data.competitors || [];
                recentActions.value = data.recentActions || {};
                actionTotals.value = data.actionTotals || {};
                latestMonitorRecords.value = data.latestMonitorRecords || {};
                monitorTotals.value = data.monitorTotals || {};
                total.value = data.total || 0;
                pageSize.value = data.pageSize || 15;
                totalPages.value = data.totalPages || 1;
                hasActionDateFilter.value = data.hasActionDateFilter || false;
                actionPreset.value = data.actionPreset || '';
                if (data.page) filters.value.page = data.page;
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
            }
        }

        function syncFiltersFromRoute() {
            filters.value = getInitialFilters(route);
        }

        function search() {
            const params = {
                keyword: filters.value.keyword,
                action_from: filters.value.action_from,
                action_to: filters.value.action_to
            };
            router.push('/competitors' + buildQuery(params));
        }

        function applyWeekPreset() {
            const params = { action_preset: 'week' };
            if (filters.value.keyword) params.keyword = filters.value.keyword;
            router.push('/competitors' + buildQuery(params));
        }

        function goPage(p) {
            if (loading.value || p < 1 || p > totalPages.value || p === filters.value.page) return;
            loadData(p);
            window.history.replaceState(null, '', buildPageHref(p));
        }

        watch(
            () => route.fullPath,
            () => {
                syncFiltersFromRoute();
                loadData();
            },
            { immediate: true }
        );

        function getMonitor(c) {
            return latestMonitorRecords.value[c.id] || null;
        }
        function getMonitorCount(c) {
            return monitorTotals.value[c.id] || (getMonitor(c) ? 1 : 0);
        }
        function getActs(c) {
            return recentActions.value[c.id] || [];
        }
        function getActionTotal(c) {
            return actionTotals.value[c.id] || getActs(c).length;
        }

        function openAddModal() {
            addBrandName.value = '';
            addBrandCategory.value = '';
            addStoreUrl.value = '';
            addError.value = '';
            addModalOpen.value = true;
        }
        function openActionModal(id, brandName) {
            actionCompetitorId.value = id;
            actionBrandName.value = brandName || '';
            actionText.value = '';
            actionError.value = '';
            actionModalOpen.value = true;
        }
        function openEditModal(id, brandName, brandCategory, storeUrl) {
            editId.value = id;
            editBrandName.value = brandName || '';
            editBrandCategory.value = brandCategory || '';
            editStoreUrl.value = storeUrl || '';
            editError.value = '';
            editModalOpen.value = true;
        }
        function closeModal(name) {
            if (name === 'add') addModalOpen.value = false;
            if (name === 'edit') editModalOpen.value = false;
            if (name === 'action') actionModalOpen.value = false;
            if (name === 'allActions') allActionsModalOpen.value = false;
            if (name === 'monitor') monitorModalOpen.value = false;
        }

        async function importCompetitors() {
            if (!confirm('将从 public/竞对信息.xlsx 导入竞品信息，确认继续？')) return;
            try {
                const { data } = await http.post('/api/competitors/import');
                const errCount = (data.errors && data.errors.length) ? data.errors.length : 0;
                let msg = `导入完成（sheet: ${data.sheet || '-'}）\n新增: ${data.inserted || 0}\n更新: ${data.updated || 0}\n追加动作: ${data.actions_added || 0}\n跳过空行: ${data.skipped || 0}\n错误: ${errCount}`;
                if (errCount > 0) {
                    const preview = data.errors.slice(0, 5).map(e => `第${e.row}行：${e.error}`).join('\n');
                    msg += `\n\n前5条错误:\n${preview}`;
                }
                alert(msg);
                await loadData();
            } catch (e) {
                alert(getApiError(e, '导入失败'));
            }
        }

        async function addAction() {
            actionError.value = '';
            if (!actionCompetitorId.value) { actionError.value = 'ID 缺失'; return; }
            if (!actionText.value.trim()) { actionError.value = '动作内容为必填项'; return; }
            try {
                await http.post('/api/competitor/' + encodeURIComponent(actionCompetitorId.value) + '/action', { action_text: actionText.value.trim() });
                closeModal('action');
                await loadData();
            } catch (e) {
                actionError.value = getApiError(e, '追加失败');
            }
        }

        async function addCompetitor() {
            addError.value = '';
            if (!addBrandName.value.trim()) { addError.value = '品牌名为必填项'; return; }
            try {
                await http.post('/api/competitor', {
                    brand_name: addBrandName.value.trim(),
                    brand_category: addBrandCategory.value.trim(),
                    amazon_store_url: addStoreUrl.value.trim()
                });
                await loadData();
                closeModal('add');
            } catch (e) {
                addError.value = getApiError(e, '新增失败');
            }
        }

        async function saveEditCompetitor() {
            editError.value = '';
            if (!editId.value) { editError.value = 'ID 缺失'; return; }
            if (!editBrandName.value.trim()) { editError.value = '品牌名为必填项'; return; }
            try {
                await http.put('/api/competitor/' + encodeURIComponent(editId.value), {
                    brand_name: editBrandName.value.trim(),
                    brand_category: editBrandCategory.value.trim(),
                    amazon_store_url: editStoreUrl.value.trim()
                });
                closeModal('edit');
                await loadData();
            } catch (e) {
                editError.value = getApiError(e, '保存失败');
            }
        }

        async function deleteCompetitor(id) {
            if (!id) return;
            if (!confirm('确认删除该竞品？')) return;
            try {
                await http.delete('/api/competitor/' + encodeURIComponent(id));
                await loadData();
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function renderAllActions(actions) {
            if (!actions || actions.length === 0) {
                return '<div style="text-align:center; padding:30px; color:var(--text-secondary);">暂无动作记录</div>';
            }
            return actions.map(a => `
                <div class="action-item" data-action-id="${a.id}">
                    <div class="action-item-header">
                        <span class="action-item-time">${escapeHtml(fmtDateTime(a.created_at))}</span>
                        <button class="action-delete-btn" data-action-id="${a.id}" data-action-text="${escapeHtml(a.action_text).replace(/"/g, '&quot;')}">删除</button>
                    </div>
                    <div class="action-item-text">${escapeHtml(a.action_text)}</div>
                </div>
            `).join('');
        }

        function renderMonitorRecords(records) {
            if (!records || records.length === 0) {
                return '<div style="text-align:center; padding:30px; color:var(--text-secondary);">暂无监控记录</div>';
            }
            return records.map(record => {
                const imageUrl = escapeHtml(record.image_url || '');
                const statusStyle = Number(record.has_change) === 1 ? 'background:#fef2f2;color:#dc2626;' : 'background:#eff6ff;color:#2563eb;';
                const actionText = record.action_text
                    ? '<div style="font-size:13px; white-space:pre-wrap; word-break:break-word;">' + escapeHtml(record.action_text) + '</div>'
                    : '<div style="font-size:12px; color:var(--text-secondary);">本次无变化，未新增动作</div>';
                return `
                    <div class="action-item">
                        <div class="action-item-header" style="align-items:center;">
                            <span class="action-item-time">${escapeHtml(fmtDateTime(record.created_at))}</span>
                            <span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-size:12px; ${statusStyle}">
                                ${Number(record.has_change) === 1 ? '有变化' : '无变化'}
                            </span>
                        </div>
                        <div style="display:flex; gap:12px; align-items:flex-start;">
                            <img src="${imageUrl}" alt="监控图片" class="zoomable" onclick="openViewer(this.src)" style="width:120px; height:120px; object-fit:cover; border-radius:8px; border:1px solid var(--border-color); background:#f8fafc;">
                            <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:8px;">
                                <a href="javascript:void(0);" data-src="${imageUrl}" onclick="openViewer(this.dataset.src)" style="font-size:12px; color:var(--primary); text-decoration:none;">点击放大</a>
                                ${actionText}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function openAllActionsModal(id, brandName) {
            allActionsState.value = { competitorId: id, brandName: brandName || '' };
            allActionsTitle.value = (brandName || '竞品') + ' 的所有动作';
            allActionsBody.value = '<div style="text-align:center; padding:30px; color:var(--text-secondary);">加载中...</div>';
            allActionsModalOpen.value = true;
            await loadAllActions();
        }

        async function loadAllActions() {
            const id = allActionsState.value.competitorId;
            if (!id) return;
            allActionsLoading.value = true;
            try {
                const { data } = await http.get('/api/competitor/' + encodeURIComponent(id) + '/actions');
                allActionsBody.value = renderAllActions(data.actions || []);
                nextTickBindDeleteButtons();
            } catch (e) {
                allActionsBody.value = '<div style="text-align:center; padding:30px; color:var(--danger);">' + escapeHtml(getApiError(e, '加载失败')) + '</div>';
            } finally {
                allActionsLoading.value = false;
            }
        }

        function nextTickBindDeleteButtons() {
            nextTick(() => {
                const container = document.getElementById('allActionsBodyEl');
                if (!container) return;
                container.querySelectorAll('.action-delete-btn').forEach(btn => {
                    btn.addEventListener('click', function () {
                        const actionId = this.getAttribute('data-action-id');
                        const actionText = this.getAttribute('data-action-text') || '';
                        const preview = actionText.length > 30 ? actionText.slice(0, 30) + '...' : actionText;
                        deleteAction(actionId, preview);
                    });
                });
            });
        }

        async function openMonitorRecordsModal(id, brandName) {
            monitorRecordsState.value = { competitorId: id, brandName: brandName || '' };
            monitorRecordsTitle.value = (brandName || '竞品') + ' 的监控历史';
            monitorRecordsBody.value = '<div style="text-align:center; padding:30px; color:var(--text-secondary);">加载中...</div>';
            monitorModalOpen.value = true;
            await loadMonitorRecords();
        }

        async function loadMonitorRecords() {
            const id = monitorRecordsState.value.competitorId;
            if (!id) return;
            monitorLoading.value = true;
            try {
                const { data } = await http.get('/api/competitor/' + encodeURIComponent(id) + '/monitor-records');
                monitorRecordsBody.value = renderMonitorRecords(data.records || []);
            } catch (e) {
                monitorRecordsBody.value = '<div style="text-align:center; padding:30px; color:var(--danger);">' + escapeHtml(getApiError(e, '加载失败')) + '</div>';
            } finally {
                monitorLoading.value = false;
            }
        }

        async function deleteAction(actionId, preview) {
            if (!actionId) return;
            if (!confirm('确认删除该动作' + (preview ? ('：\n\n' + preview) : '？'))) return;
            try {
                await http.delete('/api/competitor/action/' + encodeURIComponent(actionId));
                await loadAllActions();
                await loadData();
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function openViewer(src) {
            window.openViewer(src);
        }

        return {
            loading, filters, competitors, total, totalPages, pageSize, hasActionDateFilter, actionPreset,
            hasAnyFilter, startItem, endItem, pageWindow,
            addModalOpen, addBrandName, addBrandCategory, addStoreUrl, addError,
            editModalOpen, editId, editBrandName, editBrandCategory, editStoreUrl, editError,
            actionModalOpen, actionCompetitorId, actionBrandName, actionText, actionError,
            allActionsModalOpen, allActionsTitle, allActionsBody,
            monitorModalOpen, monitorRecordsTitle, monitorRecordsBody,
            fmtDateTime, escapeHtml, search, applyWeekPreset, goPage,
            getMonitor, getMonitorCount, getActs, getActionTotal,
            openAddModal, openActionModal, openEditModal, closeModal,
            importCompetitors, addAction, addCompetitor, saveEditCompetitor, deleteCompetitor,
            openAllActionsModal, openMonitorRecordsModal, openViewer
        };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <h1>竞品库</h1>
                        <div class="page-desc">用于维护竞品品牌、店铺链接，以及外部监控团队回传的图片记录与变化动作</div>
                        <form class="search-form" style="margin-top:12px;" @submit.prevent="search">
                            <input type="text" v-model="filters.keyword" class="search-input" placeholder="查询品牌名称">
                            <input type="date" v-model="filters.action_from" class="search-input" style="width:160px;" title="动作开始日期">
                            <span style="color:var(--text-secondary); font-size:13px;">至</span>
                            <input type="date" v-model="filters.action_to" class="search-input" style="width:160px;" title="动作结束日期">
                            <button type="submit" class="btn-secondary" style="padding:6px 12px;">查询</button>
                            <button type="button" class="btn-secondary" :class="{ 'active-filter-chip': actionPreset === 'week' }" :style="actionPreset === 'week' ? 'padding:6px 12px; background:rgba(64,158,255,0.12); border-color:var(--primary); color:var(--primary);' : 'padding:6px 12px;'" @click="applyWeekPreset">最近一周</button>
                            <router-link v-if="hasAnyFilter" to="/competitors" class="btn-secondary" style="padding:6px 12px;">重置</router-link>
                        </form>
                        <div v-if="hasActionDateFilter" style="margin-top:8px; font-size:13px; color:var(--text-secondary);">
                            当前筛选：{{ actionPreset === 'week' ? '最近一周有动作变化' : '指定时间段内有动作变化' }}
                            <template v-if="filters.action_from || filters.action_to">（{{ filters.action_from || '不限' }} ~ {{ filters.action_to || '不限' }}）</template>
                            ，共 {{ total }} 个竞品
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn-secondary" @click="importCompetitors">从Excel导入</button>
                        <button class="btn-primary" @click="openAddModal">+ 新增竞品</button>
                    </div>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:50px">ID</th>
                            <th style="min-width:220px">品牌名</th>
                            <th style="min-width:220px">品牌分类</th>
                            <th style="min-width:180px">更新时间</th>
                            <th style="min-width:320px">最近监控</th>
                            <th style="min-width:360px">{{ hasActionDateFilter ? '时间段内动作' : '最近2次动作' }}</th>
                            <th style="min-width:160px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="7" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="competitors.length === 0">
                            <td colspan="7" style="text-align:center; padding:40px; color:#999;">
                                <template v-if="hasActionDateFilter">该时间段内暂无动作变化的竞品</template>
                                <template v-else-if="filters.keyword">未找到品牌名包含「{{ filters.keyword }}」的竞品</template>
                                <template v-else>暂无竞品数据，可点击右上角「新增竞品」</template>
                            </td>
                        </tr>
                        <tr v-for="c in competitors" :key="c.id">
                            <td>{{ c.id }}</td>
                            <td>
                                <template v-if="c.amazon_store_url">
                                    {{ c.brand_name }}
                                    <a :href="c.amazon_store_url" target="_blank" rel="noreferrer" style="color:var(--primary); text-decoration:none;">查看</a>
                                </template>
                                <template v-else>{{ c.brand_name }}</template>
                            </td>
                            <td>{{ c.brand_category || '-' }}</td>
                            <td>{{ fmtDateTime(c.updated_at) }}</td>
                            <td style="max-width:360px;">
                                <template v-if="!getMonitor(c)">
                                    <span style="color:var(--text-secondary);">-</span>
                                </template>
                                <template v-else>
                                    <div style="display:flex; gap:10px; align-items:flex-start;">
                                        <img :src="getMonitor(c).image_url" alt="监控图片" class="zoomable" @click="openViewer(getMonitor(c).image_url)" style="width:68px; height:68px; object-fit:cover; border-radius:8px; border:1px solid var(--border-color); background:#f8fafc;">
                                        <div style="min-width:0; flex:1;">
                                            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">{{ fmtDateTime(getMonitor(c).created_at) }}</div>
                                            <div style="margin-bottom:6px;">
                                                <span :style="{ display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:'999px', fontSize:'12px', background: Number(getMonitor(c).has_change) === 1 ? '#fef2f2' : '#eff6ff', color: Number(getMonitor(c).has_change) === 1 ? '#dc2626' : '#2563eb' }">
                                                    {{ Number(getMonitor(c).has_change) === 1 ? '有变化' : '无变化' }}
                                                </span>
                                            </div>
                                            <div v-if="getMonitor(c).action_text" style="font-size:13px; white-space:pre-wrap; word-break:break-word;">{{ getMonitor(c).action_text }}</div>
                                            <div v-else style="font-size:12px; color:var(--text-secondary);">本次无变化，未新增动作</div>
                                        </div>
                                    </div>
                                </template>
                                <a v-if="getMonitorCount(c) > 0" href="javascript:void(0);" @click="openMonitorRecordsModal(c.id, c.brand_name)" style="display:inline-block; margin-top:6px; font-size:12px; color:var(--primary); text-decoration:none;">
                                    查看监控历史（{{ getMonitorCount(c) }}）
                                </a>
                            </td>
                            <td style="max-width:520px;">
                                <template v-if="getActs(c).length === 0">
                                    <span style="color:var(--text-secondary);">-</span>
                                </template>
                                <template v-else>
                                    <div style="display:flex; flex-direction:column; gap:6px;">
                                        <div v-for="a in getActs(c)" :key="a.id">
                                            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">{{ fmtDateTime(a.created_at) }}</div>
                                            <div style="font-size:13px; white-space:pre-wrap; word-break:break-word;">{{ a.action_text }}</div>
                                        </div>
                                    </div>
                                </template>
                                <a v-if="getActionTotal(c) > 2" href="javascript:void(0);" @click="openAllActionsModal(c.id, c.brand_name)" style="display:inline-block; margin-top:6px; font-size:12px; color:var(--primary); text-decoration:none;">
                                    展开全部（{{ getActionTotal(c) }}）
                                </a>
                            </td>
                            <td>
                                <div style="display:flex; gap:6px;">
                                    <button class="btn-sm whitespace-nowrap" @click="openActionModal(c.id, c.brand_name)">追加动作</button>
                                    <button class="btn-sm whitespace-nowrap" @click="openEditModal(c.id, c.brand_name, c.brand_category, c.amazon_store_url)">编辑</button>
                                    <button class="btn-sm whitespace-nowrap" @click="deleteCompetitor(c.id)" style="color:var(--danger);border-color:var(--danger);">删除</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div v-if="totalPages > 1 || total > 0" class="pagination-bar">
                <div class="pagination-info">共 {{ total }} 条 · 第 {{ filters.page }} / {{ totalPages }} 页 · 显示 {{ startItem }}-{{ endItem }}</div>
                <div class="pagination">
                    <button type="button" class="page-btn" :class="{ disabled: filters.page <= 1 || loading }" :disabled="filters.page <= 1 || loading" @click="goPage(filters.page - 1)">上一页</button>
                    <template v-if="pageWindow.winStart > 1">
                        <button type="button" class="page-btn" :disabled="loading" @click="goPage(1)">1</button>
                        <span v-if="pageWindow.winStart > 2" class="page-ellipsis">…</span>
                    </template>
                    <template v-for="p in pageWindow.pages" :key="p">
                        <span v-if="p === filters.page" class="page-btn active">{{ p }}</span>
                        <button v-else type="button" class="page-btn" :disabled="loading" @click="goPage(p)">{{ p }}</button>
                    </template>
                    <template v-if="pageWindow.winEnd < totalPages">
                        <span v-if="pageWindow.winEnd < totalPages - 1" class="page-ellipsis">…</span>
                        <button type="button" class="page-btn" :disabled="loading" @click="goPage(totalPages)">{{ totalPages }}</button>
                    </template>
                    <button type="button" class="page-btn" :class="{ disabled: filters.page >= totalPages || loading }" :disabled="filters.page >= totalPages || loading" @click="goPage(filters.page + 1)">下一页</button>
                </div>
            </div>

        <div v-if="addModalOpen" class="modal-overlay active" @click.self="closeModal('add')">
            <div class="modal-box">
                <div class="modal-header">
                    <h3>新增竞品</h3>
                    <button class="modal-close" @click="closeModal('add')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="required">品牌名</label>
                        <input type="text" v-model="addBrandName" class="form-input" placeholder="例如：BrandX">
                    </div>
                    <div class="form-group">
                        <label>品牌分类</label>
                        <input type="text" v-model="addBrandCategory" class="form-input" placeholder="例如：母婴/厨房小家电/家居清洁...">
                    </div>
                    <div class="form-group">
                        <label>亚马逊商店链接</label>
                        <input type="text" v-model="addStoreUrl" class="form-input" placeholder="例如：https://www.amazon.com/stores/page/xxxx">
                    </div>
                    <div class="modal-error">{{ addError }}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeModal('add')">取消</button>
                    <button class="btn-submit" @click="addCompetitor">确认新增</button>
                </div>
            </div>
        </div>

        <div v-if="editModalOpen" class="modal-overlay active" @click.self="closeModal('edit')">
            <div class="modal-box">
                <div class="modal-header">
                    <h3>编辑竞品</h3>
                    <button class="modal-close" @click="closeModal('edit')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="required">品牌名</label>
                        <input type="text" v-model="editBrandName" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>品牌分类</label>
                        <input type="text" v-model="editBrandCategory" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>亚马逊商店链接</label>
                        <input type="text" v-model="editStoreUrl" class="form-input">
                    </div>
                    <div class="modal-error">{{ editError }}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeModal('edit')">取消</button>
                    <button class="btn-submit" @click="saveEditCompetitor">保存修改</button>
                </div>
            </div>
        </div>

        <div v-if="actionModalOpen" class="modal-overlay active" @click.self="closeModal('action')">
            <div class="modal-box">
                <div class="modal-header">
                    <h3>追加动作</h3>
                    <button class="modal-close" @click="closeModal('action')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>竞品</label>
                        <input type="text" v-model="actionBrandName" class="form-input" readonly style="background:#f5f5f5;">
                    </div>
                    <div class="form-group">
                        <label class="required">动作内容</label>
                        <textarea v-model="actionText" class="form-input" style="min-height:110px; resize:vertical;" placeholder="例如：2026-06-10 复盘竞品A+，记录其主图卖点结构并对照我们的页面"></textarea>
                    </div>
                    <div class="modal-error">{{ actionError }}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeModal('action')">取消</button>
                    <button class="btn-submit" @click="addAction">确认追加</button>
                </div>
            </div>
        </div>

        <div v-if="allActionsModalOpen" class="modal-overlay active" @click.self="closeModal('allActions')">
            <div class="modal-box modal-box-wide">
                <div class="modal-header">
                    <h3>{{ allActionsTitle }}</h3>
                    <button class="modal-close" @click="closeModal('allActions')">&times;</button>
                </div>
                <div class="modal-body" id="allActionsBodyEl" style="max-height:60vh; overflow-y:auto;" v-html="allActionsBody"></div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeModal('allActions')">关闭</button>
                </div>
            </div>
        </div>

        <div v-if="monitorModalOpen" class="modal-overlay active" @click.self="closeModal('monitor')">
            <div class="modal-box modal-box-wide">
                <div class="modal-header">
                    <h3>{{ monitorRecordsTitle }}</h3>
                    <button class="modal-close" @click="closeModal('monitor')">&times;</button>
                </div>
                <div class="modal-body" style="max-height:60vh; overflow-y:auto;" v-html="monitorRecordsBody"></div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeModal('monitor')">关闭</button>
                </div>
            </div>
        </div>`
};
