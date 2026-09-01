const state = {
    record: {
        taskEntries: [],
        updatedAt: ''
    },
    prompts: [],
    currentPromptKey: 'tasks',
    viewMode: 'edit',
    selectedEntryId: '',
    summary: null,
    summaryHintText: '',
    draft: {
        time: '',
        content: ''
    },
    euAdsPayload: null,
    euAdsLoading: false,
    euAdsError: ''
};

const els = {
    chatSubtitle: document.getElementById('chatSubtitle'),
    closeChatBtn: document.getElementById('closeChatBtn'),
    questionBubble: document.getElementById('questionBubble'),
    quickTabs: document.getElementById('quickTabs'),
    answerLabel: document.getElementById('answerLabel'),
    timeInput: document.getElementById('timeInput'),
    answerInput: document.getElementById('answerInput'),
    saveHint: document.getElementById('saveHint'),
    saveBtn: document.getElementById('saveBtn'),
    newEntryBtn: document.getElementById('newEntryBtn'),
    taskList: document.getElementById('taskList'),
    generateSummaryBtn: document.getElementById('generateSummaryBtn'),
    copySummaryBtn: document.getElementById('copySummaryBtn'),
    summaryHint: document.getElementById('summaryHint'),
    summaryPanel: document.getElementById('summaryPanel'),
    summaryTableWrap: document.getElementById('summaryTableWrap'),
    timeShortcut1230: document.getElementById('timeShortcut1230'),
    timeShortcut1830: document.getElementById('timeShortcut1830'),
    euAdsPanel: document.getElementById('euAdsPanel'),
    euAdsRefreshBtn: document.getElementById('euAdsRefreshBtn'),
    euAdsHint: document.getElementById('euAdsHint'),
    euAdsTableWrap: document.getElementById('euAdsTableWrap'),
    euAdsSuggestions: document.getElementById('euAdsSuggestions'),
    euAdsFooter: document.getElementById('euAdsFooter')
};

function getPrompt(promptKey) {
    return state.prompts.find((item) => item.key === promptKey) || state.prompts[0];
}

function currentPrompt() {
    return getPrompt(state.currentPromptKey);
}

function formatUpdatedAt(dateText) {
    if (!dateText) return '';
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) return '已经记下来啦。';
    return `最近修改时间：${date.toLocaleString('zh-CN', { hour12: false })}`;
}

function entryUpdatedAt(entry) {
    const date = new Date(entry.updatedAt || entry.createdAt || '');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { hour12: false });
}

