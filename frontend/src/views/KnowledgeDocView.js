import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, getMarkdownIt, http } from '@/utils/index.js';
import DOMPurify from 'dompurify';
import { hljs } from '@/utils/markdown.js';
import { openViewer } from '@/utils/viewer.js';

function parseDocContext(route) {
    const isNew = route.name === 'knowledge-new';
    const docId = route.params.id ? parseInt(route.params.id, 10) : null;
    const loadDraft = String(route.query.load_draft || '') === '1';
    const published = String(route.query.published || '') === '1';
    return { isNew, docId, loadDraft, published };
}

export default {
    name: 'KnowledgeDocView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const ctx = parseDocContext(route);
        const loading = ref(true);
        const isNew = ref(ctx.isNew);
        const docId = ref(ctx.docId);
        const published = ref(ctx.published);
        const draftAvailable = ref(false);
        const loadDraftRequested = ref(ctx.loadDraft);
        const isEditMode = ref(ctx.isNew);
        const title = ref('');
        const content = ref('');
        const draftStatus = ref('');
        const submitting = ref(false);
        const previewRef = ref(null);
        const livePreviewRef = ref(null);

        let draftTimer = null;
        let lastDraftSnapshot = '';
        let draftSaveEnabled = false;

        const pageTitle = computed(() => title.value.trim() || (isNew.value ? '新建文档' : '文档'));
        const bodyClass = computed(() => isEditMode.value ? 'mode-edit' : 'mode-preview');

        function escapeHtml(text) {
            return String(text || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function renderMarkdownToEl(el, mdText) {
            if (!el) return;
            const mdIt = getMarkdownIt();
            const md = mdText || '';
            const html = mdIt ? mdIt.render(md) : `<pre style="white-space:pre-wrap;">${escapeHtml(md)}</pre>`;
            const safe = DOMPurify ? DOMPurify.sanitize(html) : html;
            const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
            const contentHtml = safe || '<span style="color:#909399;">（暂无内容）</span>';
            shadow.innerHTML = `
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.6.1/github-markdown.min.css">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github.min.css">
                <style>
                    :host { display: block; }
                    .markdown-body { padding: 16px; font-size: 14px; line-height: 1.75; }
                    .markdown-body img { width: 33.333%; max-width: 33.333%; height: auto; }
                </style>
                <div class="markdown-body">${contentHtml}</div>
            `;
            if (hljs) {
                shadow.querySelectorAll('pre code').forEach(codeEl => {
                    try { hljs.highlightElement(codeEl); } catch (e) {}
                });
            }
            shadow.querySelectorAll('img').forEach(img => {
                img.classList.add('zoomable');
                img.addEventListener('click', e => {
                    e.preventDefault();
                    if (typeof openViewer === 'function') openViewer(img.src);
                });
            });
            shadow.querySelectorAll('a[href*="/api/knowledge/download/"]').forEach(link => {
                link.classList.add('knowledge-download-link');
            });
        }

        function refreshLivePreview() {
            nextTick(() => {
                if (livePreviewRef.value) renderMarkdownToEl(livePreviewRef.value, content.value);
            });
        }
        function refreshFullPreview() {
            nextTick(() => {
                if (previewRef.value) renderMarkdownToEl(previewRef.value, content.value);
            });
        }

        function getDraftSnapshot() {
            return title.value + '\n---\n' + content.value;
        }
        function enableDraftSaveOnEdit() {
            if (draftSaveEnabled) return;
            draftSaveEnabled = true;
            lastDraftSnapshot = getDraftSnapshot();
        }

        async function saveDraft() {
            if (!draftSaveEnabled || !isEditMode.value) return;
            const snapshot = getDraftSnapshot();
            if (snapshot === lastDraftSnapshot) return;
            try {
                const res = await http.post('/api/knowledge/draft', {
                    title: title.value,
                    content: content.value,
                    doc_id: docId.value
                });
                if (res.status === 200) {
                    lastDraftSnapshot = snapshot;
                    draftStatus.value = '草稿已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
                }
            } catch (e) {}
        }

        function startDraftAutoSave() {
            if (draftTimer) return;
            lastDraftSnapshot = getDraftSnapshot();
            draftTimer = setInterval(saveDraft, 5000);
        }
        function stopDraftAutoSave() {
            if (draftTimer) { clearInterval(draftTimer); draftTimer = null; }
        }

        async function applyDraftIfRequested() {
            if (!loadDraftRequested.value) return;
            try {
                const { data } = await http.get('/api/knowledge/draft');
                if (!data.draft) return;
                title.value = data.draft.title || '';
                content.value = data.draft.content || '';
                draftSaveEnabled = true;
                lastDraftSnapshot = getDraftSnapshot();
                draftStatus.value = '已恢复草稿';
                refreshLivePreview();
            } catch (e) {}
        }

        async function loadDoc() {
            loading.value = true;
            try {
                const params = {};
                if (docId.value) params.id = docId.value;
                const { data } = await http.get('/api/knowledge/doc', { params });
                isNew.value = data.isNew || !data.doc;
                docId.value = data.doc ? data.doc.id : null;
                published.value = data.published || published.value;
                draftAvailable.value = data.draftAvailable || false;
                if (data.loadDraft !== undefined) loadDraftRequested.value = data.loadDraft;
                title.value = data.doc ? data.doc.title || '' : '';
                content.value = data.doc ? data.doc.content || '' : '';
                draftSaveEnabled = !draftAvailable.value || loadDraftRequested.value;
                isEditMode.value = isNew.value;
            } catch (e) {
                alert(getApiError(e, '加载失败'));
            } finally {
                loading.value = false;
                nextTick(() => {
                    refreshFullPreview();
                    if (isEditMode.value) refreshLivePreview();
                });
            }
        }

        function enterEditMode() {
            isEditMode.value = true;
            draftSaveEnabled = true;
            refreshLivePreview();
            startDraftAutoSave();
        }
        function cancelEditMode() {
            stopDraftAutoSave();
            router.go(0);
        }

        async function uploadImage(file) {
            const form = new FormData();
            form.append('image', file, file.name || 'paste.png');
            const { data } = await http.post('/api/knowledge/image', form);
            if (!data || !data.url) throw new Error('上传成功但未返回图片地址');
            return data.url;
        }
        async function uploadFile(file) {
            const form = new FormData();
            form.append('file', file, file.name || 'file');
            const { data } = await http.post('/api/knowledge/file', form);
            if (!data || !data.downloadUrl) throw new Error('上传成功但未返回下载地址');
            return { downloadUrl: data.downloadUrl, filename: data.filename || file.name || '文件' };
        }
        function escapeMarkdownLinkText(text) {
            return String(text || '').replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
        }
        function insertAtCursor(textarea, text) {
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const value = textarea.value || '';
            const newVal = value.slice(0, start) + text + value.slice(end);
            content.value = newVal;
            nextTick(() => {
                textarea.selectionStart = start + text.length;
                textarea.selectionEnd = start + text.length;
                refreshLivePreview();
                enableDraftSaveOnEdit();
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
        function isTextPasteFile(file) {
            if (!file) return false;
            const name = String(file.name || '');
            const type = String(file.type || '');
            if (/^text\//.test(type)) return true;
            return /\.(txt|md|csv|log|json|xml|yml|yaml)$/i.test(name);
        }
        function looksGarbledText(text) {
            if (!text) return false;
            if (text.includes('\uFFFD')) return true;
            const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
            const latin1Noise = (text.match(/[\u00c0-\u00ff]{2,}/g) || []).length;
            return text.length > 20 && cjk === 0 && latin1Noise > 0;
        }
        async function readTextFileContent(file) {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const utf8 = new TextDecoder('utf-8').decode(bytes);
            if (!looksGarbledText(utf8)) return utf8;
            try {
                const gbk = new TextDecoder('gbk').decode(bytes);
                if (!looksGarbledText(gbk)) return gbk;
            } catch (e) {}
            return utf8;
        }

        async function onPaste(e) {
            if (!isEditMode.value) return;
            const active = document.activeElement;
            if (!active || active.id !== 'docContent') return;
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
                    const url = await uploadImage(file);
                    insertAtCursor(active, `\n![](${url})\n`);
                } catch (err) {
                    alert(err && err.message ? err.message : '图片上传失败');
                } finally {
                    document.body.style.cursor = prevCursor;
                }
                return;
            }
            const fileItem = items.find(it => it && it.kind === 'file' && typeof it.type === 'string' && !it.type.startsWith('image/'));
            if (fileItem) {
                e.preventDefault();
                const file = fileItem.getAsFile();
                if (!file) return;
                const prevCursor = document.body.style.cursor;
                document.body.style.cursor = 'progress';
                try {
                    if (isTextPasteFile(file)) {
                        const text = await readTextFileContent(file);
                        insertAtCursor(active, '\n' + text + '\n');
                        return;
                    }
                    const { downloadUrl, filename } = await uploadFile(file);
                    const displayName = filename || file.name || '文件';
                    const label = escapeMarkdownLinkText('下载 ' + displayName);
                    insertAtCursor(active, `\n[${label}](${downloadUrl})\n`);
                } catch (err) {
                    alert(err && err.message ? err.message : '文件处理失败');
                } finally {
                    document.body.style.cursor = prevCursor;
                }
                return;
            }
            const plain = clipboard.getData('text/plain');
            if (plain && plain.includes('\t')) {
                const md = tsvToMarkdown(plain);
                if (md) {
                    e.preventDefault();
                    insertAtCursor(active, '\n' + md + '\n');
                    return;
                }
            }
            const html = clipboard.getData('text/html');
            if (html && /<table[\s>]/i.test(html)) {
                const md = htmlTablesToMarkdown(html);
                if (md) {
                    e.preventDefault();
                    insertAtCursor(active, '\n' + md + '\n');
                }
            }
        }

        function onTitleInput() {
            document.title = pageTitle.value + ' - Amazon 运营SOP管理系统';
            enableDraftSaveOnEdit();
        }
        function onContentInput() {
            enableDraftSaveOnEdit();
            refreshLivePreview();
        }

        async function submitForm() {
            if (!title.value.trim()) {
                alert('请填写文档标题');
                return;
            }
            if (submitting.value) return;
            submitting.value = true;
            stopDraftAutoSave();
            try {
                const payload = { title: title.value.trim(), content: content.value };
                if (docId.value) payload.id = docId.value;
                const { data } = await http.post('/api/knowledge/save', payload);
                isEditMode.value = false;
                if (data && data.id) {
                    router.push('/knowledge/' + data.id + '?published=1');
                } else if (docId.value) {
                    router.push('/knowledge/' + docId.value + '?published=1');
                } else {
                    router.push('/knowledge');
                }
            } catch (e) {
                alert(getApiError(e, '发布失败'));
                submitting.value = false;
            }
        }

        async function deleteDoc() {
            if (!docId.value) return;
            if (!confirm('确认删除该文档？此操作不可恢复。')) return;
            try {
                await http.delete('/api/knowledge/' + docId.value);
                router.push('/knowledge');
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        function syncBodyModeClass() {
            document.body.classList.remove('mode-preview', 'mode-edit');
            document.body.classList.add(isEditMode.value ? 'mode-edit' : 'mode-preview');
        }

        watch(isEditMode, val => {
            syncBodyModeClass();
            if (val) {
                refreshLivePreview();
                if (isNew.value) startDraftAutoSave();
            } else {
                refreshFullPreview();
            }
        });

        onMounted(async () => {
            syncBodyModeClass();
            await loadDoc();
            document.title = pageTitle.value + ' - Amazon 运营SOP管理系统';
            document.addEventListener('paste', onPaste);
            if (isNew.value) {
                startDraftAutoSave();
                await applyDraftIfRequested();
            }
        });
        onUnmounted(() => {
            stopDraftAutoSave();
            document.removeEventListener('paste', onPaste);
            document.body.classList.remove('mode-preview', 'mode-edit');
        });

        return {
            loading, isNew, docId, published, isEditMode, title, content, draftStatus, submitting,
            pageTitle, bodyClass, previewRef, livePreviewRef,
            enterEditMode, cancelEditMode, onTitleInput, onContentInput, submitForm, deleteDoc
        };
    },
    template: `<div v-if="loading" style="text-align:center; padding:40px; color:#999;">加载中...</div>
        <template v-else>
            <div class="page-header">
                <router-link to="/knowledge" class="back-link">&larr; 返回知识库</router-link>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:0;">
                        <div class="knowledge-preview">
                            <h1 style="margin-bottom:4px;">{{ pageTitle }}</h1>
                        </div>
                        <div class="knowledge-edit" style="margin-top:8px;">
                            <input id="docTitle" v-model="title" class="search-input" style="width:100%; max-width:640px; font-size:18px; font-weight:600;" type="text" maxlength="500" placeholder="文档标题" required @input="onTitleInput">
                        </div>
                        <div class="page-desc" style="margin-top:6px;">支持 Markdown；可直接粘贴 Word 表格、Excel、图片、文件（生成下载链接）</div>
                        <div class="knowledge-edit" style="margin-top:8px; font-size:12px; color:var(--text-secondary); min-height:18px;">{{ draftStatus }}</div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <button v-if="!isNew" class="btn-secondary knowledge-preview" type="button" @click="enterEditMode">编辑</button>
                        <button v-if="!isNew" class="btn-secondary knowledge-edit" type="button" @click="cancelEditMode">取消</button>
                        <button v-if="!isNew && docId" class="btn-danger" type="button" @click="deleteDoc">删除</button>
                    </div>
                </div>
                <div v-if="published" style="margin-top:12px; padding:10px 12px; background:#f0f9eb; border:1px solid #e1f3d8; border-radius:8px; color:var(--success); font-size:13px;">已发布</div>
            </div>
            <div class="module-card knowledge-doc-card">
                <div class="module-body knowledge-doc-body" style="padding:20px;">
                    <div class="knowledge-full-preview knowledge-preview">
                        <div class="knowledge-markdown" ref="previewRef"></div>
                    </div>
                    <div class="knowledge-split-layout">
                        <div class="knowledge-split-pane knowledge-split-editor">
                            <div class="knowledge-pane-label">编辑</div>
                            <textarea id="docContent" v-model="content" class="annual-textarea knowledge-editor-textarea" rows="24" placeholder="在此粘贴或编写文档内容…" @input="onContentInput" @keyup="onContentInput" @change="onContentInput"></textarea>
                        </div>
                        <div class="knowledge-split-pane knowledge-split-preview-pane">
                            <div class="knowledge-pane-label">预览</div>
                            <div class="knowledge-markdown knowledge-live-preview" ref="livePreviewRef"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="knowledge-edit" style="margin-top:18px; display:flex; justify-content:flex-end; align-items:center; gap:12px;">
                <button class="btn-primary" type="button" :disabled="submitting" @click="submitForm">{{ submitting ? '发布中…' : '发布' }}</button>
            </div>
        </template>`
};
