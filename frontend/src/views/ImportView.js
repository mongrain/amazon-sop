import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

export default {
    name: 'ImportView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const importPath = ref('');
        const tacosPath = ref('');
        const result = ref(null);
        const tacosResult = ref(null);
        const importing = ref(false);
        const importingTacos = ref(false);
        const error = ref('');
        const tacosError = ref('');

        onMounted(async () => {
            try {
                const [sopRes, tacosRes] = await Promise.all([
                    http.get('/api/import'),
                    http.get('/api/import/tacos')
                ]);
                importPath.value = sopRes.data.import_path || '';
                tacosPath.value = tacosRes.data.import_path || '';
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

        async function startTacosImport() {
            tacosError.value = '';
            importingTacos.value = true;
            tacosResult.value = null;
            try {
                const { data } = await http.post('/api/import/tacos');
                tacosResult.value = data.result || data;
            } catch (e) {
                tacosError.value = getApiError(e, '导入失败');
            } finally {
                importingTacos.value = false;
            }
        }

        return {
            importPath, tacosPath, result, tacosResult,
            importing, importingTacos, error, tacosError,
            startImport, startTacosImport
        };
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

                <div class="import-card" style="margin-top:24px;">
                    <h2>从 TACOS 利润表导入</h2>
                    <p class="import-desc">
                        系统将读取 <code>public/TACOS.xlsx</code> 中的卖价、进价、头程、尾程+Fee、广告等字段，<br>
                        写入产品详情页的「利润看盘」。若 ASIN 重复，以表格中<strong>最后一行</strong>为准。
                    </p>
                    <p v-if="tacosPath" class="import-note">
                        Excel文件路径: <code>{{ tacosPath }}</code>
                    </p>
                    <button type="button" class="btn-primary btn-large" @click="startTacosImport" :disabled="importingTacos">
                        {{ importingTacos ? '导入中…' : '导入 TACOS' }}
                    </button>
                </div>

                <div v-if="tacosError" class="import-result error">
                    <h3>TACOS 导入失败</h3>
                    <p>{{ tacosError }}</p>
                </div>
                <div v-if="tacosResult" class="import-result" :class="tacosResult.error ? 'error' : 'success'">
                    <template v-if="tacosResult.error">
                        <h3>TACOS 导入失败</h3>
                        <p>{{ tacosResult.error }}</p>
                    </template>
                    <template v-else>
                        <h3>TACOS 导入完成</h3>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="result-number">{{ tacosResult.economics_updated }}</span>
                                <span class="result-label">利润数据更新</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ tacosResult.products_created }}</span>
                                <span class="result-label">新建产品</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ tacosResult.unique_asin }}</span>
                                <span class="result-label">唯一 ASIN</span>
                            </div>
                        </div>
                        <p v-if="tacosResult.exchange_rate" class="import-note" style="margin-top:12px;">
                            已写入汇率：1 USD = {{ tacosResult.exchange_rate }} CNY
                        </p>
                        <p v-if="tacosResult.total_rows > tacosResult.unique_asin" class="import-note">
                            共 {{ tacosResult.total_rows }} 行数据，{{ tacosResult.total_rows - tacosResult.unique_asin }} 行重复 ASIN 已按最后一行覆盖
                        </p>
                        <div v-if="tacosResult.errors && tacosResult.errors.length" class="result-errors">
                            <h4>部分错误:</h4>
                            <ul>
                                <li v-for="(err, i) in tacosResult.errors.slice(0, 10)" :key="i">{{ err }}</li>
                            </ul>
                        </div>
                        <router-link to="/dashboard" class="btn-secondary">查看产品看板</router-link>
                    </template>
                </div>
            </div>`
};
