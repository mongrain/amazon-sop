const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, Notification, Menu, Tray, nativeImage, screen, clipboard, ClipboardItem } = require('electron');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchEuAdsDailyReport } = require('../service/eu-ads-daily-report');

const PROMPTS = [
    {
        key: 'euAdsReport',
        label: '12:20',
        title: '欧洲广告日报',
        question: '欧洲站广告近 7 日汇总来了。',
        message: '欧洲站广告日报到了',
        placeholder: '',
        hour: 12,
        minute: 20
    },
    {
        key: 'tasks',
        label: '12:30',
        title: '记录任务',
        question: '选一下时间，再记一条任务内容吧。',
        message: '到点啦，选一下时间，记一条任务内容吧。',
        placeholder: '例如：广告报表复盘，今天先补异常原因说明',
        hour: 12,
        minute: 30
    },
    {
        key: 'progress',
        label: '18:10',
        title: '补一条任务',
        question: '再选一下时间，补记一条新的任务内容吧。',
        message: '快下班前再补记一条任务内容吧。',
        placeholder: '例如：同步素材修改进度，已催设计，等待返回',
        hour: 18,
        minute: 10
    }
];

let petWindow = null;
let chatWindow = null;
let tray = null;
let reminderTimer = null;
let currentPromptKey = '';
let lastEuAdsReport = null;
let euAdsFetchInFlight = null;

function ensureStorePath() {
    const storePath = path.join(app.getPath('userData'), 'desktop-pet-state.json');
    if (!fs.existsSync(storePath)) {
        fs.writeFileSync(storePath, JSON.stringify({ records: {}, reminders: {} }, null, 2), 'utf8');
    }
    return storePath;
}

function readStore() {
    try {
        return JSON.parse(fs.readFileSync(ensureStorePath(), 'utf8'));
    } catch (error) {
        return { records: {}, reminders: {} };
    }
}

