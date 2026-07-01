import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { fmtDateTime, getApiError, http, pct, computeOperatingDays } from '@/utils/index.js';
import { openViewer } from '@/utils/viewer.js';
import ProductEconomicsPanel from '@/components/ProductEconomicsPanel.js';
import { PRODUCT_SITES } from '@/constants/product-sites.js';
import { PRODUCT_CATEGORIES } from '@/constants/product-categories.js';

function parseAsin(route) {
    return route.params.asin || '';
}

function parseUploadedUrls(imageUrl) {
    if (!imageUrl) return [];
    try {
        const parsed = JSON.parse(imageUrl);
        return Array.isArray(parsed) ? parsed : [imageUrl];
    } catch (e) {
        return [imageUrl];
    }
}

function fmtFieldTime(dt) {
    if (!dt) return '暂无';
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return String(dt);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '-');
}
export default {
    name: 'ProductView',
    components: { ProductEconomicsPanel },
    setup() {
        const router = useRouter();
        const route = useRoute();
        const asin = ref(parseAsin(route));
        const loading = ref(true);
        const product = ref(null);
        const modules = ref([]);
        const recordMap = ref({});
        const moduleProgress = ref({});
        const economics = ref(null);
        const collapsedGroups = ref({});
        const expandedInstructions = ref(new Set());
        const timeDisplays = ref({});

        const editModalOpen = ref(false);
        const editName = ref('');
        const editCategory = ref('');
        const editSite = ref('');
        const editError = ref('');
        const operatingDaysInput = ref('');

        const versionModalOpen = ref(false);
        const newVersionName = ref('');
        const versionError = ref('');
        const versions = ref([]);
        const versionsLoading = ref(false);

        const relatedProducts = ref([]);
        const relatedSearchQuery = ref('');
        const relatedSearchResults = ref([]);
        const relatedSearchOpen = ref(false);
        const relatedSearchLoading = ref(false);
        const relatedError = ref('');
        const relatedLoading = ref(false);
        let relatedSearchTimer = null;

        const statusOptions = ['待处理', '进行中', '已完成', '跳过', '已放弃'];

        const overallProgress = computed(() => {
            let completed = 0, total = 0;
            modules.value.forEach(mod => {
                (mod.sop_items || []).forEach(item => {
                    if (!item.is_data_column) {
                        total++;
                        const rec = recordMap.value[item.id] || {};
                        if (rec.status === '已完成') completed++;
                    }
                });
            });
            return total > 0 ? Math.round(completed / total * 100) : 0;
        });

        function syncOperatingDaysInput() {
            const days = computeOperatingDays(product.value?.operating_started_at);
            operatingDaysInput.value = days != null ? String(days) : '';
        }

        function getDataItems(module) {
            return (module.sop_items || []).filter(i => i.is_data_column);
        }
        function getActionItems(module) {
            return (module.sop_items || []).filter(i => !i.is_data_column);
        }
        function getRecord(itemId) {
            return recordMap.value[itemId] || { id: '', status: '待处理', remark: '', image_url: '', updated_at: null };
        }
        function getModuleProgress(moduleId) {
            return moduleProgress.value[moduleId] || { completed: 0, total: 0, percentage: 0 };
        }
        function groupKey(moduleId, type) {
            return moduleId + '-' + type;
        }
        function isGroupCollapsed(moduleId, type) {
            return collapsedGroups.value[groupKey(moduleId, type)] === true;
        }
        function toggleGroup(moduleId, type) {
            const key = groupKey(moduleId, type);
            collapsedGroups.value[key] = !collapsedGroups.value[key];
        }
        function isInstructionExpanded(itemId) {
            return expandedInstructions.value.has(itemId);
        }
        function toggleInstruction(itemId) {
            const s = new Set(expandedInstructions.value);
            if (s.has(itemId)) s.delete(itemId);
            else s.add(itemId);
            expandedInstructions.value = s;
        }
        function getFieldTime(itemId, rec) {
            if (timeDisplays.value[itemId]) return timeDisplays.value[itemId];
            return fmtFieldTime(rec.updated_at);
        }

        async function loadData() {
            if (!asin.value) {
                loading.value = false;
                return;
            }
            loading.value = true;
            try {
                const { data } = await http.get('/api/product/' + encodeURIComponent(asin.value));
                product.value = data.product;
                modules.value = data.modules || [];
                recordMap.value = data.recordMap || {};
                moduleProgress.value = data.moduleProgress || {};
                economics.value = data.economics || null;
                syncOperatingDaysInput();
                await loadRelatedProducts();
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
            }
        }

        function updateRecord(recordId, field, value) {
            const rid = String(recordId);
            if (!rid || rid === 'undefined' || rid === 'null') return;
            http.patch('/api/record/' + rid, { [field]: value }).then(r => {
                if (r.status === 200) {
                    const now = new Date();
                    const y = now.getFullYear();
                    const M = String(now.getMonth() + 1).padStart(2, '0');
                    const D = String(now.getDate()).padStart(2, '0');
                    const h = String(now.getHours()).padStart(2, '0');
                    const m = String(now.getMinutes()).padStart(2, '0');
                    const s = String(now.getSeconds()).padStart(2, '0');
                    const timeStr = `${y}-${M}-${D} ${h}:${m}:${s}`;
                    const displays = { ...timeDisplays.value };
                    Object.keys(recordMap.value).forEach(k => {
                        if (String(recordMap.value[k].id) === rid) displays[k] = timeStr;
                    });
                    timeDisplays.value = displays;
                }
            }).catch(e => console.error('Update failed:', e));
        }

        async function uploadActionImageFile(recordId, file) {
            if (!file || !recordId) return;
            const formData = new FormData();
            formData.append('image', file);
            try {
                const { data } = await http.post('/api/record/' + recordId + '/image', formData);
                if (data) await loadData();
            } catch (e) {
                alert(getApiError(e, '上传失败'));
            }
        }

        async function uploadActionImage(recordId, event) {
            const input = event.target;
            if (!input.files || !input.files[0] || !recordId) return;
            await uploadActionImageFile(recordId, input.files[0]);
            input.value = '';
        }

        async function deleteActionImage(recordId, imageUrl) {
            if (!confirm('确认删除此图片？')) return;
            try {
                await http.post('/api/record/' + recordId + '/image/delete', { image_url: imageUrl });
                await loadData();
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function updateProductStatus(status) {
            http.patch('/api/product/' + encodeURIComponent(asin.value), { status }).catch(e => console.error('Status update failed:', e));
        }

        function updateProductSite(site) {
            const siteVal = site || null;
            http.patch('/api/product/' + encodeURIComponent(asin.value), { site: siteVal })
                .then(() => {
                    if (product.value) product.value.seq = siteVal || '';
                })
                .catch(e => console.error('Site update failed:', e));
        }

        function updateProductCategory(category) {
            const categoryVal = category || null;
            http.patch('/api/product/' + encodeURIComponent(asin.value), { category: categoryVal })
                .then(() => {
                    if (product.value) product.value.category = categoryVal || '';
                })
                .catch(e => console.error('Category update failed:', e));
        }

        async function updateOperatingDays(event) {
            const odText = String(event?.target?.value ?? operatingDaysInput.value ?? '').trim();
            const currentDays = computeOperatingDays(product.value?.operating_started_at);
            const currentText = currentDays != null ? String(currentDays) : '';
            if (odText === currentText) return;

            let payload;
            if (odText === '') {
                if (currentDays == null) {
                    syncOperatingDaysInput();
                    return;
                }
                payload = null;
            } else {
                const days = Number(odText);
                if (Number.isNaN(days) || days < 0 || !Number.isInteger(days)) {
                    alert('运营天数必须是非负整数');
                    syncOperatingDaysInput();
                    return;
                }
                payload = days;
            }

            try {
                await http.patch('/api/product/' + encodeURIComponent(asin.value), { operating_days: payload });
                await loadData();
            } catch (e) {
                alert(getApiError(e, '运营天数保存失败'));
                syncOperatingDaysInput();
            }
        }

        function openEditModal() {
            editName.value = product.value?.name || '';
            editCategory.value = product.value?.category || '';
            editSite.value = product.value?.seq || '';
            editError.value = '';
            editModalOpen.value = true;
        }
        function closeEditModal() {
            editModalOpen.value = false;
        }

        async function saveEditProduct() {
            const name = editName.value.trim();
            const category = editCategory.value.trim();
            const site = editSite.value || null;
            try {
                await http.put('/api/product/' + encodeURIComponent(asin.value), { name, category, site });
                await loadData();
                closeEditModal();
            } catch (e) {
                editError.value = getApiError(e, '保存失败');
            }
        }

        async function deleteProduct() {
            if (!confirm('确认删除该产品？所有操作记录将一并删除。')) return;
            try {
                await http.post('/api/product/' + encodeURIComponent(asin.value) + '/delete');
                router.push('/dashboard');
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function fmtTime(t) {
            if (!t) return '—';
            const d = new Date(t);
            const y = d.getFullYear();
            const M = String(d.getMonth() + 1).padStart(2, '0');
            const D = String(d.getDate()).padStart(2, '0');
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            return `${y}-${M}-${D} ${h}:${m}`;
        }
        function escapeHtml(s) {
            if (s == null) return '';
            return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        }

        function openVersionModal() {
            versionModalOpen.value = true;
            versionError.value = '';
            newVersionName.value = '';
            loadVersions();
        }
        function closeVersionModal() {
            versionModalOpen.value = false;
        }

        async function loadVersions() {
            versionsLoading.value = true;
            try {
                const { data } = await http.get('/api/product/' + encodeURIComponent(asin.value) + '/versions');
                versions.value = data.versions || [];
            } catch (e) {
                versionError.value = getApiError(e, '加载失败');
                versions.value = [];
            } finally {
                versionsLoading.value = false;
            }
        }

        async function createVersion() {
            versionError.value = '';
            try {
                await http.post('/api/product/' + encodeURIComponent(asin.value) + '/version', {
                    version_name: newVersionName.value.trim() || null
                });
                newVersionName.value = '';
                await loadVersions();
            } catch (e) {
                versionError.value = getApiError(e, '生成失败');
            }
        }

        async function deleteVersion(id) {
            if (!confirm('确认删除此版本？此操作不可恢复。')) return;
            try {
                await http.delete('/api/version/' + id);
                await loadVersions();
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function openViewer(src) {
            window.openViewer(src);
        }

        function onPaste(e) {
            const target = e.target;
            if (!target || !target.classList || !target.classList.contains('sop-remark')) return;
            const recordId = target.dataset.recordId;
            if (!recordId) return;
            if (target.dataset.pasteUploading === '1') return;
            const cd = e.clipboardData;
            if (!cd || !cd.items) return;
            let imageItem = null;
            for (const it of cd.items) {
                if (it && typeof it.type === 'string' && it.type.startsWith('image/')) {
                    imageItem = it;
                    break;
                }
            }
            if (!imageItem) return;
            const text = (cd.getData && (cd.getData('text/plain') || cd.getData('text'))) || '';
            if (!text) e.preventDefault();
            const file = imageItem.getAsFile && imageItem.getAsFile();
            if (!file) return;
            target.dataset.pasteUploading = '1';
            uploadActionImageFile(recordId, file).finally(() => {
                target.dataset.pasteUploading = '0';
            });
        }

        function onEconomicsUpdated(payload) {
            economics.value = payload;
        }

        async function loadRelatedProducts() {
            if (!asin.value) return;
            try {
                const { data } = await http.get('/api/product/' + encodeURIComponent(asin.value) + '/related');
                relatedProducts.value = data.related || [];
            } catch (e) {
                relatedProducts.value = [];
            }
        }

        const relatedAsinSet = computed(() => new Set(relatedProducts.value.map(p => p.asin)));

        function closeRelatedSearchDropdown() {
            relatedSearchOpen.value = false;
        }

        function onRelatedSearchInput() {
            relatedError.value = '';
            if (relatedSearchTimer) clearTimeout(relatedSearchTimer);
            const q = relatedSearchQuery.value.trim();
            if (!q) {
                relatedSearchResults.value = [];
                relatedSearchOpen.value = false;
                return;
            }
            relatedSearchTimer = setTimeout(() => searchRelatedProducts(q), 300);
        }

        async function searchRelatedProducts(q) {
            relatedSearchLoading.value = true;
            try {
                const { data } = await http.get('/api/products/search', {
                    params: { q, limit: 10, exclude: asin.value }
                });
                relatedSearchResults.value = (data.products || []).filter(
                    p => !relatedAsinSet.value.has(p.asin)
                );
                relatedSearchOpen.value = relatedSearchResults.value.length > 0;
            } catch (e) {
                relatedSearchResults.value = [];
                relatedSearchOpen.value = false;
            } finally {
                relatedSearchLoading.value = false;
            }
        }

        async function linkRelatedAsin(relatedAsin) {
            relatedError.value = '';
            relatedLoading.value = true;
            try {
                const { data } = await http.post(
                    '/api/product/' + encodeURIComponent(asin.value) + '/related',
                    { relatedAsin }
                );
                relatedProducts.value = data.related || [];
                relatedSearchQuery.value = '';
                relatedSearchResults.value = [];
                relatedSearchOpen.value = false;
            } catch (e) {
                relatedError.value = getApiError(e, '关联失败');
            } finally {
                relatedLoading.value = false;
            }
        }

        async function selectRelatedProduct(item) {
            if (!item || !item.asin) return;
            await linkRelatedAsin(item.asin);
        }

        async function addRelatedProduct() {
            const query = relatedSearchQuery.value.trim().toUpperCase();
            if (!query) {
                relatedError.value = '请搜索并选择产品，或直接输入 ASIN';
                return;
            }
            await linkRelatedAsin(query);
        }

        function onRelatedSearchBlur() {
            setTimeout(closeRelatedSearchDropdown, 150);
        }

        async function removeRelatedProduct(relatedAsin) {
            if (!confirm('确认解除与 ' + relatedAsin + ' 的关联？')) return;
            relatedLoading.value = true;
            relatedError.value = '';
            try {
                const { data } = await http.delete('/api/product/' + encodeURIComponent(asin.value) + '/related/' + encodeURIComponent(relatedAsin));
                relatedProducts.value = data.related || [];
            } catch (e) {
                relatedError.value = getApiError(e, '解除关联失败');
            } finally {
                relatedLoading.value = false;
            }
        }

        onMounted(() => {
            loadData();
            document.addEventListener('paste', onPaste);
        });
        watch(
            () => route.params.asin,
            (newAsin) => {
                const next = newAsin || '';
                if (!next || next === asin.value) return;
                asin.value = next;
                relatedSearchQuery.value = '';
                relatedSearchResults.value = [];
                relatedSearchOpen.value = false;
                relatedError.value = '';
                collapsedGroups.value = {};
                expandedInstructions.value = new Set();
                timeDisplays.value = {};
                loadData();
            }
        );
        onUnmounted(() => {
            document.removeEventListener('paste', onPaste);
            if (relatedSearchTimer) clearTimeout(relatedSearchTimer);
        });

        return {
            loading, product, modules, recordMap, economics, statusOptions, overallProgress, operatingDaysInput,
            collapsedGroups, expandedInstructions,
            editModalOpen, editName, editCategory, editSite, editError,
            productSites: PRODUCT_SITES, productCategories: PRODUCT_CATEGORIES,
            versionModalOpen, newVersionName, versionError, versions, versionsLoading,
            asin, getDataItems, getActionItems, getRecord, getModuleProgress,
            isGroupCollapsed, toggleGroup, isInstructionExpanded, toggleInstruction,
            getFieldTime, parseUploadedUrls, fmtDateTime, pct,
            updateRecord, uploadActionImage, deleteActionImage,
            updateProductStatus, updateProductSite, updateProductCategory, updateOperatingDays,
            openEditModal, closeEditModal, saveEditProduct, deleteProduct,
            openVersionModal, closeVersionModal, loadVersions, createVersion, deleteVersion,
            fmtTime, escapeHtml, openViewer, onEconomicsUpdated,
            relatedProducts, relatedSearchQuery, relatedSearchResults, relatedSearchOpen,
            relatedSearchLoading, relatedError, relatedLoading,
            onRelatedSearchInput, onRelatedSearchBlur, selectRelatedProduct, addRelatedProduct, removeRelatedProduct
        };
    },
    template: `<div v-if="loading" style="text-align:center; padding:40px; color:#999;">加载中...</div>
        <template v-else-if="product">
            <div class="page-header">
                <div class="flex justify-between items-start">
                    <div>
                        <router-link to="/dashboard" class="back-link">&larr; 返回看板</router-link>
                        <h1>{{ product.name || product.asin }}</h1>
                        <div class="product-meta mt-1.5">
                            <span class="meta-item">ASIN: <a :href="'https://www.amazon.com/dp/' + product.asin" target="_blank"><code>{{ product.asin }}</code></a></span>
                            <span class="meta-item">分类:
                                <select class="status-select px-2 py-0.5 text-xs" :value="product.category || ''" @change="updateProductCategory($event.target.value)">
                                    <option value="">未设置</option>
                                    <option v-for="c in productCategories" :key="c" :value="c">{{ c }}</option>
                                    <option v-if="product.category && !productCategories.includes(product.category)" :value="product.category">{{ product.category }}</option>
                                </select>
                            </span>
                            <span class="meta-item">站点:
                                <select class="status-select px-2 py-0.5 text-xs" :value="product.seq || ''" @change="updateProductSite($event.target.value)">
                                    <option value="">未设置</option>
                                    <option v-for="s in productSites" :key="s" :value="s">{{ s }}</option>
                                </select>
                            </span>
                            <span class="meta-item">状态:
                                <select class="status-select px-2 py-0.5 text-xs" :value="product.status" @change="updateProductStatus($event.target.value)">
                                    <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
                                </select>
                            </span>
                            <span class="meta-item">运营天数:
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    class="status-select px-2 py-0.5 text-xs w-[72px]"
                                    v-model="operatingDaysInput"
                                    placeholder="—"
                                    @blur="updateOperatingDays"
                                >
                                天
                            </span>
                            <span v-if="product.operating_started_at" class="meta-item">运营开始: {{ fmtDateTime(product.operating_started_at) }}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="progress-bar mb-2 min-w-[140px]">
                            <div class="progress-fill" :style="{ width: overallProgress + '%' }"></div>
                            <span class="progress-text">{{ overallProgress }}%</span>
                        </div>
                        <button class="btn-secondary px-4 py-1.5 text-[13px]" @click="openVersionModal">版本管理</button>
                        <button class="btn-primary px-4 py-1.5 text-[13px]" @click="openEditModal">编辑产品</button>
                        <button class="btn-danger px-4 py-1.5" @click="deleteProduct">删除产品</button>
                    </div>
                </div>
            </div>
            <ProductEconomicsPanel :key="asin" :asin="asin" :economics="economics" @updated="onEconomicsUpdated" />
            <div class="module-card mb-4">
                <div class="module-header" style="cursor:default;">
                    <div class="module-name">关联 ASIN</div>
                    <span class="text-xs text-[#909399]">同组 ASIN 在淘汰分析时合并销量排名</span>
                </div>
                <div class="module-body">
                    <div v-if="relatedProducts.length" class="mb-3">
                        <div v-for="rp in relatedProducts" :key="rp.asin" class="flex items-center gap-2 mb-2">
                            <router-link :to="'/product/' + rp.asin"><code>{{ rp.asin }}</code></router-link>
                            <span class="text-sm text-[#606266]">{{ rp.name || '—' }}</span>
                            <span v-if="rp.status" class="status-badge">{{ rp.status }}</span>
                            <button type="button" class="btn-secondary px-2 py-0.5 text-xs" :disabled="relatedLoading" @click="removeRelatedProduct(rp.asin)">解除关联</button>
                        </div>
                    </div>
                    <div v-else class="text-sm text-[#909399] mb-3">暂无关联 ASIN</div>
                    <div class="flex items-start gap-2">
                        <div class="related-search-wrap" style="position:relative; flex:1; max-width:420px;">
                            <input
                                v-model="relatedSearchQuery"
                                type="text"
                                class="search-input w-full"
                                placeholder="搜索产品名称或 ASIN，从列表中选择"
                                :disabled="relatedLoading"
                                @input="onRelatedSearchInput"
                                @focus="onRelatedSearchInput"
                                @blur="onRelatedSearchBlur"
                                @keyup.enter="addRelatedProduct"
                            />
                            <div
                                v-if="relatedSearchOpen"
                                class="related-search-dropdown"
                                style="position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:20; background:#fff; border:1px solid #e4e7ed; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,.08); max-height:240px; overflow-y:auto;"
                            >
                                <button
                                    v-for="item in relatedSearchResults"
                                    :key="item.asin"
                                    type="button"
                                    class="related-search-item"
                                    style="display:block; width:100%; text-align:left; padding:10px 12px; border:none; background:transparent; cursor:pointer; border-bottom:1px solid #f0f0f0;"
                                    :disabled="relatedLoading"
                                    @mousedown.prevent="selectRelatedProduct(item)"
                                >
                                    <div class="text-sm text-[#303133]">{{ item.name || '—' }}</div>
                                    <div class="text-xs text-[#909399] mt-0.5">
                                        <code>{{ item.asin }}</code>
                                        <span v-if="item.seq"> · {{ item.seq }}</span>
                                        <span v-if="item.status"> · {{ item.status }}</span>
                                    </div>
                                </button>
                            </div>
                            <p v-if="relatedSearchLoading" class="text-xs text-[#909399] mt-1">搜索中…</p>
                            <p v-else-if="relatedSearchQuery.trim() && !relatedSearchOpen && !relatedSearchLoading" class="text-xs text-[#909399] mt-1">未找到匹配产品，按 Enter 可尝试按 ASIN 直接关联</p>
                        </div>
                        <button type="button" class="btn-primary px-3 py-1 text-sm shrink-0" :disabled="relatedLoading" @click="addRelatedProduct">
                            {{ relatedLoading ? '处理中…' : '添加关联' }}
                        </button>
                    </div>
                    <p v-if="relatedError" class="text-[#f56c6c] text-sm mt-2">{{ relatedError }}</p>
                </div>
            </div>
            <div class="sop-grid">
                <div v-for="module in modules" :key="module.id" class="sop-card">
                    <div class="sop-card-header">
                        <h2 class="sop-card-title">{{ module.name }}</h2>
                        <span class="sop-card-count">{{ getModuleProgress(module.id).completed }}/{{ getModuleProgress(module.id).total }}</span>
                    </div>
                    <div class="pt-2 px-[18px] pb-0 bg-[#fafafa] border-b border-[#e4e7ed]">
                        <div class="progress-bar mb-2 min-w-full h-4">
                            <div class="progress-fill" :style="{ width: pct(getModuleProgress(module.id).percentage) + '%' }"></div>
                            <span class="progress-text text-[10px]">{{ pct(getModuleProgress(module.id).percentage) }}%</span>
                        </div>
                    </div>
                    <div class="sop-card-body">
                        <div v-if="getDataItems(module).length > 0" class="sop-group">
                            <div class="sop-group-header sop-group-data-header" @click="toggleGroup(module.id, 'data')">
                                <span class="sop-group-arrow">{{ isGroupCollapsed(module.id, 'data') ? '▶' : '▼' }}</span>
                                <span class="sop-group-badge type-data">数据字段</span>
                                <span class="sop-group-count">{{ getDataItems(module).length }} 项</span>
                            </div>
                            <div v-show="!isGroupCollapsed(module.id, 'data')" class="sop-group-body">
                                <div class="sop-items-grid">
                                    <div v-for="item in getDataItems(module)" :key="item.id" class="sop-data-item sop-data-field" :data-item-id="item.id">
                                        <div class="sop-data-item-label">{{ item.name }}</div>
                                        <span v-if="item.table_ref === 'product_sop_records.updated_at'" class="sop-field-time" title="随保存自动更新">{{ getFieldTime(item.id, getRecord(item.id)) }}</span>
                                        <input v-else class="sop-field-textarea" rows="1" placeholder="填写..." :value="getRecord(item.id).remark || ''" @blur="updateRecord(getRecord(item.id).id, 'remark', $event.target.value)">
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div v-if="getActionItems(module).length > 0" class="sop-group">
                            <div class="sop-group-header sop-group-action-header" @click="toggleGroup(module.id, 'action')">
                                <span class="sop-group-arrow">{{ isGroupCollapsed(module.id, 'action') ? '▶' : '▼' }}</span>
                                <span class="sop-group-badge type-action">操作项</span>
                                <span class="sop-group-count">{{ getActionItems(module).length }} 项</span>
                            </div>
                            <div v-show="!isGroupCollapsed(module.id, 'action')" class="sop-group-body">
                                <div class="sop-items-list">
                                    <div v-for="(item, idx) in getActionItems(module)" :key="item.id" class="sop-action-item" :id="'sop-item-' + item.id">
                                        <div class="sop-action-item-header">
                                            <span class="sop-action-item-index">#{{ idx + 1 }}</span>
                                            <span class="sop-action-item-name">{{ item.name }}</span>
                                            <select class="sop-status-select ml-auto" :value="getRecord(item.id).status" @change="updateRecord(getRecord(item.id).id, 'status', $event.target.value)">
                                                <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
                                            </select>
                                        </div>
                                        <div v-if="item.instruction_text" class="sop-action-item-instruction cursor-pointer whitespace-pre-wrap" :class="isInstructionExpanded(item.id) ? 'line-clamp-none' : 'line-clamp-3'" @click="toggleInstruction(item.id)">{{ item.instruction_text }}</div>
                                        <div v-if="item.image_url" class="sop-example-image sop-example-thumb">
                                            <img :src="item.image_url" alt="示例图片" class="zoomable" @click="openViewer(item.image_url)">
                                        </div>
                                        <div v-if="getRecord(item.id).image_url" class="sop-action-uploaded-images">
                                            <div v-for="url in parseUploadedUrls(getRecord(item.id).image_url)" :key="url" class="sop-action-uploaded-image">
                                                <img :src="url" alt="操作图片" class="zoomable" @click="openViewer(url)">
                                                <button class="btn-icon-del" title="删除图片" @click="deleteActionImage(getRecord(item.id).id, url)">&times;</button>
                                            </div>
                                        </div>
                                        <div class="sop-action-footer">
                                            <label class="btn-upload-action" title="上传操作截图">
                                                📷
                                                <input type="file" accept="image/*" class="hidden" @change="uploadActionImage(getRecord(item.id).id, $event)">
                                            </label>
                                            <textarea class="sop-remark" placeholder="备注..." :data-record-id="getRecord(item.id).id" rows="1" :value="getRecord(item.id).remark || ''" @blur="updateRecord(getRecord(item.id).id, 'remark', $event.target.value)"></textarea>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <div v-if="editModalOpen" class="modal-overlay active" @click.self="closeEditModal">
            <div class="modal-box">
                <div class="modal-header">
                    <h3>编辑产品</h3>
                    <button class="modal-close" @click="closeEditModal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>ASIN（不可修改）</label>
                        <input type="text" class="form-input bg-[#f5f5f5]" readonly :value="asin">
                    </div>
                    <div class="form-group">
                        <label>产品名称</label>
                        <input type="text" v-model="editName" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>分类</label>
                        <select v-model="editCategory" class="form-input">
                            <option value="">未设置</option>
                            <option v-for="c in productCategories" :key="c" :value="c">{{ c }}</option>
                            <option v-if="editCategory && !productCategories.includes(editCategory)" :value="editCategory">{{ editCategory }}</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>站点</label>
                        <select v-model="editSite" class="form-input">
                            <option value="">未设置</option>
                            <option v-for="s in productSites" :key="s" :value="s">{{ s }}</option>
                        </select>
                    </div>
                    <div class="modal-error">{{ editError }}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeEditModal">取消</button>
                    <button class="btn-submit" @click="saveEditProduct">保存修改</button>
                </div>
            </div>
        </div>

        <div v-if="versionModalOpen" class="modal-overlay active" @click.self="closeVersionModal">
            <div class="modal-box w-[560px] max-h-[80vh] flex flex-col">
                <div class="modal-header">
                    <h3>版本管理</h3>
                    <button class="modal-close" @click="closeVersionModal">&times;</button>
                </div>
                <div class="modal-body overflow-y-auto flex-1">
                    <div class="flex items-end gap-2 mb-4 p-3 bg-[#f5f7fa] rounded-md">
                        <div class="flex-1">
                            <label class="block text-[13px] font-semibold mb-1.5">版本名称（可选）</label>
                            <input type="text" v-model="newVersionName" class="form-input" placeholder="例如：初次优化、第二轮调整">
                        </div>
                        <button class="btn-submit" @click="createVersion">生成新版本</button>
                    </div>
                    <div class="modal-error">{{ versionError }}</div>
                    <div class="flex flex-col gap-2">
                        <div v-if="versionsLoading" class="text-center py-5 text-[#999]">加载中...</div>
                        <div v-else-if="versions.length === 0" class="text-center py-7 text-[#999]">暂无版本，点击"生成新版本"创建第一个版本</div>
                        <div v-for="v in versions" :key="v.id" class="flex items-center gap-2.5 py-3 px-3.5 bg-[#fafafa] border border-[#e4e7ed] rounded-lg">
                            <span class="inline-block min-w-[36px] px-2 py-0.5 text-center bg-[#409eff] text-white font-semibold rounded text-xs">V{{ v.version_number }}</span>
                            <div class="flex-1 min-w-0">
                                <div class="text-[14px] font-semibold text-[#303133] mb-0.5">
                                    <template v-if="v.version_name">{{ v.version_name }}</template>
                                    <span v-else class="text-[#909399] font-normal">(未命名)</span>
                                </div>
                                <div class="text-xs text-[#909399]">
                                    创建：{{ fmtTime(v.created_at) }}
                                    <template v-if="v.updated_at && v.updated_at !== v.created_at">　|　最后修改：{{ fmtTime(v.updated_at) }}</template>
                                </div>
                            </div>
                            <a :href="'/product/' + asin + '/version/' + v.id" class="btn-sm bg-[#409eff] text-white border-[#409eff]">查看/编辑</a>
                            <button class="btn-icon w-7 h-7" title="删除版本" @click="deleteVersion(v.id)">×</button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" @click="closeVersionModal">关闭</button>
                </div>
            </div>
        </div>`
};
