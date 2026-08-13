import { onMounted, ref, watch } from 'vue';
import { getApiError, http } from '@/utils/index.js';

const METRIC_KEYS = ['sessions', 'orders', 'impressions', 'clicks', 'ad_spend', 'ad_sales', 'total_sales', 'ad_orders', 'core_kw_rank', 'bsr_rank'];
const PULL_KEYS = ['sessions', 'orders', 'impressions', 'clicks', 'ad_spend', 'ad_sales', 'total_sales', 'ad_orders', 'bsr_rank'];

function emptyRow(prefillId, asin) {
    return { id: prefillId || '-', asin: asin || '', sessions: '', orders: '', impressions: '', clicks: '', ad_spend: '', ad_sales: '', total_sales: '', ad_orders: '', core_kw_rank: '', bsr_rank: '' };
}

function rowFromApi(r) {
    const row = emptyRow(r.id, r.asin);
    for (const k of METRIC_KEYS) {
        if (r[k] != null && r[k] !== '') row[k] = r[k];
    }
    return row;
}

function rowHasPulledMetric(row) {
    return PULL_KEYS.some((k) => String(row[k] ?? '').trim() !== '');
}

function mergePrefill(rows, prefillRows) {
    const byAsin = new Map();
    for (const item of prefillRows || []) {
        const key = String(item.asin || '').trim().toUpperCase();
        if (key) byAsin.set(key, item);
    }
    return rows.map((row) => {
        if (rowHasPulledMetric(row)) return row;
        const prefill = byAsin.get(String(row.asin || '').trim().toUpperCase());
        if (!prefill) return row;
        const next = { ...row };
        for (const k of PULL_KEYS) {
            if (prefill[k] != null && prefill[k] !== '') next[k] = prefill[k];
        }
        return next;
    });
}

