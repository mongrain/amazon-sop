import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

export default {
    name: 'ImportView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const importPath = ref('');
        const result = ref(null);
        const importing = ref(false);
        const error = ref('');

        onMounted(async () => {
            try {
                const { data } = await http.get('/api/import');
                importPath.value = data.import_path || '';
            } catch (e) { /* ignore */ }
        });

        async function startImport() {
            error.value = '';
            importing.value = true;
            result.value = null;
            try {
                const { data } = await http.post('/api/import');
                result.value = data.result || data;
            } catch (e) {
                error.value = getApiError(e, '导入失败');
            } finally {
                importing.value = false;
            }
        }

        return { importPath, result, importing, error, startImport };
    },
    template: `<div class="page-header">
                <h1>导入Excel数据</h1>
            </div>
            <div class="import-container">
                <div class="import-card">
                    <h2>从复核审核表导入</h2>
                    <p class="import-desc">
                        系统将读取 <code>复核审核表.xlsx</code> 中的产品数据和操作记录，<br>
                        自动推断每项SOP任务的执行状态并导入数据库。
                    </p>
                    <p v-if="importPath" class="import-note">
                        Excel文件路径: <code>{{ importPath }}</code>
                    </p>
                    <button type="button" class="btn-primary btn-large" @click="startImport" :disabled="importing">
                        {{ importing ? '导入中…' : '开始导入' }}
                    </button>
                </div>
                <div v-if="error" class="import-result error">
                    <h3>导入失败</h3>
                    <p>{{ error }}</p>
                </div>
                <div v-if="result" class="import-result" :class="result.error ? 'error' : 'success'">
                    <template v-if="result.error">
                        <h3>导入失败</h3>
                        <p>{{ result.error }}</p>
                    </template>
                    <template v-else>
                        <h3>导入完成</h3>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="result-number">{{ result.products_added }}</span>
                                <span class="result-label">产品导入</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ result.records_created }}</span>
                                <span class="result-label">记录创建</span>
                            </div>
                        </div>
                        <div v-if="result.errors && result.errors.length" class="result-errors">
                            <h4>部分错误:</h4>
                            <ul>
                                <li v-for="(err, i) in result.errors.slice(0, 10)" :key="i">{{ err }}</li>
                            </ul>
                        </div>
                        <router-link to="/dashboard" class="btn-secondary">查看产品看板</router-link>
                    </template>
                </div>
            </div>`
};