function writeStore(data) {
    fs.writeFileSync(ensureStorePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTimeFromPrompt(promptKey = '') {
    const prompt = PROMPTS.find((item) => item.key === promptKey);
    if (!prompt) return '';
    return `${String(prompt.hour).padStart(2, '0')}:${String(prompt.minute).padStart(2, '0')}`;
}

function createTaskEntry({ id = '', time = '', content = '', createdAt = '', updatedAt = '' } = {}) {
    const now = new Date().toISOString();
    return {
        id: String(id || `task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`),
        time: String(time || '').trim(),
        content: String(content || '').trim(),
        createdAt: createdAt || now,
        updatedAt: updatedAt || now
    };
}

function normalizeRecord(date, record = {}) {
    const entries = Array.isArray(record.taskEntries)
        ? record.taskEntries
            .map((item) => createTaskEntry(item))
            .filter((item) => item.content)
        : [];

    if (!entries.length && String(record.taskProgressList || '').trim()) {
        entries.push(createTaskEntry({
            time: '',
            content: String(record.taskProgressList || '').trim(),
            createdAt: record.updatedAt || new Date().toISOString(),
            updatedAt: record.updatedAt || new Date().toISOString()
        }));
    }

    entries.sort((left, right) => {
        const leftTime = String(left.time || '99:99');
        const rightTime = String(right.time || '99:99');
        if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
        return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
    });

    return {
        date,
        taskEntries: entries,
        updatedAt: record.updatedAt || ''
    };
}

function getTodayState() {
    const store = readStore();
    const date = getDateKey();
    const record = normalizeRecord(date, store.records[date] || {});
    const reminders = store.reminders[date] || {};
    return { record, reminders };
}

function saveTodayRecord(nextRecord = {}) {
    const store = readStore();
    const date = getDateKey();
    const current = normalizeRecord(date, store.records[date] || {});
    const next = normalizeRecord(date, {
        ...current,
        ...nextRecord,
        updatedAt: new Date().toISOString()
    });
    store.records[date] = next;
    store.reminders[date] = store.reminders[date] || {};
    writeStore(store);
    return next;
}

function saveTaskEntry(entryPatch = {}) {
    const { record } = getTodayState();
    const entryId = String(entryPatch.entryId || '').trim();
    const content = String(entryPatch.content || '').trim();
    const time = String(entryPatch.time || '').trim();
    const nextEntries = [...record.taskEntries];
    const existingIndex = nextEntries.findIndex((item) => item.id === entryId);

    if (existingIndex >= 0) {
        const currentEntry = nextEntries[existingIndex];
        nextEntries[existingIndex] = createTaskEntry({
            ...currentEntry,
            id: currentEntry.id,
            time,
            content,
            createdAt: currentEntry.createdAt,
            updatedAt: new Date().toISOString()
        });
    } else {
        nextEntries.push(createTaskEntry({ time, content }));
    }

    return saveTodayRecord({
        taskEntries: nextEntries
    });
}

function reminderAt(prompt, base = new Date()) {
    const date = new Date(base);
    date.setHours(prompt.hour, prompt.minute, 0, 0);
    return date;
}

function hasPromptBeenSent(promptKey) {
    const { reminders } = getTodayState();
    return Boolean(reminders[promptKey]);
}

function markPromptSent(promptKey) {
    const store = readStore();
    const date = getDateKey();
    store.reminders[date] = store.reminders[date] || {};
    store.reminders[date][promptKey] = new Date().toISOString();
    writeStore(store);
}

function syncStateToWindows() {
    const payload = {
        ...getTodayState(),
        prompts: PROMPTS,
        currentPromptKey
    };
    petWindow?.webContents.send('pet:state-updated', payload);
    chatWindow?.webContents.send('pet:state-updated', payload);
}

function getPetPosition() {
    const display = screen.getPrimaryDisplay().workArea;
    const width = 132;
    const height = 132;
    return {
        x: display.x + display.width - width - 18,
        y: display.y + display.height - height - 18,
        width,
        height
    };
}

function getChatPosition() {
    const petBounds = petWindow ? petWindow.getBounds() : getPetPosition();
    const width = 360;
    const height = 470;
    const x = Math.max(12, petBounds.x + petBounds.width - width + 24);
    const y = Math.max(12, petBounds.y - height + 18);
    return { x, y, width, height };
}

function clampPetPosition(nextX, nextY) {
    if (!petWindow) {
        return { x: nextX, y: nextY };
    }
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({
        x: Math.round(nextX + bounds.width / 2),
        y: Math.round(nextY + bounds.height / 2)
    }).workArea;

    return {
        x: Math.max(display.x, Math.min(nextX, display.x + display.width - bounds.width)),
        y: Math.max(display.y, Math.min(nextY, display.y + display.height - bounds.height))
    };
}

function createTray() {
    if (tray) return;
    const image = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAgklEQVR4AWP4TwAw/P//PwMDA8MABYz8T0L4H4j/f2BgYHjPwMDwH0YGBob/DgYGhv8MDAz/GRgYGJ4zMDAw/MfAwPAPjIyM+M/AwMDxH4mJieE/AwPDf0ZGRv+BmZmZ4T8DA8N/JiYm/gfEGBkY/jP+/v8PDAwMnG5gYGD4DwMDw38YGBiYAwAAd20mSA1hKUsAAAAASUVORK5CYII=');
    tray = new Tray(image);
    tray.setToolTip('吉伊卡哇工作宠物');
    tray.on('double-click', () => showChatWindow(currentPromptKey || 'tasks'));
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开聊天框', click: () => showChatWindow(currentPromptKey || 'tasks') },
        { label: '欧洲广告日报', click: () => showChatWindow('euAdsReport') },
        { label: '隐藏聊天框', click: () => chatWindow?.hide() },
        { type: 'separator' },
        { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
}

function createPetWindow() {
    const bounds = getPetPosition();
    petWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
    petWindow.once('ready-to-show', () => {
        petWindow.show();
        petWindow.setAlwaysOnTop(true, 'screen-saver');
        syncStateToWindows();
    });
    petWindow.on('closed', () => {
        petWindow = null;
    });
}

function createChatWindow() {
    const bounds = getChatPosition();
    chatWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    chatWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    chatWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            chatWindow.hide();
        }
    });
    chatWindow.on('closed', () => {
        chatWindow = null;
    });
    chatWindow.webContents.on('did-finish-load', () => {
        syncStateToWindows();
    });
}

function showChatWindow(options = {}) {
    if (!chatWindow) return;
    const promptKey = typeof options === 'string' ? options : (options.promptKey || '');
    const viewMode = typeof options === 'string' ? '' : String(options.viewMode || '').trim();
    const resetDraft = typeof options === 'string' ? false : Boolean(options.resetDraft);
    if (promptKey) currentPromptKey = promptKey;
    const bounds = getChatPosition();
    chatWindow.setBounds(bounds);
    if (!chatWindow.isVisible()) {
        chatWindow.show();
    }
    if (chatWindow.isMinimized()) {
        chatWindow.restore();
    }
    chatWindow.focus();
    chatWindow.webContents.send('pet:open-chat', { promptKey: currentPromptKey, viewMode, resetDraft });
    syncStateToWindows();
}

