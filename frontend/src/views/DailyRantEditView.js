import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http, getMarkdownIt } from '@/utils/index.js';
import DOMPurify from 'dompurify';
import { openViewer } from '@/utils/viewer.js';
import { hljs } from '@/utils/markdown.js';

function resolveRantId(route) {
    if (route.name === 'daily-rants-new') return null;
    return route.params.id ? String(route.params.id) : null;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createMdRenderer() {
    return getMarkdownIt();
}
export default {
    name: 'DailyRantEditView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const rantId = ref(resolveRantId(route));
        const rant = ref(null);
        const currentUser = ref(null);
        const isNew = computed(() => !rantId.value);
        const canEdit = ref(true);
        const editMode = ref(false);
        const saved = ref(false);
        const content = ref('');
        const previewHtml = ref('');
        const saving = ref(false);
        const error = ref('');

        const pageTitle = computed(() => isNew.value ? '写吐槽' : '每日吐槽');
        const showEditor = computed(() => isNew.value || canEdit.value);
        const bodyClass = computed(() => (isNew.value || editMode.value) ? 'mode-edit' : 'mode-preview');

        function renderPreview() {
            const mdIt = createMdRenderer();
            const md = content.value || '';
            const html = mdIt ? mdIt.render(md) : '<pre style="white-space:pre-wrap;">' + escapeHtml(md) + '</pre>';
            previewHtml.value = DOMPurify ? DOMPurify.sanitize(html) : html;
            nextTick(bindPreviewImages);
        }

        function bindPreviewImages() {
            document.querySelectorAll('.knowledge-markdown-host img').forEach(img => {
                img.classList.add('zoomable');
                img.onclick = function(e) {
                    e.preventDefault();
                    if (typeof openViewer === 'function') openViewer(img.src);
                };
            });
            if (hljs) {
                document.querySelectorAll('.knowledge-markdown-host pre code').forEach(el => {
                    try { hljs.highlightElement(el); } catch (e) {}
                });
            }
        }

        async function loadDoc() {
            try {
                const qs = rantId.value ? ('?id=' + encodeURIComponent(rantId.value)) : '';
                const { data } = await http.get('/api/daily-rants/doc' + qs);
                rant.value = data.rant;
                currentUser.value = data.currentUser;
                canEdit.value = data.canEdit !== false;
                saved.value = !!data.saved;
                content.value = (data.rant && data.rant.content) ? data.rant.content : '';
                editMode.value = isNew.value;
                renderPreview();
            } catch (e) {
                error.value = getApiError(e, '加载失败');
            }
        }

        function enterEditMode() {
            editMode.value = true;
            nextTick(() => {
                const el = document.getElementById('rantContent');
                if (el) el.focus();
            });
        }

        function cancelEditMode() {
            if (rant.value) content.value = rant.value.content || '';
            editMode.value = false;
            renderPreview();
        }

        async function saveRant() {
            if (!content.value.trim()) {
                alert('请填写吐槽内容');
                return;
            }
            saving.value = true;
            error.value = '';
            try {
                const payload = { content: content.value };
                if (rantId.value) payload.id = rantId.value;
                const { data } = await http.post('/api/daily-rants/save', payload);
                if (data.id && !rantId.value) {
                    router.push('/pages/daily-rant-edit.html?id=' + data.id + '&saved=1');
                    return;
                }
                saved.value = true;
                editMode.value = false;
                await loadDoc();
            } catch (e) {
                error.value = getApiError(e, '保存失败');
            } finally {
                saving.value = false;
            }
        }

        async function deleteRant() {
            if (!rantId.value) return;
            if (!confirm('确认删除这条吐槽？')) return;
            try {
                await http.post('/api/daily-rants/' + rantId.value + '/delete');
                router.push('/daily-rants');
            } catch (e) {
                alert(getApiError(e, '删除失败'));
            }
        }

        async function uploadRantImage(file) {
            const form = new FormData();
            form.append('image', file, file.name || 'paste.png');
            const { data } = await http.post('/api/daily-rants/image', form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (!data || !data.url) throw new Error('上传成功但未返回图片地址');
            return data.url;
        }

        function insertAtCursor(textarea, text) {
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const value = textarea.value || '';
            content.value = value.slice(0, start) + text + value.slice(end);
            nextTick(() => {
                const nextPos = start + text.length;
                textarea.selectionStart = nextPos;
                textarea.selectionEnd = nextPos;
                textarea.focus();
            });
        }

        async function onPaste(e) {
            if (!editMode.value && !isNew.value) return;
            const active = document.activeElement;
            if (!active || active.id !== 'rantContent') return;
            const clipboard = e.clipboardData;
            if (!clipboard) return;
            const items = clipboard.items ? Array.from(clipboard.items) : [];
            const imageItem = items.find(it => it && typeof it.type === 'string' && it.type.startsWith('image/'));
            if (!imageItem) return;
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (!file) return;
            const prevCursor = document.body.style.cursor;
            document.body.style.cursor = 'progress';
            try {
                const url = await uploadRantImage(file);
                insertAtCursor(active, '\n![](' + url + ')\n');
                renderPreview();
            } catch (err) {
                alert(err && err.message ? err.message : '图片上传失败');
            } finally {
                document.body.style.cursor = prevCursor;
            }
        }

        watch(content, renderPreview);
        watch(bodyClass, (cls) => {
            document.body.classList.remove('mode-edit', 'mode-preview');
            document.body.classList.add(cls);
        });

        onMounted(async () => {
            saved.value = route.query.saved === '1';
            document.body.classList.add(bodyClass.value);
            document.addEventListener('paste', onPaste);
            await loadDoc();
            if (isNew.value) {
                nextTick(() => {
                    const el = document.getElementById('rantContent');
                    if (el) el.focus();
                });
            }
        });

        onUnmounted(() => {
            document.removeEventListener('paste', onPaste);
            document.body.classList.remove('mode-edit', 'mode-preview');
        });

        return {
            rant, currentUser, isNew, canEdit, editMode, saved, content, previewHtml,
            saving, error, pageTitle, showEditor, saveRant, deleteRant, enterEditMode, cancelEditMode
        };
    },
    template: `<div class="page-header">
                <router-link to="/daily-rants" class="back-link">&larr; 返回列表</router-link>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:0;">
                        <h1 style="margin-bottom:4px;">{{ pageTitle }}</h1>
                        <div class="page-desc" style="margin-top:6px;">
                            <template v-if="isNew && currentUser">
                                作者：<strong>{{ currentUser.name }}</strong> · 日期：{{ new Date().toLocaleDateString('zh-CN') }}
                            </template>
                            <template v-else-if="rant">
                                作者：<strong>{{ rant.author_name }}</strong>
                                · 日期：{{ String(rant.rant_date || '').slice(0, 10) }}
                                <span v-if="currentUser && rant.user_id === currentUser.id" style="color:var(--primary);">（我写的）</span>
                            </template>
                            · 支持 Markdown，粘贴图片自动上传至外部图床
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <button v-if="!isNew && canEdit" class="btn-secondary knowledge-preview" type="button" @click="enterEditMode">编辑</button>
                        <button v-if="!isNew && canEdit" class="btn-secondary knowledge-edit" type="button" @click="cancelEditMode">取消</button>
                        <button v-if="!isNew && rant && canEdit" class="btn-danger" type="button" @click="deleteRant">删除</button>
                    </div>
                </div>
                <div v-if="saved" style="margin-top:12px; padding:10px 12px; background:#f0f9eb; border:1px solid #e1f3d8; border-radius:8px; color:var(--success); font-size:13px;">
                    已保存
                </div>
                <div v-if="error" style="margin-top:12px; padding:10px 12px; background:#fef0f0; border:1px solid #fde2e2; border-radius:8px; color:#f56c6c; font-size:13px;">
                    {{ error }}
                </div>
            </div>

            <form v-if="showEditor" @submit.prevent="saveRant">
                <div class="module-card knowledge-doc-card">
                    <div class="module-body" style="padding:20px;">
                        <div class="knowledge-preview">
                            <div class="knowledge-markdown annual-markdown markdown-body knowledge-markdown-host" v-html="previewHtml || '<span style=&quot;color:#909399;&quot;>（暂无内容）</span>'"></div>
                        </div>
                        <textarea
                            id="rantContent"
                            v-model="content"
                            class="knowledge-edit annual-textarea"
                            style="min-height:420px; width:100%;"
                            rows="20"
                            placeholder="今天想吐槽什么…&#10;&#10;支持 Markdown 语法，可直接粘贴截图（自动上传外部图床）"
                        ></textarea>
                    </div>
                </div>
                <div class="knowledge-edit" style="margin-top:18px; display:flex; justify-content:flex-end;">
                    <button class="btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                </div>
            </form>

            <div v-else class="module-card knowledge-doc-card">
                <div class="module-body" style="padding:20px;">
                    <div class="knowledge-markdown annual-markdown markdown-body knowledge-markdown-host" v-html="previewHtml || '<span style=&quot;color:#909399;&quot;>（暂无内容）</span>'"></div>
                </div>
            </div>`
};
