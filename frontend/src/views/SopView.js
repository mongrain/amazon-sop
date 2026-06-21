import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';
import { openViewer } from '@/utils/viewer.js';

export default {
    name: 'SopView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const modules = ref([]);
        const loading = ref(true);
        const editMode = ref(false);
        const collapsedGroups = ref({});
        const editNames = ref({});

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/sop');
                modules.value = data.modules || [];
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
            }
        }

        function getDataItems(module) {
            return (module.sop_items || []).filter(i => i.is_data_column);
        }
        function getActionItems(module) {
            return (module.sop_items || []).filter(i => !i.is_data_column);
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
        function toggleEditMode() {
            editMode.value = !editMode.value;
            if (editMode.value) {
                const names = {};
                modules.value.forEach(mod => {
                    (mod.sop_items || []).forEach(item => {
                        names[item.id] = item.name;
                    });
                });
                editNames.value = names;
            }
        }
        function getEditName(itemId) {
            return editNames.value[itemId] || '';
        }
        function setEditName(itemId, val) {
            editNames.value[itemId] = val;
        }

        async function saveItemName(itemId) {
            const newName = String(editNames.value[itemId] || '').trim();
            if (!newName) return;
            try {
                await http.put('/api/sop/item/' + itemId, { name: newName });
                await loadData();
            } catch (e) {
                alert(getApiError(e, '保存失败'));
            }
        }

        async function deleteItem(itemId) {
            if (!confirm('确认删除此操作项？')) return;
            try {
                await http.delete('/api/sop/item/' + itemId);
                await loadData();
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        async function addItem(moduleId, type) {
            const name = prompt('请输入名称：');
            if (!name) return;
            const instruction = type === 'action' ? prompt('请输入操作说明（可选）：') || '' : '';
            try {
                await http.post('/api/sop/item', {
                    module_id: moduleId,
                    name,
                    instruction_text: instruction,
                    is_data_column: type === 'data' ? 1 : 0
                });
                await loadData();
            } catch (e) {
                alert(getApiError(e, '添加失败'));
            }
        }

        async function uploadImage(itemId, event) {
            const input = event.target;
            if (!input.files || !input.files[0]) return;
            const formData = new FormData();
            formData.append('image', input.files[0]);
            try {
                await http.post('/api/sop/item/' + itemId + '/image', formData);
                await loadData();
            } catch (e) {
                alert(getApiError(e, '上传失败'));
            }
            input.value = '';
        }

        function openViewer(src) {
            window.openViewer(src);
        }

        onMounted(loadData);

        return {
            modules, loading, editMode, collapsedGroups, editNames,
            getDataItems, getActionItems, isGroupCollapsed, toggleGroup, toggleEditMode,
            getEditName, setEditName, saveItemName, deleteItem, addItem, uploadImage, openViewer
        };
    },
    template: `<div class="page-header">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                    <h1>SOP 标准操作规范</h1>
                    <p class="page-desc">所有模块的操作流程与详细说明，供运营人员参考</p>
                </div>
                <button class="btn-primary" :class="{ 'btn-danger': editMode }" @click="toggleEditMode">
                    {{ editMode ? '退出编辑' : '编辑模式' }}
                </button>
            </div>
        </div>
        <div v-if="loading" style="text-align:center; padding:40px; color:#999;">加载中...</div>
        <div v-else class="sop-grid">
            <div v-for="module in modules" :key="module.id" class="sop-card" :data-module-id="module.id">
                <div class="sop-card-header">
                    <h2 class="sop-card-title">{{ module.name }}</h2>
                    <span class="sop-card-count">{{ getDataItems(module).length }} 数据 · {{ getActionItems(module).length }} 操作</span>
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
                                <div v-for="item in getDataItems(module)" :key="item.id" class="sop-data-item" :data-item-id="item.id">
                                    <div class="sop-data-item-label">
                                        <span v-show="!editMode" class="item-name-display">{{ item.name }}</span>
                                        <span v-show="editMode" class="item-edit-controls" style="display:inline;">
                                            <input type="text" class="item-edit-input" :value="getEditName(item.id)" @input="setEditName(item.id, $event.target.value)">
                                        </span>
                                    </div>
                                    <div class="sop-data-item-sub"><code>{{ item.table_ref || '' }}</code></div>
                                    <div v-if="item.instruction_text" class="sop-data-item-desc">{{ item.instruction_text }}</div>
                                    <div v-show="editMode" class="sop-item-actions" style="display:inline-flex;">
                                        <button class="btn-icon btn-delete" title="删除" @click="deleteItem(item.id)">&times;</button>
                                    </div>
                                </div>
                            </div>
                            <button v-show="editMode" class="btn-add-item" style="display:inline-block;" @click="addItem(module.id, 'data')">+ 添加数据字段</button>
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
                                <div v-for="(item, idx) in getActionItems(module)" :key="item.id" class="sop-action-item" :data-item-id="item.id">
                                    <div class="sop-action-item-header">
                                        <span class="sop-action-item-index">#{{ idx + 1 }}</span>
                                        <span v-show="!editMode" class="item-name-display">{{ item.name }}</span>
                                        <span v-show="editMode" class="item-edit-controls" style="display:inline;">
                                            <input type="text" class="item-edit-input" :value="getEditName(item.id)" @input="setEditName(item.id, $event.target.value)">
                                            <button class="btn-sm btn-save-item" @click="saveItemName(item.id)">保存</button>
                                        </span>
                                    </div>
                                    <div v-if="item.instruction_text" class="sop-action-item-instruction">{{ item.instruction_text }}</div>
                                    <div v-if="item.image_url" class="sop-example-image sop-example-direct">
                                        <img :src="item.image_url" alt="示例图片" class="zoomable" @click="openViewer(item.image_url)">
                                    </div>
                                    <div v-show="editMode" class="sop-item-actions" style="display:inline-flex;">
                                        <label class="btn-upload-image" title="上传示例图片">
                                            上传图片
                                            <input type="file" accept="image/*" style="display:none;" @change="uploadImage(item.id, $event)">
                                        </label>
                                        <button class="btn-icon btn-delete" title="删除" @click="deleteItem(item.id)">&times;</button>
                                    </div>
                                </div>
                            </div>
                            <button v-show="editMode" class="btn-add-item" style="display:inline-block;" @click="addItem(module.id, 'action')">+ 添加操作项</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`
};
