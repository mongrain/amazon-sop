import { computed, ref, watch } from 'vue';
import { getApiError, http } from '@/utils/index.js';

function fmtMoney(v, prefix = '$') {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return '—';
    return prefix + Number(v).toFixed(2);
}

function fmtPct(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return (Number(v) * 100).toFixed(2) + '%';
}

function fmtNum(v, digits = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(digits);
}

export default {
    name: 'ProductEconomicsPanel',
    props: {
        asin: { type: String, required: true },
        economics: { type: Object, default: null }
    },
    emits: ['updated'],
    setup(props, { emit }) {
        const saving = ref(false);
        const saveError = ref('');
        let saveTimer = null;

        const inputs = computed(() => (props.economics && props.economics.inputs) || {});
        const computedVals = computed(() => (props.economics && props.economics.computed) || {});
        const exchange = computed(() => (props.economics && props.economics.exchangeRate) || {});

        function displayVal(key, manualKey, usedKey, autoKey) {
            if (inputs.value[manualKey] && inputs.value[key] != null) return inputs.value[key];
            return computedVals.value[usedKey] ?? computedVals.value[autoKey] ?? inputs.value[key];
        }

        async function patchEconomics(payload) {
            saving.value = true;
            saveError.value = '';
            try {
                const { data } = await http.patch(
                    '/api/product/' + encodeURIComponent(props.asin) + '/economics',
                    payload
                );
                emit('updated', data.economics);
            } catch (e) {
                saveError.value = getApiError(e, '保存失败');
            } finally {
                saving.value = false;
            }
        }

        function scheduleSave(payload) {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => patchEconomics(payload), 400);
        }

        function onFieldInput(field, event, manualField) {
            const raw = event.target.value;
            const val = raw === '' ? null : Number(raw);
            const payload = { [field]: Number.isFinite(val) ? val : null };
            if (manualField) payload[manualField] = true;
            scheduleSave(payload);
        }

        function onIntInput(field, event) {
            const val = parseInt(event.target.value, 10);
            scheduleSave({ [field]: Number.isFinite(val) ? Math.max(1, val) : 1 });
        }

        function onFieldBlur(field, event, manualField) {
            const raw = event.target.value;
            const val = raw === '' ? null : Number(raw);
            const payload = { [field]: Number.isFinite(val) ? val : null };
            if (manualField) payload[manualField] = true;
            patchEconomics(payload);
        }

        function onIntBlur(field, event) {
            const val = parseInt(event.target.value, 10);
            patchEconomics({ [field]: Number.isFinite(val) ? Math.max(1, val) : 1 });
        }

        function resetAuto(field, manualField) {
            patchEconomics({ [field]: null, [manualField]: false });
        }

        watch(() => props.asin, () => {
            if (saveTimer) clearTimeout(saveTimer);
            saveError.value = '';
        });

        return {
            saving, saveError, inputs, computedVals, exchange,
            displayVal, onFieldInput, onFieldBlur, onIntInput, onIntBlur, resetAuto,
            fmtMoney, fmtPct, fmtNum
        };
    },
    template: `<div class="module-card product-economics-card">
        <div class="product-economics-header">
            <h2 class="product-economics-title">利润看盘</h2>
            <span v-if="saving" class="product-economics-status">保存中…</span>
            <span v-else-if="saveError" class="product-economics-status product-economics-error">{{ saveError }}</span>
            <span v-else class="product-economics-status">汇率 1 USD = {{ fmtNum(exchange.rate, 4) }} CNY
                <template v-if="exchange.fetched_at">（{{ exchange.fetched_at }}）</template>
            </span>
        </div>
        <div class="product-economics-body">
            <div class="product-economics-grid">
                <div class="product-economics-section">
                    <div class="product-economics-section-title">尺寸与重量</div>
                    <div class="product-economics-fields">
                        <label class="product-economics-field">
                            <span>长 (cm)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.length_cm ?? ''" @input="onFieldInput('length_cm', $event)">
                        </label>
                        <label class="product-economics-field">
                            <span>宽 (cm)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.width_cm ?? ''" @input="onFieldInput('width_cm', $event)">
                        </label>
                        <label class="product-economics-field">
                            <span>高 (cm)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.height_cm ?? ''" @input="onFieldInput('height_cm', $event)">
                        </label>
                        <label class="product-economics-field">
                            <span>毛重 (kg)</span>
                            <input type="number" step="0.001" min="0" :value="inputs.gross_weight_kg ?? ''" @input="onFieldInput('gross_weight_kg', $event)">
                        </label>
                        <label class="product-economics-field">
                            <span>箱装数</span>
                            <input type="number" step="1" min="1" :value="inputs.units_per_box ?? 1" @input="onIntInput('units_per_box', $event)">
                        </label>
                    </div>
                    <div v-if="computedVals.fba" class="product-economics-fba">
                        <div>FBA 分段：{{ computedVals.fba.size_tier || '—' }}</div>
                        <div>计费重量：{{ computedVals.fba.final_billable_weight_lb || '—' }} lb</div>
                        <div>尾程费（自动）：{{ fmtMoney(computedVals.last_mile_usd) }}</div>
                    </div>
                </div>

                <div class="product-economics-section">
                    <div class="product-economics-section-title">成本与费用</div>
                    <div class="product-economics-fields">
                        <label class="product-economics-field">
                            <span>卖价 ($)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.selling_price_usd ?? ''" @blur="onFieldBlur('selling_price_usd', $event)">
                        </label>
                        <label class="product-economics-field">
                            <span>进价 (RMB)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.cost_price_rmb ?? ''" @blur="onFieldBlur('cost_price_rmb', $event)">
                        </label>
                        <div class="product-economics-readonly">
                            <span>进价 (USD)</span>
                            <strong>{{ fmtMoney(computedVals.cost_price_usd) }}</strong>
                        </div>
                        <label class="product-economics-field product-economics-field-with-reset">
                            <span>头程 ($)</span>
                            <input type="number" step="0.0001" min="0"
                                :value="displayVal('first_leg_usd', 'first_leg_manual', 'first_leg_used', 'first_leg_auto') ?? ''"
                                @blur="onFieldBlur('first_leg_usd', $event, 'first_leg_manual')">
                            <button v-if="inputs.first_leg_manual" type="button" class="btn-link-reset" @click="resetAuto('first_leg_usd', 'first_leg_manual')">恢复自动</button>
                        </label>
                        <label class="product-economics-field">
                            <span>税 ($)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.tax_usd ?? 0" @blur="onFieldBlur('tax_usd', $event)">
                        </label>
                        <label class="product-economics-field">
                            <span>杂费 ($)</span>
                            <input type="number" step="0.01" min="0" :value="inputs.misc_fee_usd ?? ''" @blur="onFieldBlur('misc_fee_usd', $event)">
                        </label>
                        <label class="product-economics-field product-economics-field-with-reset">
                            <span>广告支出 ($)</span>
                            <input type="number" step="0.0001" min="0"
                                :value="displayVal('ad_spend_usd', 'ad_spend_manual', 'ad_spend_used', 'ad_spend_auto') ?? ''"
                                @blur="onFieldBlur('ad_spend_usd', $event, 'ad_spend_manual')">
                            <button v-if="inputs.ad_spend_manual" type="button" class="btn-link-reset" @click="resetAuto('ad_spend_usd', 'ad_spend_manual')">恢复自动</button>
                        </label>
                        <label class="product-economics-field product-economics-field-with-reset">
                            <span>尾程+Fee ($)</span>
                            <input type="number" step="0.0001" min="0"
                                :value="displayVal('last_mile_fee_usd', 'last_mile_fee_manual', 'last_mile_fee_used', 'last_mile_fee_auto') ?? ''"
                                @blur="onFieldBlur('last_mile_fee_usd', $event, 'last_mile_fee_manual')">
                            <button v-if="inputs.last_mile_fee_manual" type="button" class="btn-link-reset" @click="resetAuto('last_mile_fee_usd', 'last_mile_fee_manual')">恢复自动</button>
                        </label>
                        <div class="product-economics-readonly product-economics-hint">
                            <span>Fee (15%)</span>
                            <strong>{{ fmtMoney(computedVals.fee_usd) }}</strong>
                        </div>
                        <label class="product-economics-field">
                            <span>订单速度</span>
                            <input type="number" step="0.01" min="0" :value="inputs.order_velocity ?? ''" @blur="onFieldBlur('order_velocity', $event)">
                        </label>
                    </div>
                </div>

                <div class="product-economics-section product-economics-summary">
                    <div class="product-economics-section-title">利润汇总</div>
                    <div class="product-economics-summary-grid">
                        <div class="product-economics-summary-item">
                            <span>利润 USD</span>
                            <strong :class="{ 'text-success': computedVals.profit_usd > 0, 'text-danger': computedVals.profit_usd < 0 }">{{ fmtMoney(computedVals.profit_usd) }}</strong>
                        </div>
                        <div class="product-economics-summary-item">
                            <span>利润 RMB</span>
                            <strong>{{ fmtMoney(computedVals.profit_rmb, '¥') }}</strong>
                        </div>
                        <div class="product-economics-summary-item">
                            <span>利润率</span>
                            <strong>{{ fmtPct(computedVals.profit_margin) }}</strong>
                        </div>
                        <div class="product-economics-summary-item">
                            <span>总利润 RMB</span>
                            <strong>{{ fmtMoney(computedVals.total_profit_rmb, '¥') }}</strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`
};