function currentTimeValue() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function currentEntry() {
    return state.record.taskEntries.find((item) => item.id === state.selectedEntryId) || null;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function extractSummaryRow(entry) {
    const raw = String(entry?.content || '').trim();
    const delimiters = [' - ', '：', ':', '，', ',', '；', ';'];
    let splitIndex = -1;
    let delimiterLength = 0;

    for (const delimiter of delimiters) {
        const index = raw.indexOf(delimiter);
        if (index > 0 && (splitIndex === -1 || index < splitIndex)) {
            splitIndex = index;
            delimiterLength = delimiter.length;
        }
    }

    if (splitIndex > 0) {
        const taskName = raw.slice(0, splitIndex).trim();
        const completion = raw.slice(splitIndex + delimiterLength).trim();
        return {
            taskName: taskName || raw,
            completion: completion
                ? `${completion}${entry?.time ? `（记录时间 ${entry.time}）` : ''}`
                : `已记录${entry?.time ? `（记录时间 ${entry.time}）` : ''}`
        };
    }

    return {
        taskName: raw || '未命名任务',
        completion: `已记录${entry?.time ? `（记录时间 ${entry.time}）` : ''}`
    };
}

function buildSummaryPayload() {
    const rows = (state.record.taskEntries || []).map((entry) => extractSummaryRow(entry));
    if (!rows.length) return null;
    return { rows };
}

function buildSummaryClipboardPayload(summary) {
    const rows = summary?.rows || [];
    if (!rows.length) return { text: '', html: '' };

    const htmlRows = rows.map((row) => `
        <tr>
            <td>${escapeHtml(row.taskName || '')}</td>
            <td>${escapeHtml(row.completion || '')}</td>
        </tr>
    `).join('');

    return {
        text: [
            '任务名称\t今日完成情况',
            ...rows.map((row) => `${row.taskName}\t${row.completion}`)
        ].join('\n'),
        html: `
            <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
                <thead>
                    <tr>
                        <th>任务名称</th>
                        <th>今日完成情况</th>
                    </tr>
                </thead>
                <tbody>${htmlRows}</tbody>
            </table>
        `.trim()
    };
}

function syncDraftFromInputs() {
    state.draft.time = String(els.timeInput.value || '').trim();
    state.draft.content = String(els.answerInput.value || '').trim();
}

function loadDraftFromEntry(entry) {
    state.selectedEntryId = entry?.id || '';
    state.draft.time = String(entry?.time || currentTimeValue()).trim();
    state.draft.content = String(entry?.content || '').trim();
}

function resetDraft() {
    state.selectedEntryId = '';
    state.draft.time = currentTimeValue();
    state.draft.content = '';
}

function isEuAdsView() {
    return state.viewMode === 'euAds';
}

function formatShortDate(ymd) {
    const parts = String(ymd || '').split('-');
    if (parts.length !== 3) return ymd || '';
    return `${parts[1]}-${parts[2]}`;
}

function applyEuAdsPayload(payload) {
    state.euAdsError = String(payload?.error || '').trim();
    state.euAdsPayload = payload?.report || null;
}

function renderEuAds() {
    const active = isEuAdsView();
    els.euAdsPanel.classList.toggle('hidden', !active);
    if (!active) return;

    const prompt = currentPrompt();
    els.chatSubtitle.textContent = `${prompt?.label || '12:20'} · ${prompt?.title || '欧洲广告日报'}`;
    els.questionBubble.textContent = prompt?.question || '欧洲站广告近 7 日汇总来了。';

    if (state.euAdsLoading) {
        els.euAdsHint.textContent = '正在拉取欧洲站广告数据…';
        els.euAdsRefreshBtn.disabled = true;
        els.euAdsRefreshBtn.textContent = '拉取中…';
        return;
    }

    els.euAdsRefreshBtn.disabled = false;
    els.euAdsRefreshBtn.textContent = '刷新';

    if (state.euAdsError) {
        els.euAdsHint.textContent = state.euAdsError;
    } else if (state.euAdsPayload) {
        els.euAdsHint.textContent = '以下为近 7 个完整自然日的广告汇总（曝光 / 点击 / 出单）。';
    } else {
        els.euAdsHint.textContent = '点击刷新拉取最新数据。';
    }

    els.euAdsTableWrap.innerHTML = '';
    const report = state.euAdsPayload;
    if (report && Array.isArray(report.rows) && report.rows.length) {
        const table = document.createElement('table');
        table.className = 'eu-ads-table';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const headMetric = document.createElement('th');
        headMetric.textContent = '国家 · 指标';
        headRow.appendChild(headMetric);
        (report.dates || []).forEach((ymd) => {
            const th = document.createElement('th');
            th.textContent = formatShortDate(ymd);
            headRow.appendChild(th);
        });
        const headTrend = document.createElement('th');
        headTrend.textContent = '涨跌';
        headRow.appendChild(headTrend);
        thead.appendChild(headRow);

        const tbody = document.createElement('tbody');
        report.rows.forEach((row) => {
            const tr = document.createElement('tr');
            const metricCell = document.createElement('td');
            metricCell.textContent = row.key || '';
            tr.appendChild(metricCell);
            (report.dates || []).forEach((ymd) => {
                const td = document.createElement('td');
                const val = row.values && row.values[ymd];
                td.textContent = Number.isFinite(val) ? String(val) : '—';
                tr.appendChild(td);
            });
            const trendCell = document.createElement('td');
            trendCell.textContent = row.trend === 'up' ? '↑' : '';
            tr.appendChild(trendCell);
            tbody.appendChild(tr);
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        els.euAdsTableWrap.appendChild(table);
    }

    els.euAdsSuggestions.innerHTML = '';
    const suggestions = (report && report.suggestions) || [];
    if (suggestions.length) {
        suggestions.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'eu-ads-suggestion-item';
            li.innerHTML = `
                <strong>【建议，需你手动执行】${escapeHtml(item.country || '')}</strong>
                <span>${escapeHtml(item.action || '')}</span>
                <em>依据：${escapeHtml(item.evidence || '')}</em>
                <em>复核：${escapeHtml(item.review || '')}</em>
            `;
            els.euAdsSuggestions.appendChild(li);
        });
    } else if (!state.euAdsLoading && report) {
        const li = document.createElement('li');
        li.className = 'eu-ads-suggestion-item';
        li.textContent = '暂无额外建议，可继续观察。';
        els.euAdsSuggestions.appendChild(li);
    }

    const footerParts = [];
    if (report && report.fetchedAt) {
        footerParts.push(`拉取时间：${new Date(report.fetchedAt).toLocaleString('zh-CN', { hour12: false })}`);
    }
    if (report && Array.isArray(report.failures) && report.failures.length) {
        const failed = [...new Set(report.failures.map((item) => item.country).filter(Boolean))];
        footerParts.push(`部分数据拉取失败：${failed.join('、')}`);
    }
    els.euAdsFooter.textContent = footerParts.join(' · ');
}

async function refreshEuAdsReport() {
    if (state.euAdsLoading) return;
    state.euAdsLoading = true;
    renderEuAds();
    try {
        const payload = await window.desktopPet.fetchEuAdsReport();
        applyEuAdsPayload(payload);
    } catch (error) {
        state.euAdsError = error.message || '拉取失败';
    } finally {
        state.euAdsLoading = false;
        renderAll();
    }
}

function renderTabs() {
    els.quickTabs.innerHTML = '';
    state.prompts.forEach((prompt) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quick-tab';
        if (prompt.key === state.currentPromptKey) {
            button.classList.add('active');
        }
        button.innerHTML = `<strong>${prompt.label}</strong><span>${prompt.title}</span>`;
        button.addEventListener('click', () => {
            state.currentPromptKey = prompt.key;
            state.viewMode = prompt.key === 'euAdsReport' ? 'euAds' : 'edit';
            renderAll();
            if (state.viewMode === 'euAds') {
                if (!state.euAdsPayload && !state.euAdsLoading) {
                    refreshEuAdsReport();
                }
            } else {
                els.answerInput.focus();
            }
        });
        els.quickTabs.appendChild(button);
    });
}

