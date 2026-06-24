import { computed, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { fmtDateTime, getApiError, http, pct } from '@/utils/index.js';
import { openViewer } from '@/utils/viewer.js';

function parsePath(route) {
    return { asin: route.params.asin || '', versionId: route.params.versionId || '' };
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
    name: 'ProductVersionView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const pathInfo = parsePath(route);
        const asin = ref(pathInfo.asin);
        const versionId = ref(pathInfo.versionId);
        const loading = ref(true);
        const product = ref(null);
        const version = ref(null);
        const modules = ref([]);
        const recordMap = ref({});
        const moduleProgress = ref({});
        const collapsedGroups = ref({});
        const expandedInstructions = ref(new Set());
        const statusOptions = ['待处理', '进行中', '已完成', '跳过'];

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
        function isGroupCollapsed(moduleId, type) {
            return collapsedGroups.value[moduleId + '-' + type] === true;
        }
        function toggleGroup(moduleId, type) {
            const key = moduleId + '-' + type;
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

        async function loadData() {
            if (!asin.value || !versionId.value) {
                loading.value = false;
                return;
            }
            loading.value = true;
            try {
                const { data } = await http.get('/api/product/' + encodeURIComponent(asin.value) + '/version/' + versionId.value);
                product.value = data.product;
                version.value = data.version;
                modules.value = data.modules || [];
                recordMap.value = data.recordMap || {};
                moduleProgress.value = data.moduleProgress || {};
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
            }
        }

        function updateVersionRecord(itemId, field, value) {
            http.patch('/api/version/' + versionId.value + '/item/' + itemId, { [field]: value })
                .catch(e => console.error('Update failed:', e));
        }

        function renameVersion() {
            const current = version.value?.version_name || '';
            const newName = prompt('修改版本名称（留空则显示为"未命名"）：', current);
            if (newName === null) return;
            http.patch('/api/version/' + versionId.value, { version_name: newName.trim() || null })
                .then(() => loadData())
                .catch(() => alert('修改失败'));
        }

        function openViewer(src) {
            window.openViewer(src);
        }

        onMounted(loadData);

        return {
            loading, product, version, modules, asin, statusOptions, overallProgress,
            collapsedGroups, expandedInstructions,
            getDataItems, getActionItems, getRecord, getModuleProgress,
            isGroupCollapsed, toggleGroup, isInstructionExpanded, toggleInstruction,
            parseUploadedUrls, fmtFieldTime, fmtDateTime, pct,
            updateVersionRecord, renameVersion, openViewer
        };
    },
    template: `<div v-if="loading" style="text-align:center; padding:40px; color:#999;">加载中...</div>
        <template v-else-if="product && version">
            <div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <a :href="'/product/' + asin" class="back-link">&larr; 返回产品主页</a>
                        <h1>{{ product.name || product.asin }}</h1>
                        <div class="product-meta" style="margin-top:6px;">
                            <span class="meta-item">ASIN: <code>{{ product.asin }}</code></span>
                            <span v-if="product.category" class="meta-item">分类: {{ product.category }}</span>
                            <span class="meta-item">状态:
                                <span :class="'status-badge status-' + product.status">{{ product.status }}</span>
                            </span>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <div class="progress-bar" style="min-width:140px;">
                            <div class="progress-fill" :style="{ width: overallProgress + '%' }"></div>
                            <span class="progress-text">{{ overallProgress }}%</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="version-banner">
                <span class="version-banner-icon">📦</span>
                <div class="version-banner-text">
                    <strong>版本 V{{ version.version_number }}</strong>
                    <span class="version-name-edit" title="点击修改版本名称" @click="renameVersion">
                        {{ version.version_name ? '· ' + version.version_name : '· (未命名，点击修改)' }}
                    </span>
                    <br>
                    <span style="color:#909399; font-size:12px;">
                        创建于 {{ fmtDateTime(version.created_at) }}
                        <template v-if="version.updated_at && version.updated_at !== version.created_at">　|　最后修改 {{ fmtDateTime(version.updated_at) }}</template>
                    </span>
                </div>
                <a :href="'/product/' + asin" class="btn-secondary" style="padding:4px 12px; font-size:12px;">返回当前版本</a>
            </div>
            <div class="sop-grid">
                <div v-for="module in modules" :key="module.id" class="sop-card">
                    <div class="sop-card-header">
                        <h2 class="sop-card-title">{{ module.name }}</h2>
                        <span class="sop-card-count">{{ getModuleProgress(module.id).completed }}/{{ getModuleProgress(module.id).total }}</span>
                    </div>
                    <div style="padding:8px 18px 0; background:#fafafa; border-bottom:1px solid var(--border);">
                        <div class="progress-bar" style="min-width:100%; height:16px;">
                            <div class="progress-fill" :style="{ width: pct(getModuleProgress(module.id).percentage) + '%' }"></div>
                            <span class="progress-text" style="font-size:10px;">{{ pct(getModuleProgress(module.id).percentage) }}%</span>
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
                                        <span v-if="item.table_ref === 'product_sop_records.updated_at'" class="sop-field-time" title="随保存自动更新">{{ fmtFieldTime(getRecord(item.id).updated_at) }}</span>
                                        <textarea v-else class="sop-field-textarea" rows="2" placeholder="填写..." :value="getRecord(item.id).remark || ''" @blur="updateVersionRecord(item.id, 'remark', $event.target.value)"></textarea>
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
                                            <select class="sop-status-select" style="margin-left:auto;" :value="getRecord(item.id).status" @change="updateVersionRecord(item.id, 'status', $event.target.value)">
                                                <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
                                            </select>
                                        </div>
                                        <div v-if="item.instruction_text" class="sop-action-item-instruction" :style="{ WebkitLineClamp: isInstructionExpanded(item.id) ? 'none' : '3', cursor: 'pointer', whiteSpace: 'pre-wrap' }" @click="toggleInstruction(item.id)">{{ item.instruction_text }}</div>
                                        <div v-if="item.image_url" class="sop-example-image sop-example-thumb">
                                            <img :src="item.image_url" alt="示例图片" class="zoomable" @click="openViewer(item.image_url)">
                                        </div>
                                        <div v-if="getRecord(item.id).image_url" class="sop-action-uploaded-images">
                                            <div v-for="url in parseUploadedUrls(getRecord(item.id).image_url)" :key="url" class="sop-action-uploaded-image">
                                                <img :src="url" alt="操作图片" class="zoomable" @click="openViewer(url)">
                                            </div>
                                        </div>
                                        <div class="sop-action-footer">
                                            <textarea class="sop-remark" placeholder="备注..." rows="1" :value="getRecord(item.id).remark || ''" @blur="updateVersionRecord(item.id, 'remark', $event.target.value)"></textarea>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>`
};