function parseNum(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
export default {
    name: 'MetricsManualView',
    setup() {
        const recordDate = ref('');
        const rows = ref([emptyRow()]);
        const submitMsg = ref('');
        const resultText = ref('');
        const submitting = ref(false);
        const pulling = ref(false);
        const dateReady = ref(false);

        async function loadData(date) {
            try {
                const params = date ? { date } : {};
                const { data } = await http.get('/api/metrics/manual', { params });
                recordDate.value = data.current_date || date || '';
                const apiRows = data.rows || [];
                rows.value = apiRows.length ? apiRows.map(rowFromApi) : [emptyRow()];
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            }
        }

        async function pullLingxing() {
            if (!recordDate.value) return alert('请选择日期');
            pulling.value = true;
            try {
                const { data } = await http.post('/api/metrics/manual/lingxing-prefill', { date: recordDate.value });
                rows.value = mergePrefill(rows.value, data.rows || []);
                submitMsg.value = `已预填 ${data.filled || 0} 行，跳过已录入 ${data.skipped_existing || 0} 行，领星无数据 ${data.missing_in_lingxing || 0} 行`;
            } catch (e) {
                alert(getApiError(e, '领星拉取失败'));
            } finally {
                pulling.value = false;
            }
        }

        function addRow() {
            rows.value.push(emptyRow());
        }

        function removeRow(idx) {
            if (rows.value.length <= 1) return;
            rows.value.splice(idx, 1);
        }

        async function submitMetrics() {
            if (!recordDate.value) return alert('请选择日期');
            const payloadRows = [];
            for (const row of rows.value) {
                const obj = { asin: String(row.asin || '').trim() };
                if (!obj.asin) continue;
                for (const k of METRIC_KEYS) {
                    if (k === 'asin') continue;
                    if (['ad_spend', 'ad_sales', 'total_sales'].includes(k)) {
                        const n = parseNum(row[k]);
                        if (n !== null) obj[k] = n;
                    } else {
                        const n = parseNum(row[k]);
                        if (n !== null) obj[k] = Math.trunc(n);
                    }
                }
                payloadRows.push(obj);
            }
            if (payloadRows.length === 0) return alert('请至少填写一行 ASIN');

            submitting.value = true;
            submitMsg.value = '提交中...';
            resultText.value = '';
            try {
                const { data } = await http.post('/api/v1/metrics/upload', {
                    source: 'MANUAL',
                    date: recordDate.value,
                    data: payloadRows
                });
                submitMsg.value = '提交成功';
                resultText.value = JSON.stringify(data, null, 2);
            } catch (e) {
                submitMsg.value = '提交失败';
                resultText.value = getApiError(e, '提交失败');
            } finally {
                submitting.value = false;
            }
        }

        watch(recordDate, (d) => {
            if (!dateReady.value || !d) return;
            loadData(d);
        });

        onMounted(async () => {
            await loadData();
            dateReady.value = true;
        });

        return { recordDate, rows, submitMsg, resultText, submitting, pulling, addRow, removeRow, submitMetrics, pullLingxing };
    },
    template: `<div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <h1>每日数据填报</h1>
                        <div class="page-desc">提交后会触发规则诊断</div>
                    </div>
                </div>
            </div>

            <div class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">填报日期</div></div>
                <div class="module-body">
                    <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                        <input v-model="recordDate" class="search-input" type="date">
                        <button class="btn-primary" type="button" :disabled="submitting || pulling" @click="submitMetrics">提交</button>
                        <button class="btn-secondary" type="button" :disabled="submitting || pulling" @click="pullLingxing">{{ pulling ? '拉取中...' : '从领星拉取' }}</button>
                        <button class="btn-secondary" type="button" @click="addRow">+ 添加行</button>
                        <span style="font-size:13px; color:#606266;">{{ submitMsg }}</span>
                    </div>
                    <div style="font-size:12px; color:#909399; margin-top:8px;">
                        支持字段：访客数(sessions) / 订单数(orders) / 曝光(impressions) / 点击(clicks) / 广告花费(ad_spend) / 广告销售额(ad_sales) / 总销售额(total_sales) / 广告订单数(ad_orders) / BSR排名(bsr_rank)
                    </div>
                </div>
            </div>

            <div class="table-container" style="max-height:none;">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:50px">ID</th>
                            <th style="min-width:120px">ASIN *</th>
                            <th style="min-width:90px" title="sessions">访客数</th>
                            <th style="min-width:80px" title="orders">订单数</th>
                            <th style="min-width:110px" title="impressions">曝光</th>
                            <th style="min-width:90px" title="clicks">点击</th>
                            <th style="min-width:110px" title="ad_spend">广告花费</th>
                            <th style="min-width:110px" title="ad_sales">广告销售额</th>
                            <th style="min-width:110px" title="total_sales">总销售额</th>
                            <th style="min-width:100px" title="ad_orders">广告订单数</th>
                            <th style="min-width:90px" title="bsr_rank">BSR排名</th>
                            <th style="min-width:90px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(row, idx) in rows" :key="idx">
                            <td>{{ row.id }}</td>
                            <td><input v-model="row.asin" class="search-input" style="width:140px"></td>
                            <td><input v-model="row.sessions" class="search-input" style="width:90px"></td>
                            <td><input v-model="row.orders" class="search-input" style="width:80px"></td>
                            <td><input v-model="row.impressions" class="search-input" style="width:110px"></td>
                            <td><input v-model="row.clicks" class="search-input" style="width:90px"></td>
                            <td><input v-model="row.ad_spend" class="search-input" style="width:110px"></td>
                            <td><input v-model="row.ad_sales" class="search-input" style="width:110px"></td>
                            <td><input v-model="row.total_sales" class="search-input" style="width:110px"></td>
                            <td><input v-model="row.ad_orders" class="search-input" style="width:100px"></td>
                            <td><input v-model="row.bsr_rank" class="search-input" style="width:90px"></td>
                            <td><button class="btn-icon" type="button" @click="removeRow(idx)">删</button></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="module-card" style="margin-top:16px;">
                <div class="module-header" style="cursor:default;"><div class="module-name">本次提交反馈</div></div>
                <div class="module-body">
                    <pre style="white-space:pre-wrap; font-size:13px; color:#303133; background:#f5f7fa; border:1px solid #e4e7ed; padding:12px 14px; border-radius:8px; min-height:60px;">{{ resultText }}</pre>
                </div>
            </div>`
};