function renderTaskList() {
    els.taskList.innerHTML = '';
    if (!state.record.taskEntries.length) {
        const empty = document.createElement('div');
        empty.className = 'task-empty';
        empty.textContent = '今天还没有任务记录，单击宠物就可以记一条。';
        els.taskList.appendChild(empty);
        return;
    }

    state.record.taskEntries.forEach((entry) => {
        const item = document.createElement('article');
        item.className = 'task-item';
        if (entry.id === state.selectedEntryId) {
            item.classList.add('active');
        }

        const updatedAt = entryUpdatedAt(entry);
        const head = document.createElement('div');
        head.className = 'task-item-head';

        const time = document.createElement('div');
        time.className = 'task-item-time';
        time.textContent = entry.time || '未设时间';

        const meta = document.createElement('div');
        meta.className = 'task-item-meta';
        meta.textContent = updatedAt ? `修改于 ${updatedAt}` : '';

        const content = document.createElement('p');
        content.className = 'task-item-content';
        content.textContent = entry.content || '';

        const actions = document.createElement('div');
        actions.className = 'task-item-actions';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'task-edit-btn';
        editButton.textContent = '修改';

        head.appendChild(time);
        head.appendChild(meta);
        actions.appendChild(editButton);
        item.appendChild(head);
        item.appendChild(content);
        item.appendChild(actions);

        editButton.addEventListener('click', () => {
            loadDraftFromEntry(entry);
            state.viewMode = 'edit';
            renderAll();
            els.answerInput.focus();
        });

        els.taskList.appendChild(item);
    });
}

