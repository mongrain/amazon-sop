import { computed, onMounted, reactive, ref } from 'vue';
import { fmtDateTime, getApiError, http } from '@/utils/index.js';

const TABS = [
    { key: 'schema', label: '表 Schema' },
    { key: 'generate', label: '生成 SQL' },
    { key: 'saved', label: '已保存 SQL' }
];

const FIELD_TYPE_LABELS = {
    string: '字符串',
    number: '数值',
    date: '日期',
    timestamp: '时间戳',
    boolean: '布尔'
};

const AGG_THRESHOLD_LABELS = {
    NONE: 'NONE',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    VERY_HIGH: 'VERY_HIGH'
};

function emptyFieldForm() {
    return {
        amazon_field: '',
        translation: '',
        field_type: 'string',
        description: '',
        agg_threshold: 'NONE'
    };
}

export default {
    name: 'AmcAdsView',
    setup() {
        const activeTab = ref('schema');
        const error = ref('');
        const loading = ref(false);
        const fieldTypes = ref(['string', 'number', 'date', 'timestamp', 'boolean']);
        const aggThresholds = ref(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']);

        // Schema 管理
        const schemas = ref([]);
        const selectedSchemaId = ref(null);
        const currentSchema = ref(null);
        const schemaForm = reactive({ name: '', translation: '', description: '' });
        const fieldForm = reactive(emptyFieldForm());
        const editingFieldId = ref(null);
        const schemaSaving = ref(false);
        const fieldSaving = ref(false);

        // SQL 生成
        const genSchemaId = ref('');
        const genFields = ref([]);
        const selectedFieldIds = ref([]);
        const genWhere = ref('');
        const genDateField = ref('');
        const genDateFrom = ref('');
        const genDateTo = ref('');
        const generatedSql = ref('');
        const generating = ref(false);

        // 保存 SQL
        const saveForm = reactive({ name: '', note: '', group_id: null });
        const saving = ref(false);

        // 已保存 SQL
        const savedScripts = ref([]);
        const savedLoading = ref(false);
        const versionModalOpen = ref(false);
        const versionList = ref([]);
        const versionModalTitle = ref('');
        const viewingSql = ref('');

        const descTip = ref({ show: false, text: '', x: 0, y: 0 });
        const descOverflowIds = ref({});

        function onDescMouseEnter(event, field) {
            const el = event.currentTarget;
            const text = field && field.description ? String(field.description) : '';
            if (!text || !el) return;
            const overflow = el.scrollHeight > el.clientHeight + 1;
            descOverflowIds.value = { ...descOverflowIds.value, [field.id]: overflow };
            if (!overflow) {
                descTip.value = { show: false, text: '', x: 0, y: 0 };
                return;
            }
            const rect = el.getBoundingClientRect();
            descTip.value = {
                show: true,
                text,
                x: rect.left,
                y: rect.bottom + 6
            };
        }

        function hideDescTip() {
            descTip.value = { show: false, text: '', x: 0, y: 0 };
        }

        const selectedSchema = computed(() => currentSchema.value);
        const schemaFields = computed(() => (currentSchema.value && currentSchema.value.fields) || []);
        const allFieldsSelected = computed(() => {
            if (!genFields.value.length) return false;
            return genFields.value.every(f => selectedFieldIds.value.includes(f.id));
        });

        async function loadSchemas() {
            const { data } = await http.get('/api/amc/schemas');
            schemas.value = data.schemas || [];
            if (data.fieldTypes) fieldTypes.value = data.fieldTypes;
            if (data.aggThresholds) aggThresholds.value = data.aggThresholds;
        }

        async function loadSchemaDetail(id) {
            if (!id) {
                currentSchema.value = null;
                return;
            }
            const { data } = await http.get('/api/amc/schemas/' + id);
            currentSchema.value = data.schema;
            schemaForm.name = data.schema.name || '';
            schemaForm.translation = data.schema.translation || '';
            schemaForm.description = data.schema.description || '';
        }

        async function selectSchema(id) {
            selectedSchemaId.value = id;
            editingFieldId.value = null;
            Object.assign(fieldForm, emptyFieldForm());
            await loadSchemaDetail(id);
        }

        function resetSchemaForm() {
            selectedSchemaId.value = null;
            currentSchema.value = null;
            schemaForm.name = '';
            schemaForm.translation = '';
            schemaForm.description = '';
            editingFieldId.value = null;
            Object.assign(fieldForm, emptyFieldForm());
        }

        async function saveSchema() {
            error.value = '';
            schemaSaving.value = true;
            try {
                const payload = { name: schemaForm.name, translation: schemaForm.translation, description: schemaForm.description };
                if (selectedSchemaId.value) {
                    const { data } = await http.put('/api/amc/schemas/' + selectedSchemaId.value, payload);
                    currentSchema.value = data.schema;
                } else {
                    const { data } = await http.post('/api/amc/schemas', payload);
                    selectedSchemaId.value = data.schema.id;
                    currentSchema.value = data.schema;
                }
                await loadSchemas();
            } catch (e) {
                error.value = getApiError(e, '保存 Schema 失败');
            } finally {
                schemaSaving.value = false;
            }
        }

        async function removeSchema(id) {
            if (!confirm('确定删除该 Schema 表？关联字段与引用将一并移除。')) return;
            error.value = '';
            try {
                await http.delete('/api/amc/schemas/' + id);
                if (selectedSchemaId.value === id) resetSchemaForm();
                await loadSchemas();
            } catch (e) {
                error.value = getApiError(e, '删除失败');
            }
        }

        function editField(field) {
            editingFieldId.value = field.id;
            fieldForm.amazon_field = field.amazon_field || '';
            fieldForm.translation = field.translation || '';
            fieldForm.field_type = field.field_type || 'string';
            fieldForm.description = field.description || '';
            fieldForm.agg_threshold = field.agg_threshold || 'NONE';
        }

        function cancelFieldEdit() {
            editingFieldId.value = null;
            Object.assign(fieldForm, emptyFieldForm());
        }

        async function saveField() {
            if (!selectedSchemaId.value) {
                error.value = '请先保存 Schema 表';
                return;
            }
            error.value = '';
            fieldSaving.value = true;
            try {
                const payload = { ...fieldForm };
                if (editingFieldId.value) {
                    await http.put('/api/amc/fields/' + editingFieldId.value, payload);
                } else {
                    await http.post('/api/amc/schemas/' + selectedSchemaId.value + '/fields', payload);
                }
                cancelFieldEdit();
                await loadSchemaDetail(selectedSchemaId.value);
                await loadSchemas();
            } catch (e) {
                error.value = getApiError(e, '保存字段失败');
            } finally {
                fieldSaving.value = false;
            }
        }

        async function removeField(fieldId) {
            if (!confirm('确定删除该字段？')) return;
            error.value = '';
            try {
                await http.delete('/api/amc/fields/' + fieldId);
                if (editingFieldId.value === fieldId) cancelFieldEdit();
                await loadSchemaDetail(selectedSchemaId.value);
                await loadSchemas();
            } catch (e) {
                error.value = getApiError(e, '删除字段失败');
            }
        }

        async function onGenSchemaChange() {
            genFields.value = [];
            selectedFieldIds.value = [];
            generatedSql.value = '';
            if (!genSchemaId.value) return;
            const { data } = await http.get('/api/amc/schemas/' + genSchemaId.value);
            genFields.value = (data.schema && data.schema.fields) || [];
            selectedFieldIds.value = genFields.value.map(f => f.id);
        }

        function toggleField(id) {
            const idx = selectedFieldIds.value.indexOf(id);
            if (idx >= 0) selectedFieldIds.value.splice(idx, 1);
            else selectedFieldIds.value.push(id);
        }

        function toggleAllFields() {
            if (allFieldsSelected.value) {
                selectedFieldIds.value = [];
            } else {
                selectedFieldIds.value = genFields.value.map(f => f.id);
            }
        }

        async function generateSql() {
            error.value = '';
            generating.value = true;
            try {
                const { data } = await http.post('/api/amc/generate-sql', {
                    schema_id: Number(genSchemaId.value),
                    selected_field_ids: selectedFieldIds.value,
                    where_clause: genWhere.value,
                    date_field: genDateField.value,
                    date_from: genDateFrom.value,
                    date_to: genDateTo.value
                });
                generatedSql.value = data.sql || '';
                saveForm.name = saveForm.name || ((data.schema && (data.schema.translation || data.schema.name)) ? (data.schema.translation || data.schema.name) + ' 查询' : '');
            } catch (e) {
                error.value = getApiError(e, '生成 SQL 失败');
            } finally {
                generating.value = false;
            }
        }

        function copySql() {
            if (!generatedSql.value) return;
            navigator.clipboard.writeText(generatedSql.value).then(() => {
                alert('已复制到剪贴板');
            }).catch(() => {
                alert('复制失败，请手动复制');
            });
        }

        async function saveSql() {
            if (!generatedSql.value) {
                error.value = '请先生成 SQL';
                return;
            }
            error.value = '';
            saving.value = true;
            try {
                const payload = {
                    name: saveForm.name,
                    note: saveForm.note,
                    sql_content: generatedSql.value,
                    schema_id: genSchemaId.value ? Number(genSchemaId.value) : null,
                    selected_field_ids: selectedFieldIds.value,
                    group_id: saveForm.group_id || null
                };
                const { data } = await http.post('/api/amc/sql-scripts', payload);
                saveForm.group_id = data.script.group_id;
                alert(saveForm.group_id === data.script.id ? '已保存 v1' : '已保存 v' + data.script.version);
                if (activeTab.value === 'saved') loadSavedScripts();
            } catch (e) {
                error.value = getApiError(e, '保存失败');
            } finally {
                saving.value = false;
            }
        }

        async function loadSavedScripts() {
            savedLoading.value = true;
            try {
                const { data } = await http.get('/api/amc/sql-scripts');
                savedScripts.value = data.items || [];
            } catch (e) {
                savedScripts.value = [];
            } finally {
                savedLoading.value = false;
            }
        }

        async function openVersions(item) {
            versionModalTitle.value = item.name + ' — 版本历史';
            viewingSql.value = item.sql_content || '';
            try {
                const { data } = await http.get('/api/amc/sql-scripts/' + item.group_id + '/versions');
                versionList.value = data.versions || [];
            } catch (e) {
                versionList.value = [];
            }
            versionModalOpen.value = true;
        }

        function viewVersion(v) {
            viewingSql.value = v.sql_content || '';
        }

        function loadVersionToEditor(v) {
            generatedSql.value = v.sql_content || '';
            saveForm.name = v.name || '';
            saveForm.note = v.note || '';
            saveForm.group_id = v.group_id;
            genSchemaId.value = v.schema_id ? String(v.schema_id) : '';
            if (v.selected_fields) {
                try {
                    const ids = typeof v.selected_fields === 'string' ? JSON.parse(v.selected_fields) : v.selected_fields;
                    selectedFieldIds.value = Array.isArray(ids) ? ids : [];
                } catch (e) {
                    selectedFieldIds.value = [];
                }
            }
            versionModalOpen.value = false;
            activeTab.value = 'generate';
            if (genSchemaId.value) onGenSchemaChange();
        }

        async function removeVersion(v) {
            if (!confirm('确定删除 v' + v.version + '？')) return;
            try {
                await http.delete('/api/amc/sql-scripts/version/' + v.id);
                versionList.value = versionList.value.filter(x => x.id !== v.id);
                await loadSavedScripts();
                if (!versionList.value.length) versionModalOpen.value = false;
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function switchTab(key) {
            activeTab.value = key;
            error.value = '';
            if (key === 'saved') loadSavedScripts();
            if (key === 'generate' && genSchemaId.value) onGenSchemaChange();
        }

        onMounted(async () => {
            loading.value = true;
            try {
                await loadSchemas();
            } finally {
                loading.value = false;
            }
        });

        return {
            TABS, FIELD_TYPE_LABELS, AGG_THRESHOLD_LABELS, activeTab, error, loading, fieldTypes, aggThresholds,
            schemas, selectedSchemaId, selectedSchema, schemaFields, schemaForm,
            fieldForm, editingFieldId, schemaSaving, fieldSaving,
            genSchemaId, genFields, selectedFieldIds, genWhere, genDateField, genDateFrom, genDateTo,
            generatedSql, generating, allFieldsSelected,
            saveForm, saving, savedScripts, savedLoading,
            versionModalOpen, versionList, versionModalTitle, viewingSql,
            selectSchema, resetSchemaForm, saveSchema, removeSchema,
            editField, cancelFieldEdit, saveField, removeField,
            onGenSchemaChange, toggleField, toggleAllFields, generateSql, copySql, saveSql,
            openVersions, viewVersion, loadVersionToEditor, removeVersion,
            switchTab, fmtDateTime,
            descTip, onDescMouseEnter, hideDescTip, descOverflowIds
        };
    },
    template: `
<div class="page-header">
    <h1>AMC 广告</h1>
    <div class="page-desc">管理亚马逊 AMC 表 Schema，生成 SQL 查询并保存版本</div>
</div>

<div v-if="error" class="alert alert-error" style="margin-bottom:16px;">{{ error }}</div>

<div class="amc-tabs" style="display:flex; gap:8px; margin-bottom:20px; border-bottom:1px solid var(--border-color, #e5e7eb); padding-bottom:8px;">
    <button v-for="tab in TABS" :key="tab.key" type="button"
        :class="['btn-secondary', { 'btn-primary': activeTab === tab.key }]"
        style="padding:6px 16px;"
        @click="switchTab(tab.key)">{{ tab.label }}</button>
</div>

<!-- Schema 管理 -->
<div v-show="activeTab === 'schema'" class="amc-schema-panel">
    <div style="display:grid; grid-template-columns:280px 1fr; gap:20px; align-items:start;">
        <div class="module-card" style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <strong>Schema 列表</strong>
                <button type="button" class="btn-primary" style="padding:4px 10px; font-size:13px;" @click="resetSchemaForm">+ 新建</button>
            </div>
            <div v-if="loading" style="color:#888; font-size:13px;">加载中…</div>
            <ul v-else style="list-style:none; padding:0; margin:0;">
                <li v-for="s in schemas" :key="s.id"
                    :style="{ padding:'8px 10px', borderRadius:'6px', cursor:'pointer', marginBottom:'4px', background: selectedSchemaId === s.id ? '#eff6ff' : 'transparent' }"
                    @click="selectSchema(s.id)">
                    <div style="font-weight:500;">{{ s.translation || s.name }}</div>
                    <div v-if="s.translation" style="font-size:12px; color:#888;"><code>{{ s.name }}</code></div>
                    <div style="font-size:12px; color:#888;">{{ s.field_count || 0 }} 个字段</div>
                </li>
                <li v-if="!schemas.length" style="color:#888; font-size:13px; padding:8px;">暂无 Schema，点击新建</li>
            </ul>
        </div>

        <div class="module-card" style="padding:20px;">
            <h3 style="margin:0 0 16px; font-size:16px;">{{ selectedSchemaId ? '编辑 Schema' : '新建 Schema' }}</h3>
            <div style="display:grid; gap:12px; max-width:560px; margin-bottom:20px;">
                <label style="display:grid; gap:4px; font-size:13px;">
                    <span>表名（亚马逊 AMC 表名）</span>
                    <input v-model="schemaForm.name" class="search-input" placeholder="如 dsp_impressions">
                </label>
                <label style="display:grid; gap:4px; font-size:13px;">
                    <span>表名中文翻译</span>
                    <input v-model="schemaForm.translation" class="search-input" placeholder="如：DSP 曝光">
                </label>
                <label style="display:grid; gap:4px; font-size:13px;">
                    <span>描述</span>
                    <textarea v-model="schemaForm.description" class="search-input" rows="2" placeholder="可选"></textarea>
                </label>
                <div style="display:flex; gap:8px;">
                    <button type="button" class="btn-primary" :disabled="schemaSaving" @click="saveSchema">{{ schemaSaving ? '保存中…' : '保存 Schema' }}</button>
                    <button v-if="selectedSchemaId" type="button" class="btn-secondary" @click="removeSchema(selectedSchemaId)">删除</button>
                </div>
            </div>

            <template v-if="selectedSchemaId">
                <hr style="border:none; border-top:1px solid #eee; margin:20px 0;">
                <h4 style="margin:0 0 12px;">字段管理</h4>
                <div class="table-container" style="margin-bottom:16px;">
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th>亚马逊字段</th>
                                <th>翻译</th>
                                <th>类型</th>
                                <th>描述</th>
                                <th>聚合阈值</th>
                                <th style="width:100px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="f in schemaFields" :key="f.id">
                                <td><code>{{ f.amazon_field }}</code></td>
                                <td>{{ f.translation || '—' }}</td>
                                <td>{{ FIELD_TYPE_LABELS[f.field_type] || f.field_type }}</td>
                                <td style="vertical-align:top;">
                                    <div
                                        v-if="f.description"
                                        class="amc-field-desc-text"
                                        :class="{ 'amc-field-desc-text--hover': descOverflowIds[f.id] }"
                                        @mouseenter="onDescMouseEnter($event, f)"
                                        @mouseleave="hideDescTip"
                                    >{{ f.description }}</div>
                                    <span v-else>—</span>
                                </td>
                                <td>{{ AGG_THRESHOLD_LABELS[f.agg_threshold] || f.agg_threshold || 'NONE' }}</td>
                                <td>
                                    <button type="button" class="btn-secondary" style="padding:2px 8px; font-size:12px; margin-right:4px;" @click="editField(f)">编辑</button>
                                    <button type="button" class="btn-secondary" style="padding:2px 8px; font-size:12px;" @click="removeField(f.id)">删</button>
                                </td>
                            </tr>
                            <tr v-if="!schemaFields.length">
                                <td colspan="6" style="text-align:center; color:#888;">暂无字段，请在下方添加</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div style="background:#f9fafb; border-radius:8px; padding:16px;">
                    <strong style="font-size:13px;">{{ editingFieldId ? '编辑字段' : '新增字段' }}</strong>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px;">
                        <label style="display:grid; gap:4px; font-size:13px;">
                            <span>亚马逊字段 *</span>
                            <input v-model="fieldForm.amazon_field" class="search-input" placeholder="user_id">
                        </label>
                        <label style="display:grid; gap:4px; font-size:13px;">
                            <span>翻译</span>
                            <input v-model="fieldForm.translation" class="search-input" placeholder="字段中文名">
                        </label>
                        <label style="display:grid; gap:4px; font-size:13px;">
                            <span>类型</span>
                            <select v-model="fieldForm.field_type" class="search-input">
                                <option v-for="t in fieldTypes" :key="t" :value="t">{{ FIELD_TYPE_LABELS[t] || t }}</option>
                            </select>
                        </label>
                        <label style="display:grid; gap:4px; font-size:13px;">
                            <span>聚合阈值</span>
                            <select v-model="fieldForm.agg_threshold" class="search-input">
                                <option v-for="t in aggThresholds" :key="t" :value="t">{{ AGG_THRESHOLD_LABELS[t] || t }}</option>
                            </select>
                        </label>
                        <label style="display:grid; gap:4px; font-size:13px; grid-column:1/-1;">
                            <span>描述</span>
                            <textarea v-model="fieldForm.description" class="search-input" rows="3" placeholder="字段说明"></textarea>
                        </label>
                    </div>
                    <div style="display:flex; gap:8px; margin-top:12px;">
                        <button type="button" class="btn-primary" :disabled="fieldSaving" @click="saveField">{{ fieldSaving ? '保存中…' : (editingFieldId ? '更新字段' : '添加字段') }}</button>
                        <button v-if="editingFieldId" type="button" class="btn-secondary" @click="cancelFieldEdit">取消</button>
                    </div>
                </div>
            </template>
        </div>
    </div>
</div>

<!-- SQL 生成 -->
<div v-show="activeTab === 'generate'" class="amc-generate-panel">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start;">
        <div class="module-card" style="padding:20px;">
            <h3 style="margin:0 0 16px; font-size:16px;">查询配置</h3>
            <label style="display:grid; gap:4px; font-size:13px; margin-bottom:12px;">
                <span>选择 Schema 表</span>
                <select v-model="genSchemaId" class="search-input" @change="onGenSchemaChange">
                    <option value="">— 请选择 —</option>
                    <option v-for="s in schemas" :key="s.id" :value="String(s.id)">{{ s.translation ? (s.translation + ' / ' + s.name) : s.name }}</option>
                </select>
            </label>

            <div v-if="genFields.length" style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="font-size:13px;">选择字段</strong>
                    <button type="button" class="btn-secondary" style="padding:2px 8px; font-size:12px;" @click="toggleAllFields">{{ allFieldsSelected ? '全不选' : '全选' }}</button>
                </div>
                <div style="max-height:240px; overflow-y:auto; border:1px solid #eee; border-radius:6px; padding:8px;">
                    <label v-for="f in genFields" :key="f.id" style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px; cursor:pointer;">
                        <input type="checkbox" :checked="selectedFieldIds.includes(f.id)" @change="toggleField(f.id)">
                        <code>{{ f.amazon_field }}</code>
                        <span style="color:#888;">{{ f.translation || FIELD_TYPE_LABELS[f.field_type] }}</span>
                    </label>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                <label style="display:grid; gap:4px; font-size:13px;">
                    <span>日期字段</span>
                    <input v-model="genDateField" class="search-input" placeholder="event_dt">
                </label>
                <label style="display:grid; gap:4px; font-size:13px;">
                    <span>起始日期</span>
                    <input v-model="genDateFrom" type="date" class="search-input">
                </label>
                <label style="display:grid; gap:4px; font-size:13px;">
                    <span>结束日期</span>
                    <input v-model="genDateTo" type="date" class="search-input">
                </label>
            </div>
            <label style="display:grid; gap:4px; font-size:13px; margin-bottom:16px;">
                <span>自定义 WHERE 条件</span>
                <textarea v-model="genWhere" class="search-input" rows="2" placeholder="campaign_id IS NOT NULL"></textarea>
            </label>
            <button type="button" class="btn-primary" :disabled="generating || !genSchemaId" @click="generateSql">{{ generating ? '生成中…' : '生成 SQL' }}</button>
        </div>

        <div class="module-card" style="padding:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h3 style="margin:0; font-size:16px;">SQL 预览</h3>
                <button v-if="generatedSql" type="button" class="btn-secondary" style="padding:4px 10px; font-size:13px;" @click="copySql">复制</button>
            </div>
            <pre v-if="generatedSql" style="background:#1e293b; color:#e2e8f0; padding:16px; border-radius:8px; overflow-x:auto; font-size:13px; line-height:1.5; min-height:200px; white-space:pre-wrap;">{{ generatedSql }}</pre>
            <div v-else style="color:#888; font-size:13px; padding:40px; text-align:center; border:1px dashed #ddd; border-radius:8px;">选择 Schema 并生成 SQL</div>

            <div v-if="generatedSql" style="margin-top:20px; padding-top:16px; border-top:1px solid #eee;">
                <strong style="font-size:13px;">保存 SQL</strong>
                <div style="display:grid; gap:12px; margin-top:12px;">
                    <label style="display:grid; gap:4px; font-size:13px;">
                        <span>脚本名称 *</span>
                        <input v-model="saveForm.name" class="search-input" placeholder="DSP 曝光分析">
                    </label>
                    <label style="display:grid; gap:4px; font-size:13px;">
                        <span>版本备注</span>
                        <input v-model="saveForm.note" class="search-input" placeholder="可选，如：增加日期过滤">
                    </label>
                    <p v-if="saveForm.group_id" style="font-size:12px; color:#888; margin:0;">将保存为新版本（基于已有脚本组 #{{ saveForm.group_id }}）</p>
                    <button type="button" class="btn-primary" :disabled="saving" @click="saveSql">{{ saving ? '保存中…' : '保存 SQL' }}</button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- 已保存 SQL -->
<div v-show="activeTab === 'saved'" class="amc-saved-panel">
    <div class="module-card" style="padding:20px;">
        <div v-if="savedLoading" style="color:#888;">加载中…</div>
        <div v-else-if="!savedScripts.length" style="color:#888; text-align:center; padding:40px;">暂无已保存的 SQL</div>
        <div v-else class="table-container">
            <table class="product-table">
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>版本</th>
                        <th>备注</th>
                        <th>创建人</th>
                        <th>更新时间</th>
                        <th style="width:160px;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in savedScripts" :key="item.id">
                        <td>{{ item.name }}</td>
                        <td><span class="badge">v{{ item.version }}</span></td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">{{ item.note || '—' }}</td>
                        <td>{{ item.creator_name || '—' }}</td>
                        <td>{{ fmtDateTime(item.created_at) }}</td>
                        <td>
                            <button type="button" class="btn-secondary" style="padding:2px 8px; font-size:12px; margin-right:4px;" @click="openVersions(item)">版本</button>
                            <button type="button" class="btn-secondary" style="padding:2px 8px; font-size:12px;" @click="loadVersionToEditor(item)">编辑</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</div>

<!-- 版本历史弹窗 -->
<div v-if="versionModalOpen" class="modal-overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:1000;" @click.self="versionModalOpen = false">
    <div class="module-card" style="width:90%; max-width:900px; max-height:85vh; overflow:hidden; display:flex; flex-direction:column; padding:0;">
        <div style="padding:16px 20px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
            <strong>{{ versionModalTitle }}</strong>
            <button type="button" class="btn-secondary" style="padding:4px 10px;" @click="versionModalOpen = false">关闭</button>
        </div>
        <div style="display:grid; grid-template-columns:220px 1fr; flex:1; overflow:hidden;">
            <ul style="list-style:none; margin:0; padding:8px; overflow-y:auto; border-right:1px solid #eee;">
                <li v-for="v in versionList" :key="v.id"
                    style="padding:8px 10px; border-radius:6px; cursor:pointer; margin-bottom:4px; font-size:13px;"
                    :style="{ background: viewingSql === v.sql_content ? '#eff6ff' : 'transparent' }"
                    @click="viewVersion(v)">
                    <div><strong>v{{ v.version }}</strong> — {{ fmtDateTime(v.created_at) }}</div>
                    <div style="color:#888; font-size:12px;">{{ v.note || v.creator_name || '' }}</div>
                    <div style="margin-top:4px;">
                        <button type="button" class="btn-secondary" style="padding:1px 6px; font-size:11px; margin-right:4px;" @click.stop="loadVersionToEditor(v)">载入</button>
                        <button type="button" class="btn-secondary" style="padding:1px 6px; font-size:11px;" @click.stop="removeVersion(v)">删</button>
                    </div>
                </li>
            </ul>
            <pre style="margin:0; padding:16px; overflow:auto; background:#1e293b; color:#e2e8f0; font-size:13px; line-height:1.5; white-space:pre-wrap;">{{ viewingSql || '选择版本查看' }}</pre>
        </div>
    </div>
</div>

<div
    v-if="descTip.show"
    class="amc-field-desc-tip-fixed"
    :style="{ left: descTip.x + 'px', top: descTip.y + 'px' }"
>{{ descTip.text }}</div>
`
};