function triggerPrompt(prompt) {
    currentPromptKey = prompt.key;
    markPromptSent(prompt.key);
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: `吉伊卡哇 · ${prompt.title}`,
            body: prompt.message,
            silent: false
        });
        notification.on('click', () => showChatWindow(prompt.key));
        notification.show();
    }
    petWindow?.webContents.send('pet:prompt', prompt);
    chatWindow?.webContents.send('pet:prompt', prompt);
    showChatWindow(prompt.key);
    if (prompt.key === 'euAdsReport') {
        prefetchEuAdsReport();
    }
}

async function requestEuAdsReport() {
    const url = String(process.env.YANJUN_MCP_URL || '').trim();
    if (!url) {
        return { error: '未配置领星网关', report: lastEuAdsReport };
    }
    try {
        const report = await fetchEuAdsDailyReport({ todayYmd: getDateKey() });
        lastEuAdsReport = report;
        return { report, error: '' };
    } catch (error) {
        return {
            error: error.message || '拉取欧洲广告日报失败',
            report: lastEuAdsReport
        };
    }
}

function prefetchEuAdsReport() {
    if (euAdsFetchInFlight) return euAdsFetchInFlight;
    euAdsFetchInFlight = requestEuAdsReport()
        .then((payload) => {
            chatWindow?.webContents.send('pet:eu-ads-report', payload);
            petWindow?.webContents.send('pet:eu-ads-report', payload);
            return payload;
        })
        .finally(() => {
            euAdsFetchInFlight = null;
        });
    return euAdsFetchInFlight;
}

function startReminderLoop() {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = setInterval(() => {
        const now = new Date();
        for (const prompt of PROMPTS) {
            if (!hasPromptBeenSent(prompt.key) && now >= reminderAt(prompt, now)) {
                triggerPrompt(prompt);
                break;
            }
        }
    }, 30000);
}

ipcMain.handle('pet:get-state', async () => ({
    ...getTodayState(),
    prompts: PROMPTS,
    currentPromptKey
}));

ipcMain.handle('pet:save-answer', async (_event, payload) => {
    const time = String(payload?.time || '').trim();
    const content = String(payload?.content || '').trim();
    if (!content) {
        throw new Error('请输入任务内容');
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
        throw new Error('请选择有效时间');
    }
    const record = saveTaskEntry({
        entryId: payload?.entryId,
        time,
        content
    });
    syncStateToWindows();
    return record;
});

ipcMain.handle('pet:fetch-eu-ads-report', async () => requestEuAdsReport());

ipcMain.handle('pet:copy-summary', async (_event, payload) => {
    const text = String(payload?.text || '').trim();
    const html = String(payload?.html || '').trim();
    if (!text && !html) {
        throw new Error('没有可复制的总结内容');
    }

    if (html) {
        await clipboard.write([
            new ClipboardItem({
                'text/plain': text,
                'text/html': html
            })
        ]);
    } else if (text) {
        await clipboard.writeText(text);
    }

    return true;
});

ipcMain.on('pet:open-chat', (_event, payload) => {
    showChatWindow({
        promptKey: payload?.promptKey || currentPromptKey || 'tasks',
        viewMode: payload?.viewMode || '',
        resetDraft: payload?.resetDraft
    });
});

ipcMain.on('pet:hide-chat', () => {
    chatWindow?.hide();
});

ipcMain.on('pet:activate-prompt', (_event, payload) => {
    const promptKey = String(payload?.promptKey || '').trim();
    if (!promptKey) return;
    currentPromptKey = promptKey;
    showChatWindow(promptKey);
});

ipcMain.on('pet:drag-window', (_event, payload) => {
    if (!petWindow) return;
    const nextX = Number(payload?.x);
    const nextY = Number(payload?.y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    const position = clampPetPosition(Math.round(nextX), Math.round(nextY));
    petWindow.setPosition(position.x, position.y);
    if (chatWindow?.isVisible()) {
        chatWindow.setBounds(getChatPosition());
    }
});

app.whenReady().then(() => {
    createTray();
    createPetWindow();
    createChatWindow();
    startReminderLoop();

    app.on('activate', () => {
        if (!petWindow) createPetWindow();
        if (!chatWindow) createChatWindow();
        showChatWindow(currentPromptKey || 'tasks');
    });
});

app.on('before-quit', () => {
    app.isQuitting = true;
    if (reminderTimer) clearInterval(reminderTimer);
});

app.on('window-all-closed', () => {
    // 托盘常驻，显式退出才结束。
});