function renderSummary() {
    const isPreview = state.viewMode === 'preview';
    const hasEntries = (state.record.taskEntries || []).length > 0;
    els.generateSummaryBtn.disabled = !isPreview || !hasEntries;
    els.copySummaryBtn.disabled = !isPreview || !state.summary;
    els.summaryHint.textContent = isPreview ? state.summaryHintText : '';
    els.summaryHint.classList.toggle('hidden', !isPreview || !state.summaryHintText);
    els.summaryPanel.classList.toggle('hidden', !isPreview || !state.summary);

    if (!isPreview || !state.summary) {
        els.summaryTableWrap.innerHTML = '';
        return;
    }

    const header = document.createElement('table');
    header.className = 'summary-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headTask = document.createElement('th');
    headTask.textContent = '任务名称';
    const headCompletion = document.createElement('th');
    headCompletion.textContent = '今日完成情况';
    headRow.appendChild(headTask);
    headRow.appendChild(headCompletion);
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    state.summary.rows.forEach((row) => {
        const tr = document.createElement('tr');
        const taskCell = document.createElement('td');
        taskCell.textContent = row.taskName;
        const completionCell = document.createElement('td');
        completionCell.textContent = row.completion;
        tr.appendChild(taskCell);
        tr.appendChild(completionCell);
        tbody.appendChild(tr);
    });

    header.appendChild(thead);
    header.appendChild(tbody);

    els.summaryTableWrap.innerHTML = '';
    els.summaryTableWrap.appendChild(header);
}

function renderForm() {
    const prompt = currentPrompt();
    const isPreview = state.viewMode === 'preview';
    const isEuAds = isEuAdsView();
    const editingEntry = currentEntry();
    document.body.classList.toggle('mode-edit', !isPreview && !isEuAds);
    document.body.classList.toggle('mode-preview', isPreview);
    document.body.classList.toggle('mode-eu-ads', isEuAds);

    if (isEuAds) return;

    els.chatSubtitle.textContent = `${prompt?.label || ''} · ${prompt?.title || '记录任务'}`;
    els.questionBubble.textContent = isPreview
        ? '这里是今天已经记下来的任务，点“修改”就能继续编辑。'
        : (prompt?.question || '选一下时间，再写一条任务内容吧。');
    els.answerLabel.textContent = editingEntry ? '修改这条任务' : '记录一条任务';
    els.timeInput.value = state.draft.time || currentTimeValue();
    els.answerInput.value = state.draft.content || '';
    els.answerInput.placeholder = prompt?.placeholder || '';
    els.timeInput.disabled = isPreview;
    els.answerInput.readOnly = isPreview;
    els.saveBtn.disabled = isPreview;
    els.saveBtn.textContent = isPreview ? '查看中' : (editingEntry ? '保存修改' : '保存');
    els.newEntryBtn.style.display = isPreview ? 'none' : 'inline-flex';
    els.saveHint.textContent = isPreview ? formatUpdatedAt(state.record.updatedAt) : '';
}

function renderAll() {
    renderTabs();
    renderForm();
    renderEuAds();
    renderSummary();
    renderTaskList();
}

async function saveCurrentAnswer() {
    if (state.viewMode === 'preview') return;
    syncDraftFromInputs();
    if (!state.draft.time) {
        els.saveHint.textContent = '请先选择时间';
        return;
    }
    if (!state.draft.content) {
        els.saveHint.textContent = '请输入任务内容';
        return;
    }

    els.saveBtn.disabled = true;
    els.saveBtn.textContent = state.selectedEntryId ? '保存中…' : '记录中…';
    try {
        state.record = await window.desktopPet.saveAnswer({
            entryId: state.selectedEntryId,
            time: state.draft.time,
            content: state.draft.content
        });
        state.summary = null;
        state.summaryHintText = '';
        const matched = state.record.taskEntries.find((item) => (
            item.id === state.selectedEntryId
            || (item.time === state.draft.time && item.content === state.draft.content)
        ));
        state.selectedEntryId = matched?.id || '';
        renderAll();
        els.saveHint.textContent = '已经帮你记下来啦。';
    } catch (error) {
        els.saveHint.textContent = error.message || '保存失败';
        els.saveBtn.disabled = false;
        els.saveBtn.textContent = state.selectedEntryId ? '保存修改' : '保存';
    }
}

