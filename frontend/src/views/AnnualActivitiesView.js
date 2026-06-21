import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, getMarkdownIt, http } from '@/utils/index.js';
import DOMPurify from 'dompurify';
import { hljs } from '@/utils/markdown.js';
import { openViewer } from '@/utils/viewer.js';

function getInitialYear(route) {
    const y = parseInt(route.query.year);
    if (Number.isFinite(y)) return Math.min(2100, Math.max(2000, y));
    return new Date().getFullYear();
}

export default {
    name: 'AnnualActivitiesView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const year = ref(getInitialYear(route));
        const yearInput = ref(getInitialYear(route));
        const loading = ref(true);
        const isEditMode = ref(false);
        const saved = ref(String(route.query.saved || '') === '1');
        const syncedFromYear = ref(parseInt(route.query.synced_from) || null);
        const submitting = ref(false);
        const months = ref([]);
        const previewRefs = ref({});
        const syncModalOpen = ref(false);
        const fromYear = ref(year.value - 1);
        const syncError = ref('');

        function escapeHtml(text) {
            return String(text || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function applyBodyMode(edit) {
            document.body.classList.remove('mode-preview', 'mode-edit');
            document.body.classList.add(edit ? 'mode-edit' : 'mode-preview');
        }

        function renderMarkdownToEl(el, md) {
            if (!el) return;
            const mdIt = getMarkdownIt();
            const html = mdIt ? mdIt.render(md || '') : `<pre style="white-space:pre-wrap;">${escapeHtml(md)}</pre>`;
            const safe = DOMPurify ? DOMPurify.sanitize(html) : html;
            const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
            const contentHtml = safe || '<span style="color:#909399;">-</span>';
            shadow.innerHTML = `
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.6.1/github-markdown.min.css">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github.min.css">
                <style>
                    :host { display: block; }
                    .markdown-body { padding: 12px 14px; font-size: 13px; line-height: 1.7; }
                    .markdown-body img { max-width: 100%; border-radius: 8px; }
                </style>
                <div class="markdown-body">${contentHtml}</div>
            `;
            if (hljs) {
                shadow.querySelectorAll('pre code').forEach(el => {
                    try { hljs.highlightElement(el); } catch (e) {}
                });
            }
            shadow.querySelectorAll('img').forEach(img => {
                img.classList.add('zoomable');
                img.addEventListener('click', e => {
                    e.preventDefault();
                    if (typeof openViewer === 'function') openViewer(img.src);
                });
            });
        }

        function renderAllMarkdown() {
            nextTick(() => {
                months.value.forEach(m => {
                    const el = previewRefs.value[m.month];
                    if (el) renderMarkdownToEl(el, m.action_plan);
                });
            });
        }

        function setPreviewRef(month, el) {
            if (el) {
                previewRefs.value[month] = el;
                if (!isEditMode.value) {
                    const item = months.value.find(x => x.month === month);
                    if (item) renderMarkdownToEl(el, item.action_plan);
                }
            } else {
                delete previewRefs.value[month];
            }
        }

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/annual-activities', { params: { year: year.value } });
                year.value = data.year || year.value;
                yearInput.value = year.value;
                const map = data.activitiesMap || {};
                months.value = [];
                for (let m = 1; m <= 12; m++) {
                    const row = map[m] || {};
                    months.value.push({
                        month: m,
                        activity_title: row.activity_title || '',
                        action_plan: row.action_plan || ''
                    });
                }
                renderAllMarkdown();
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
            }
        }

        function switchYear() {
            const y = Math.min(2100, Math.max(2000, parseInt(yearInput.value) || year.value));
            saved.value = false;
            syncedFromYear.value = null;
            exitPreviewMode();
            router.push('/annual-activities?year=' + encodeURIComponent(String(y)));
        }

        function enterEditMode() {
            isEditMode.value = true;
            applyBodyMode(true);
        }
        function exitPreviewMode() {
            isEditMode.value = false;
            applyBodyMode(false);
            renderAllMarkdown();
        }
        function cancelEditMode() {
            exitPreviewMode();
            loadData();
        }

        async function saveForm() {
            if (submitting.value) return;
            submitting.value = true;
            const payload = { year: year.value };
            months.value.forEach(m => {
                payload['title_' + m.month] = m.activity_title;
                payload['plan_' + m.month] = m.action_plan;
            });
            try {
                await http.post('/api/annual-activities/save', payload);
                saved.value = true;
                syncedFromYear.value = null;
                exitPreviewMode();
                await router.push('/annual-activities?year=' + encodeURIComponent(String(year.value)) + '&saved=1');
                await loadData();
            } catch (e) {
                alert(getApiError(e, '保存失败'));
                submitting.value = false;
            }
        }

        function openSyncModal() {
            syncError.value = '';
            fromYear.value = year.value - 1;
            syncModalOpen.value = true;
        }
        function closeSyncModal() {
            syncModalOpen.value = false;
        }
        async function confirmSync() {
            const fy = String(fromYear.value).trim();
            if (!fy) {
                syncError.value = '源年份为必填项';
                return;
            }
            if (!confirm('确认同步？目标年份 1-12 月内容将被覆盖。')) return;
            try {
                await http.post('/api/annual-activities/sync', { from_year: fy, to_year: year.value });
                saved.value = true;
                syncedFromYear.value = parseInt(fy, 10) || null;
                exitPreviewMode();
                await router.push('/annual-activities?year=' + encodeURIComponent(String(year.value)) + '&saved=1&synced_from=' + encodeURIComponent(fy));
                await loadData();
            } catch (e) {
                syncError.value = getApiError(e, '同步失败');
            }
        }

        async function uploadAnnualImage(file) {
            const form = new FormData();
            form.append('image', file, file.name || 'paste.png');
            const { data } = await http.post('/api/annual-activities/image', form);
            if (!data || !data.url) throw new Error('上传成功但未返回图片地址');
            return data.url;
        }

        function insertAtCursor(textarea, text) {
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const value = textarea.value || '';
            const newVal = value.slice(0, start) + text + value.slice(end);
            const month = parseInt(textarea.dataset.month, 10);
            const item = months.value.find(x => x.month === month);
            if (item) item.action_plan = newVal;
            nextTick(() => {
                textarea.selectionStart = start + text.length;
                textarea.selectionEnd = start + text.length;
            });
        }

        function normalizeTableCellText(text) {
            return String(text || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
        }
        function matrixToMarkdownTable(matrix) {
            if (!matrix.length) return '';
            const colCount = Math.max(...matrix.map(row => row.length));
            if (!colCount) return '';
            const normalized = matrix.map(row => {
                const cells = row.slice();
                while (cells.length < colCount) cells.push('');
                return cells.map(normalizeTableCellText);
            });
            const lines = normalized.map(row => '| ' + row.join(' | ') + ' |');
            const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
            lines.splice(1, 0, separator);
            return lines.join('\n');
        }
        function tableElementToMarkdown(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            if (!rows.length) return '';
            const matrix = rows.map(tr => Array.from(tr.querySelectorAll('th, td')).map(cell => cell.textContent || ''));
            return matrixToMarkdownTable(matrix);
        }
        function htmlTablesToMarkdown(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const tables = Array.from(doc.body.querySelectorAll('table'));
            if (!tables.length) return null;
            const topTables = tables.filter(table => {
                let parent = table.parentElement;
                while (parent && parent !== doc.body) {
                    if (parent.tagName === 'TABLE') return false;
                    parent = parent.parentElement;
                }
                return true;
            });
            const parts = topTables.map(tableElementToMarkdown).filter(Boolean);
            return parts.length ? parts.join('\n\n') : null;
        }
        function tsvToMarkdown(text) {
            const lines = String(text || '').trim().split(/\r?\n/).filter(line => line.includes('\t'));
            if (lines.length < 2) return null;
            const matrix = lines.map(line => line.split('\t'));
            const colCount = matrix[0].length;
            if (colCount < 2 || !matrix.every(row => row.length === colCount)) return null;
            return matrixToMarkdownTable(matrix);
        }

        async function onPaste(e) {
            if (!isEditMode.value) return;
            const active = document.activeElement;
            if (!active || !(active instanceof HTMLTextAreaElement)) return;
            if (!active.classList.contains('annual-textarea')) return;
            const clipboard = e.clipboardData;
            if (!clipboard) return;
            const items = clipboard.items ? Array.from(clipboard.items) : [];
            const imageItem = items.find(it => it && typeof it.type === 'string' && it.type.startsWith('image/'));
            if (imageItem) {
                e.preventDefault();
                const file = imageItem.getAsFile();
                if (!file) return;
                const prevCursor = document.body.style.cursor;
                document.body.style.cursor = 'progress';
                try {
                    const url = await uploadAnnualImage(file);
                    insertAtCursor(active, `\n![](${url})\n`);
                } catch (err) {
                    alert(err && err.message ? err.message : '图片上传失败');
                } finally {
                    document.body.style.cursor = prevCursor;
                }
                return;
            }
            const html = clipboard.getData('text/html');
            if (html && /<table[\s>]/i.test(html)) {
                const md = htmlTablesToMarkdown(html);
                if (md) {
                    e.preventDefault();
                    insertAtCursor(active, '\n' + md + '\n');
                    return;
                }
            }
            const plain = clipboard.getData('text/plain');
            if (plain && plain.includes('\t')) {
                const md = tsvToMarkdown(plain);
                if (md) {
                    e.preventDefault();
                    insertAtCursor(active, '\n' + md + '\n');
                }
            }
        }

        function onKeydown(e) {
            if (e.key === 'Escape') syncModalOpen.value = false;
        }

        watch(
            () => route.query.year,
            (nextYear) => {
                if (nextYear === undefined || nextYear === null || nextYear === '') return;
                const y = getInitialYear(route);
                if (y === year.value && !loading.value) return;
                year.value = y;
                yearInput.value = y;
                saved.value = String(route.query.saved || '') === '1';
                syncedFromYear.value = parseInt(route.query.synced_from) || null;
                if (isEditMode.value) {
                    isEditMode.value = false;
                    applyBodyMode(false);
                }
                loadData();
            }
        );

        onMounted(() => {
            applyBodyMode(false);
            loadData();
            document.addEventListener('paste', onPaste);
            document.addEventListener('keydown', onKeydown);
        });
        onUnmounted(() => {
            document.body.classList.remove('mode-preview', 'mode-edit');
            document.removeEventListener('paste', onPaste);
            document.removeEventListener('keydown', onKeydown);
        });

        return {
            year, yearInput, loading, isEditMode, saved, syncedFromYear, submitting, months,
            syncModalOpen, fromYear, syncError,
            switchYear, enterEditMode, cancelEditMode, saveForm,
            openSyncModal, closeSyncModal, confirmSync, setPreviewRef
        };
    },
    template: `<div v-if="loading" style="text-align:center; padding:40px; color:#999;">加载中...</div>
        <template v-else>
            <div class="page-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div>
                        <h1>年度活动</h1>
                        <div class="page-desc">按月维护主要活动与开展要点（1月 → 12月）</div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <div style="display:flex; gap:8px; align-items:center;">
                            <span style="color:var(--text-secondary); font-size:13px;">年份</span>
                            <input class="search-input" style="width:120px;" type="number" v-model.number="yearInput" min="2000" max="2100">
                            <button class="btn-secondary" type="button" @click="switchYear">切换</button>
                        </div>
                        <button class="btn-secondary annual-preview" type="button" @click="openSyncModal">同步</button>
                        <button class="btn-secondary annual-preview" type="button" @click="enterEditMode">编辑</button>
                        <button class="btn-secondary annual-edit" type="button" @click="cancelEditMode">取消</button>
                        <button class="btn-primary annual-edit" type="button" :disabled="submitting" @click="saveForm">保存</button>
                    </div>
                </div>
                <div v-if="saved" style="margin-top:12px; padding:10px 12px; background:#f0f9eb; border:1px solid #e1f3d8; border-radius:8px; color:var(--success); font-size:13px;">
                    <template v-if="syncedFromYear">已从 {{ syncedFromYear }} 年同步并保存</template>
                    <template v-else>已保存</template>
                </div>
            </div>
            <div class="annual-timeline">
                <div v-for="m in months" :key="m.month" class="annual-item">
                    <div class="annual-marker">
                        <div class="annual-dot"></div>
                        <div class="annual-month">{{ m.month }}月</div>
                    </div>
                    <div class="annual-card">
                        <div class="annual-card-row">
                            <div class="annual-label">主要活动</div>
                            <div>
                                <div class="annual-preview annual-title-view">{{ m.activity_title || '-' }}</div>
                                <input :id="'title_' + m.month" v-model="m.activity_title" class="annual-edit annual-input" type="text" maxlength="500" :placeholder="'例如：Prime Day 备战 / 返校季 / 黑五网一预热'">
                            </div>
                        </div>
                        <div class="annual-card-row">
                            <div class="annual-label">开展时需要做什么</div>
                            <div>
                                <div class="annual-preview annual-markdown markdown-body" :ref="el => setPreviewRef(m.month, el)"></div>
                                <textarea :id="'plan_' + m.month" v-model="m.action_plan" :data-month="m.month" class="annual-edit annual-textarea" rows="6" placeholder="支持 Markdown；可直接粘贴图片自动上传并回填链接"></textarea>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="annual-edit" style="margin-top:18px; display:flex; justify-content:flex-end;">
                <button class="btn-primary" type="button" :disabled="submitting" @click="saveForm">保存</button>
            </div>
        </template>

        <div v-if="syncModalOpen" class="modal-overlay active" @click.self="closeSyncModal">
            <div class="modal-box">
                <div class="modal-header">
                    <h3>同步年度活动</h3>
                    <button class="modal-close" type="button" @click="closeSyncModal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="required">源年份（从该年复制）</label>
                        <input type="number" v-model.number="fromYear" class="form-input" min="2000" max="2100">
                    </div>
                    <div class="form-group">
                        <label>目标年份（当前页）</label>
                        <input type="number" class="form-input" readonly style="background:#f5f5f5;" :value="year">
                    </div>
                    <div class="modal-error">{{ syncError }}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" type="button" @click="closeSyncModal">取消</button>
                    <button class="btn-submit" type="button" @click="confirmSync">确认同步（覆盖）</button>
                </div>
            </div>
        </div>`
};
