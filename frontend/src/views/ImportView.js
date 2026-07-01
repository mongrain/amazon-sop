import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

export default {
    name: 'ImportView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const importPath = ref('');
        const productListPath = ref('');
        const tacosPath = ref('');
        const inventoryPath = ref('');
        const asinUpdatePath = ref('');
        const result = ref(null);
        const productListResult = ref(null);
        const tacosResult = ref(null);
        const inventoryResult = ref(null);
        const asinUpdateResult = ref(null);
        const importing = ref(false);
        const importingProductList = ref(false);
        const importingTacos = ref(false);
        const importingInventory = ref(false);
        const importingAsinUpdate = ref(false);
        const error = ref('');
        const productListError = ref('');
        const tacosError = ref('');
        const inventoryError = ref('');
        const asinUpdateError = ref('');

        onMounted(async () => {
            try {
                const [sopRes, productListRes, tacosRes, inventoryRes, asinUpdateRes] = await Promise.all([
                    http.get('/api/import'),
                    http.get('/api/import/product-list'),
                    http.get('/api/import/tacos'),
                    http.get('/api/import/inventory-report'),
                    http.get('/api/import/asin-update')
                ]);
                importPath.value = sopRes.data.import_path || '';
                productListPath.value = productListRes.data.import_path || '';
                tacosPath.value = tacosRes.data.import_path || '';
                inventoryPath.value = inventoryRes.data.import_path || '';
                asinUpdatePath.value = asinUpdateRes.data.import_path || '';
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

        async function startProductListImport() {
            productListError.value = '';
            importingProductList.value = true;
            productListResult.value = null;
            try {
                const { data } = await http.post('/api/import/product-list');
                productListResult.value = data.result || data;
            } catch (e) {
                productListError.value = getApiError(e, '导入失败');
            } finally {
                importingProductList.value = false;
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

        async function startInventoryImport() {
            inventoryError.value = '';
            importingInventory.value = true;
            inventoryResult.value = null;
            try {
                const { data } = await http.post('/api/import/inventory-report');
                inventoryResult.value = data.result || data;
            } catch (e) {
                inventoryError.value = getApiError(e, '导入失败');
            } finally {
                importingInventory.value = false;
            }
        }

        async function startAsinUpdateImport() {
            asinUpdateError.value = '';
            importingAsinUpdate.value = true;
            asinUpdateResult.value = null;
            try {
                const { data } = await http.post('/api/import/asin-update');
                asinUpdateResult.value = data.result || data;
            } catch (e) {
                asinUpdateError.value = getApiError(e, '导入失败');
            } finally {
                importingAsinUpdate.value = false;
            }
        }

        return {
            importPath, productListPath, tacosPath, inventoryPath, asinUpdatePath,
            result, productListResult, tacosResult, inventoryResult, asinUpdateResult,
            importing, importingProductList, importingTacos, importingInventory, importingAsinUpdate,
            error, productListError, tacosError, inventoryError, asinUpdateError,
            startImport, startProductListImport, startTacosImport, startInventoryImport, startAsinUpdateImport
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
                    <h2>从产品清单导入</h2>
                    <p class="import-desc">
                        系统将读取 <code>public/产品清单.xlsx</code> 中的站点与产品名称，<br>
                        更新或新建产品库记录。若 ASIN 重复，以表格中<strong>最后一行</strong>为准。
                    </p>
                    <p v-if="productListPath" class="import-note">
                        Excel文件路径: <code>{{ productListPath }}</code>
                    </p>
                    <button type="button" class="btn-primary btn-large" @click="startProductListImport" :disabled="importingProductList">
                        {{ importingProductList ? '导入中…' : '导入产品清单' }}
                    </button>
                </div>

                <div v-if="productListError" class="import-result error">
                    <h3>产品清单导入失败</h3>
                    <p>{{ productListError }}</p>
                </div>
                <div v-if="productListResult" class="import-result" :class="productListResult.error ? 'error' : 'success'">
                    <template v-if="productListResult.error">
                        <h3>产品清单导入失败</h3>
                        <p>{{ productListResult.error }}</p>
                    </template>
                    <template v-else>
                        <h3>产品清单导入完成</h3>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="result-number">{{ productListResult.products_updated }}</span>
                                <span class="result-label">产品更新</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ productListResult.products_created }}</span>
                                <span class="result-label">新建产品</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ productListResult.products_unchanged }}</span>
                                <span class="result-label">无变化</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ productListResult.unique_asin }}</span>
                                <span class="result-label">唯一 ASIN</span>
                            </div>
                        </div>
                        <p v-if="productListResult.total_rows > productListResult.unique_asin" class="import-note" style="margin-top:12px;">
                            共 {{ productListResult.total_rows }} 行数据，{{ productListResult.total_rows - productListResult.unique_asin }} 行重复 ASIN 已按最后一行覆盖
                        </p>
                        <div v-if="productListResult.errors && productListResult.errors.length" class="result-errors">
                            <h4>部分错误:</h4>
                            <ul>
                                <li v-for="(err, i) in productListResult.errors.slice(0, 10)" :key="i">{{ err }}</li>
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

                <div class="import-card" style="margin-top:24px;">
                    <h2>从商品库存报告导入</h2>
                    <p class="import-desc">
                        系统将读取 <code>public/商品库存报告.txt</code>（Amazon 库存报告 TSV），<br>
                        按 <code>open-date</code> 更新产品库中的<strong>上架日期</strong>；不存在的产品将自动新建。
                    </p>
                    <p v-if="inventoryPath" class="import-note">
                        文件路径: <code>{{ inventoryPath }}</code>
                    </p>
                    <button type="button" class="btn-primary btn-large" @click="startInventoryImport" :disabled="importingInventory">
                        {{ importingInventory ? '导入中…' : '导入库存报告' }}
                    </button>
                </div>

                <div v-if="inventoryError" class="import-result error">
                    <h3>库存报告导入失败</h3>
                    <p>{{ inventoryError }}</p>
                </div>
                <div v-if="inventoryResult" class="import-result" :class="inventoryResult.error ? 'error' : 'success'">
                    <template v-if="inventoryResult.error">
                        <h3>库存报告导入失败</h3>
                        <p>{{ inventoryResult.error }}</p>
                    </template>
                    <template v-else>
                        <h3>库存报告导入完成</h3>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="result-number">{{ inventoryResult.listed_at_updated }}</span>
                                <span class="result-label">上架日期更新</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ inventoryResult.products_created }}</span>
                                <span class="result-label">新建产品</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ inventoryResult.products_updated }}</span>
                                <span class="result-label">产品更新</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ inventoryResult.status_set_abandoned || 0 }}</span>
                                <span class="result-label">标记已放弃</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ inventoryResult.unique_asin }}</span>
                                <span class="result-label">唯一 ASIN</span>
                            </div>
                        </div>
                        <p v-if="inventoryResult.skipped_no_date" class="import-note" style="margin-top:12px;">
                            {{ inventoryResult.skipped_no_date }} 个 ASIN 因无法解析 open-date 已跳过
                        </p>
                        <div v-if="inventoryResult.errors && inventoryResult.errors.length" class="result-errors">
                            <h4>部分错误:</h4>
                            <ul>
                                <li v-for="(err, i) in inventoryResult.errors.slice(0, 10)" :key="i">{{ err }}</li>
                            </ul>
                        </div>
                        <router-link to="/dashboard" class="btn-secondary">查看产品看板</router-link>
                    </template>
                </div>

                <div class="import-card" style="margin-top:24px;">
                    <h2>从 ASIN 上架时间表导入</h2>
                    <p class="import-desc">
                        系统将读取 <code>public/asin更新.xlsx</code> 中的 ASIN 与上架时间，<br>
                        更新产品库中已有产品的<strong>上架日期</strong>。若 ASIN 重复，以表格中<strong>最后一行</strong>为准；上架时间为空则跳过。
                    </p>
                    <p v-if="asinUpdatePath" class="import-note">
                        Excel文件路径: <code>{{ asinUpdatePath }}</code>
                    </p>
                    <button type="button" class="btn-primary btn-large" @click="startAsinUpdateImport" :disabled="importingAsinUpdate">
                        {{ importingAsinUpdate ? '导入中…' : '导入上架日期' }}
                    </button>
                </div>

                <div v-if="asinUpdateError" class="import-result error">
                    <h3>上架日期导入失败</h3>
                    <p>{{ asinUpdateError }}</p>
                </div>
                <div v-if="asinUpdateResult" class="import-result" :class="asinUpdateResult.error ? 'error' : 'success'">
                    <template v-if="asinUpdateResult.error">
                        <h3>上架日期导入失败</h3>
                        <p>{{ asinUpdateResult.error }}</p>
                    </template>
                    <template v-else>
                        <h3>上架日期导入完成</h3>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="result-number">{{ asinUpdateResult.listed_at_updated }}</span>
                                <span class="result-label">上架日期更新</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ asinUpdateResult.products_not_found }}</span>
                                <span class="result-label">ASIN 未找到</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ asinUpdateResult.skipped_no_date }}</span>
                                <span class="result-label">无日期跳过</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ asinUpdateResult.products_unchanged }}</span>
                                <span class="result-label">无变化</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-number">{{ asinUpdateResult.unique_asin }}</span>
                                <span class="result-label">唯一 ASIN</span>
                            </div>
                        </div>
                        <div v-if="asinUpdateResult.errors && asinUpdateResult.errors.length" class="result-errors">
                            <h4>部分错误:</h4>
                            <ul>
                                <li v-for="(err, i) in asinUpdateResult.errors.slice(0, 10)" :key="i">{{ err }}</li>
                            </ul>
                        </div>
                        <router-link to="/dashboard" class="btn-secondary">查看产品看板</router-link>
                    </template>
                </div>
            </div>`
};