async function boot() {
    const payload = await window.desktopPet.getState();
    state.record = payload.record || state.record;
    state.prompts = payload.prompts || [];
    state.currentPromptKey = payload.currentPromptKey || state.currentPromptKey;
    resetDraft();
    renderAll();
}

els.closeChatBtn.addEventListener('click', () => {
    window.desktopPet.hideChat();
});

els.newEntryBtn.addEventListener('click', () => {
    state.viewMode = 'edit';
    resetDraft();
    renderAll();
    els.answerInput.focus();
});

els.generateSummaryBtn.addEventListener('click', () => {
    state.summary = buildSummaryPayload();
    state.summaryHintText = state.summary ? '今日总结表格已生成。' : '今天还没有可汇总的任务。';
    renderAll();
});

els.copySummaryBtn.addEventListener('click', async () => {
    if (!state.summary) {
        state.summaryHintText = '请先生成今日总结';
        renderAll();
        return;
    }

    try {
        const payload = buildSummaryClipboardPayload(state.summary);
        await window.desktopPet.copySummary(payload);
        state.summaryHintText = '总结已经复制好了，直接 Ctrl+V 粘贴即可。';
        renderAll();
    } catch (error) {
        state.summaryHintText = error.message || '复制失败';
        renderAll();
    }
});

els.timeShortcut1230.addEventListener('click', () => {
    state.draft.time = '12:30';
    els.timeInput.value = state.draft.time;
});

els.timeShortcut1830.addEventListener('click', () => {
    state.draft.time = '18:30';
    els.timeInput.value = state.draft.time;
});

els.saveBtn.addEventListener('click', () => {
    saveCurrentAnswer();
});

els.euAdsRefreshBtn.addEventListener('click', () => {
    refreshEuAdsReport();
});

window.desktopPet.onPrompt((prompt) => {
    state.currentPromptKey = prompt.key;
    state.viewMode = prompt.key === 'euAdsReport' ? 'euAds' : 'edit';
    state.summary = null;
    state.summaryHintText = '';
    resetDraft();
    if (state.viewMode === 'euAds') {
        state.euAdsLoading = true;
    }
    renderAll();
    if (state.viewMode !== 'euAds') {
        els.answerInput.focus();
    }
});

window.desktopPet.onOpenChat((payload) => {
    const promptKey = payload?.promptKey || state.currentPromptKey;
    if (promptKey === 'euAdsReport') {
        state.viewMode = 'euAds';
    } else {
        state.viewMode = payload?.viewMode === 'preview' ? 'preview' : 'edit';
    }
    state.currentPromptKey = promptKey;
    if (payload?.resetDraft) {
        resetDraft();
    } else if (state.viewMode === 'edit' && !state.selectedEntryId) {
        resetDraft();
    }
    if (state.viewMode !== 'preview') {
        state.summary = null;
        state.summaryHintText = '';
    }
    renderAll();
    if (state.viewMode === 'euAds') {
        if (!state.euAdsPayload && !state.euAdsLoading) {
            refreshEuAdsReport();
        }
    } else if (state.viewMode !== 'preview') {
        els.answerInput.focus();
    }
});

window.desktopPet.onEuAdsReport((payload) => {
    applyEuAdsPayload(payload);
    state.euAdsLoading = false;
    renderAll();
});

window.desktopPet.onStateUpdated((payload) => {
    state.record = payload.record || state.record;
    state.prompts = payload.prompts || state.prompts;
    state.currentPromptKey = payload.currentPromptKey || state.currentPromptKey;
    if (state.selectedEntryId) {
        const selected = currentEntry();
        if (selected) {
            loadDraftFromEntry(selected);
        }
    }
    if (state.summary && !(state.record.taskEntries || []).length) {
        state.summary = null;
        state.summaryHintText = '';
    }
    renderAll();
});

boot().catch((error) => {
    els.saveHint.textContent = error.message || '初始化失败';
});
