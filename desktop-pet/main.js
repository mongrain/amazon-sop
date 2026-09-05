const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, Notification, Menu, Tray, nativeImage, screen, clipboard, ClipboardItem, protocol, net } = require('electron');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { mergeTaskEntries } = require('../service/desktop-pet-sync');
const { generateWeeklyReview } = require('../service/desktop-pet-weekly-review');

const RENDERER_ROOT = path.join(__dirname, 'renderer');
const PET_SCHEME = 'pet-app';

function parseVisibleHours(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const match = text.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!match) {
        console.warn(`[desktop-pet] DESKTOP_PET_VISIBLE_HOURS 格式无效「${text}」，将全天显示。正确示例：7:00-21:00`);
        return null;
    }
    const startH = Number(match[1]);
    const startM = Number(match[2]);
    const endH = Number(match[3]);
    const endM = Number(match[4]);
    if (startH > 23 || endH > 23 || startM > 59 || endM > 59) {
        console.warn(`[desktop-pet] DESKTOP_PET_VISIBLE_HOURS 时间越界「${text}」，将全天显示`);
        return null;
    }
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    if (start > end) {
        console.warn(`[desktop-pet] DESKTOP_PET_VISIBLE_HOURS 起始不能晚于结束「${text}」，将全天显示`);
        return null;
    }
    return { start, end };
}

// 开箱即用默认 07:00–21:00；可通过环境变量改为任意时段（也支持 21:00-07:00 跨夜）。
const PET_VISIBLE_HOURS = parseVisibleHours(process.env.DESKTOP_PET_VISIBLE_HOURS || '7:00-21:00');

const PET_MODEL_IDS = ['chiikawa', 'hachiware', 'usagi'];
const PET_MODEL_LABELS = {
    chiikawa: '小吉',
    hachiware: '小八',
    usagi: '乌萨奇'
};
const PET_MODEL_AVATARS = {
    chiikawa: '吉',
    hachiware: '八',
    usagi: '乌'
};

function getPetLabel(model = getTodayPetModel()) {
    return PET_MODEL_LABELS[model] || PET_MODEL_LABELS.chiikawa;
}

function parsePetModelPool(raw) {
    const text = String(raw || '').trim();
    if (!text) return [...PET_MODEL_IDS];
    const seen = new Set();
    const pool = [];
    for (const part of text.split(',')) {
        const id = part.trim().toLowerCase();
        if (!id) continue;
        if (!PET_MODEL_IDS.includes(id)) {
            console.warn(`[desktop-pet] DESKTOP_PET_MODELS 含未知模型「${part.trim()}」，已忽略`);
            continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        pool.push(id);
    }
    if (!pool.length) {
        console.warn('[desktop-pet] DESKTOP_PET_MODELS 无有效模型，回退 chiikawa');
        return ['chiikawa'];
    }
    return pool;
}

const PET_MODEL_POOL = parsePetModelPool(process.env.DESKTOP_PET_MODELS);

// 必须在 app ready 之前注册，才能用自定义协议安全加载本地 glTF，无需关闭 webSecurity。
protocol.registerSchemesAsPrivileged([
    {
        scheme: PET_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

function registerPetProtocol() {
    protocol.handle(PET_SCHEME, (request) => {
        const { pathname } = new URL(request.url);
        const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
        const filePath = path.normalize(path.join(RENDERER_ROOT, relativePath || 'pet.html'));
        const rootPrefix = RENDERER_ROOT.endsWith(path.sep) ? RENDERER_ROOT : `${RENDERER_ROOT}${path.sep}`;
        if (filePath !== RENDERER_ROOT && !filePath.startsWith(rootPrefix)) {
            return new Response('Forbidden', { status: 403 });
        }
        return net.fetch(pathToFileURL(filePath).href, { bypassCustomProtocolHandlers: true });
    });
}

const PROMPTS = [
    {
        key: 'euAdsReport',
        label: '',
        title: '欧洲站提醒',
        question: '记得查看一下欧洲站广告情况。',
        message: '记得查看欧洲站广告情况',
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
let wanderTimer = null;
let wanderTarget = null;
let wanderPausedUntil = 0;
let wanderCursor = null;
let wanderSegmentStartX = null;
let wanderSegmentGoalPx = 0;
let petHovered = false;
let currentPromptKey = '';
let loadedPetModelDate = '';

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

function getRecentDateKeys(days = 7) {
    const keys = [];
    const base = new Date();
    base.setHours(12, 0, 0, 0);
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date(base);
        date.setDate(base.getDate() - offset);
        keys.push(getDateKey(date));
    }
    return keys;
}

function getTodayPetModel() {
    const store = readStore();
    const date = getDateKey();
    const savedModel = String(store.appearance?.model || '');
    if (store.appearance?.date === date && PET_MODEL_POOL.includes(savedModel)) {
        return savedModel;
    }
    // 多角色时避免连续两天看起来完全没有变化。
    const candidates = PET_MODEL_POOL.length > 1
        ? PET_MODEL_POOL.filter((model) => model !== savedModel)
        : PET_MODEL_POOL;
    const model = candidates[Math.floor(Math.random() * candidates.length)];
    store.appearance = { date, model };
    writeStore(store);
    return model;
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

const DESKTOP_PET_API_URL = String(process.env.DESKTOP_PET_API_URL || '').trim().replace(/\/+$/, '');
const DESKTOP_PET_USERNAME = String(process.env.DESKTOP_PET_USERNAME || '').trim();
const DESKTOP_PET_PASSWORD = String(process.env.DESKTOP_PET_PASSWORD || '');
const desktopPetSyncConfigured = Boolean(DESKTOP_PET_API_URL && DESKTOP_PET_USERNAME && DESKTOP_PET_PASSWORD);
let desktopPetJwt = '';
let desktopPetSyncWarned = false;

async function desktopPetApi(pathname, options = {}) {
    const headers = {
        Accept: 'application/json',
        ...(options.headers || {})
    };
    if (options.body != null) {
        headers['Content-Type'] = 'application/json';
    }
    if (desktopPetJwt) {
        headers.Authorization = `Bearer ${desktopPetJwt}`;
    }
    const response = await fetch(`${DESKTOP_PET_API_URL}${pathname}`, {
        ...options,
        headers,
        body: options.body != null ? JSON.stringify(options.body) : undefined
    });
    return response;
}

async function loginDesktopPet(force = false) {
    if (!desktopPetSyncConfigured) return false;
    if (desktopPetJwt && !force) return true;
    const response = await desktopPetApi('/api/auth/login', {
        method: 'POST',
        body: {
            name: DESKTOP_PET_USERNAME,
            password: DESKTOP_PET_PASSWORD
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) {
        throw new Error(data.error || `登录失败 HTTP ${response.status}`);
    }
    desktopPetJwt = String(data.token);
    return true;
}

function writeTodayTaskEntries(date, entries) {
    const store = readStore();
    const next = normalizeRecord(date, {
        date,
        taskEntries: entries,
        updatedAt: new Date().toISOString()
    });
    store.records[date] = next;
    store.reminders[date] = store.reminders[date] || {};
    writeStore(store);
    return next;
}

async function syncTodayTasks() {
    if (!desktopPetSyncConfigured) {
        if (!desktopPetSyncWarned) {
            desktopPetSyncWarned = true;
            console.warn('[desktop-pet] 未配置 DESKTOP_PET_API_URL/USERNAME/PASSWORD，任务仅本地存储');
        }
        return getTodayState();
    }

    const date = getDateKey();
    const local = getTodayState();

    try {
        await loginDesktopPet(false);
        let response = await desktopPetApi(`/api/desktop-pet/tasks?date=${encodeURIComponent(date)}`, {
            method: 'GET'
        });
        if (response.status === 401) {
            await loginDesktopPet(true);
            response = await desktopPetApi(`/api/desktop-pet/tasks?date=${encodeURIComponent(date)}`, {
                method: 'GET'
            });
        }
        const remotePayload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(remotePayload.error || `拉取失败 HTTP ${response.status}`);
        }

        const merged = mergeTaskEntries(local.record.taskEntries, remotePayload.entries || []);
        writeTodayTaskEntries(date, merged);

        let putResponse = await desktopPetApi('/api/desktop-pet/tasks', {
            method: 'PUT',
            body: { date, entries: merged }
        });
        if (putResponse.status === 401) {
            await loginDesktopPet(true);
            putResponse = await desktopPetApi('/api/desktop-pet/tasks', {
                method: 'PUT',
                body: { date, entries: merged }
            });
        }
        const putPayload = await putResponse.json().catch(() => ({}));
        if (!putResponse.ok) {
            throw new Error(putPayload.error || `上传失败 HTTP ${putResponse.status}`);
        }

        const finalEntries = Array.isArray(putPayload.entries) ? putPayload.entries : merged;
        writeTodayTaskEntries(date, finalEntries);
        return getTodayState();
    } catch (error) {
        console.warn(`[desktop-pet] 账号同步失败，继续使用本地：${error.message || error}`);
        return local;
    }
}

async function getWeeklyTaskRecords() {
    const dates = getRecentDateKeys();
    const store = readStore();
    const records = [];

    for (const date of dates) {
        let entries = normalizeRecord(date, store.records?.[date] || {}).taskEntries;
        if (desktopPetSyncConfigured) {
            try {
                await loginDesktopPet(false);
                let response = await desktopPetApi(`/api/desktop-pet/tasks?date=${encodeURIComponent(date)}`, { method: 'GET' });
                if (response.status === 401) {
                    await loginDesktopPet(true);
                    response = await desktopPetApi(`/api/desktop-pet/tasks?date=${encodeURIComponent(date)}`, { method: 'GET' });
                }
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || `拉取失败 HTTP ${response.status}`);
                entries = mergeTaskEntries(entries, payload.entries || []);
                writeTodayTaskEntries(date, entries);
            } catch (error) {
                console.warn(`[desktop-pet] 周总结同步 ${date} 失败，使用本地记录：${error.message || error}`);
            }
        }
        records.push({ date, entries });
    }
    return records;
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

function getChatSyncPayload() {
    const petModel = getTodayPetModel();
    const petLabel = getPetLabel(petModel);
    return {
        ...getTodayState(),
        prompts: PROMPTS,
        currentPromptKey,
        petModel,
        petLabel,
        petAvatar: PET_MODEL_AVATARS[petModel] || PET_MODEL_AVATARS.chiikawa,
        petTitle: `${petLabel}来上班了`
    };
}

function syncStateToWindows() {
    const payload = getChatSyncPayload();
    petWindow?.webContents.send('pet:state-updated', payload);
    chatWindow?.webContents.send('pet:state-updated', payload);
}

function getPetPosition() {
    const display = screen.getPrimaryDisplay().workArea;
    const width = 88;
    const height = 88;
    return {
        x: display.x + display.width - width - 18,
        y: display.y + display.height - height - 18,
        width,
        height
    };
}

function toWindowCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

function getPetDisplayInfo() {
    if (!petWindow) {
        const display = screen.getPrimaryDisplay();
        return { display: display.workArea, scaleFactor: display.scaleFactor || 1, bounds: getPetPosition() };
    }
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({
        x: bounds.x + Math.round(bounds.width / 2),
        y: bounds.y + Math.round(bounds.height / 2)
    });
    return {
        display: display.workArea,
        scaleFactor: display.scaleFactor || 1,
        bounds: {
            ...bounds,
            x: toWindowCoord(bounds.x),
            y: toWindowCoord(bounds.y)
        }
    };
}

function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
}

function getWanderBounds() {
    const { display, bounds } = getPetDisplayInfo();
    const padding = 16;
    return {
        minX: display.x + padding,
        maxX: display.x + display.width - bounds.width - padding,
        y: toWindowCoord(bounds.y),
        x: toWindowCoord(bounds.x)
    };
}

function startWanderSegment() {
    if (!petWindow) return;
    const bounds = getWanderBounds();
    wanderSegmentStartX = bounds.x;
    wanderSegmentGoalPx = randomInt(300, 500);
    let direction = Math.random() < 0.5 ? -1 : 1;
    let targetX = wanderSegmentStartX + direction * wanderSegmentGoalPx;
    if (targetX < bounds.minX) {
        direction = 1;
        targetX = Math.min(bounds.maxX, wanderSegmentStartX + wanderSegmentGoalPx);
    } else if (targetX > bounds.maxX) {
        direction = -1;
        targetX = Math.max(bounds.minX, wanderSegmentStartX - wanderSegmentGoalPx);
    }
    targetX = Math.max(bounds.minX, Math.min(targetX, bounds.maxX));
    wanderTarget = { x: toWindowCoord(targetX), y: bounds.y };
    wanderCursor = { x: bounds.x, y: bounds.y };
}

function finishWanderSegment() {
    wanderPausedUntil = Date.now() + randomInt(60, 180) * 1000;
    wanderTarget = null;
    wanderSegmentStartX = null;
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('pet:walking', { moving: false });
    }
}

function startPetWander() {
    if (wanderTimer) clearInterval(wanderTimer);
    wanderTimer = setInterval(() => {
        if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || chatWindow?.isVisible() || petHovered || Date.now() < wanderPausedUntil) {
            if (petWindow && !petWindow.isDestroyed()) {
                petWindow.webContents.send('pet:walking', { moving: false });
            }
            return;
        }
        const { bounds } = getPetDisplayInfo();
        if (!wanderTarget) {
            startWanderSegment();
        }
        if (!wanderTarget || wanderSegmentStartX == null) return;

        if (!wanderCursor
            || Math.abs(wanderCursor.x - bounds.x) > 2
            || Math.abs(wanderCursor.y - bounds.y) > 2) {
            wanderCursor = { x: bounds.x, y: bounds.y };
        }

        const dx = wanderTarget.x - wanderCursor.x;
        if (Math.abs(dx) < 1) {
            finishWanderSegment();
            return;
        }

        const stepDip = 1;
        const prevX = bounds.x;
        const next = clampPetPosition(
            wanderCursor.x + Math.sign(dx) * Math.min(Math.abs(dx), stepDip),
            wanderTarget.y
        );
        const x = toWindowCoord(next.x);
        const y = toWindowCoord(next.y);
        wanderCursor = { x, y };

        const walkedPx = Math.abs(x - wanderSegmentStartX);
        const stuckAtEdge = x === prevX && Math.abs(dx) >= 1;
        if (walkedPx >= wanderSegmentGoalPx || stuckAtEdge) {
            finishWanderSegment();
            if (x !== prevX) {
                petWindow.setPosition(x, y);
            }
            return;
        }

        if (x !== bounds.x || y !== bounds.y) {
            petWindow.setPosition(x, y);
        }
        petWindow.webContents.send('pet:walking', { moving: true, direction: dx >= 0 ? 'right' : 'left' });
    }, 64);
}

function getChatPosition(viewMode = '') {
    const petBounds = petWindow ? petWindow.getBounds() : getPetPosition();
    const width = 360;
    const height = currentPromptKey === 'euAdsReport' ? 220 : (viewMode === 'preview' ? 700 : 280);
    const display = screen.getDisplayNearestPoint({
        x: petBounds.x + Math.round(petBounds.width / 2),
        y: petBounds.y + Math.round(petBounds.height / 2)
    }).workArea;
    const gap = 6;
    const margin = 8;
    // 水平以桌宠中心对齐，避免聊天窗整体偏到一侧显得很远。
    const petCenterX = petBounds.x + petBounds.width / 2;
    let x = petCenterX - width / 2;
    x = Math.max(display.x + margin, Math.min(x, display.x + display.width - width - margin));

    const belowY = petBounds.y + petBounds.height + gap;
    const aboveY = petBounds.y - height - gap;
    const canPlaceAbove = aboveY >= display.y + margin;
    const canPlaceBelow = belowY + height <= display.y + display.height - margin;
    // 桌宠多在底部：优先贴在上方；上方不够再放下边。
    let y;
    if (canPlaceAbove) y = aboveY;
    else if (canPlaceBelow) y = belowY;
    else y = Math.max(display.y + margin, Math.min(aboveY, display.y + display.height - height - margin));

    return {
        x: Math.round(x),
        y: Math.round(y),
        width,
        height
    };
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
    tray.setToolTip(`${getPetLabel()}工作宠物`);
    tray.on('double-click', () => showChatWindow(currentPromptKey || 'tasks'));
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开聊天框', click: () => showChatWindow(currentPromptKey || 'tasks') },
        { label: '欧洲站提醒', click: () => showChatWindow('euAdsReport') },
        {
            label: '隐藏聊天框',
            click: () => {
                chatWindow?.hide();
                petWindow?.webContents.send('pet:chat-visibility', { visible: false });
            }
        },
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

    loadPetModelForToday();
    petWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 2) {
            console.error(`[桌宠渲染 ${sourceId}:${line}] ${message}`);
        }
    });
    petWindow.once('ready-to-show', () => {
        if (!isPetHiddenForToday()) {
            petWindow.show();
            petWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        syncStateToWindows();
    });
    petWindow.on('closed', () => {
        petWindow = null;
    });
}

function loadPetModelForToday() {
    if (!petWindow || petWindow.isDestroyed()) return;
    const date = getDateKey();
    const model = getTodayPetModel();
    loadedPetModelDate = date;
    petWindow.loadURL(`${PET_SCHEME}://localhost/pet.html?model=${encodeURIComponent(model)}`);
}

function refreshPetModelForNewDay() {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (loadedPetModelDate !== getDateKey()) {
        loadPetModelForToday();
    }
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
            petWindow?.webContents.send('pet:chat-visibility', { visible: false });
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
    if (isPetHiddenForToday()) return;
    if (!chatWindow) return;
    const promptKey = typeof options === 'string' ? options : (options.promptKey || '');
    const viewMode = typeof options === 'string' ? '' : String(options.viewMode || '').trim();
    const resetDraft = typeof options === 'string' ? false : Boolean(options.resetDraft);
    if (promptKey) currentPromptKey = promptKey;
    const bounds = getChatPosition(viewMode);
    chatWindow.setBounds(bounds);
    if (!chatWindow.isVisible()) {
        chatWindow.show();
    }
    if (chatWindow.isMinimized()) {
        chatWindow.restore();
    }
    chatWindow.focus();
    chatWindow.webContents.send('pet:open-chat', { promptKey: currentPromptKey, viewMode, resetDraft });
    petWindow?.webContents.send('pet:chat-visibility', { visible: true });
    petWindow?.webContents.send('pet:walking', { moving: false });
    syncStateToWindows();
}

function triggerPrompt(prompt) {
    currentPromptKey = prompt.key;
    markPromptSent(prompt.key);
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: `${getPetLabel()} · ${prompt.title}`,
            body: prompt.message,
            silent: false
        });
        notification.on('click', () => showChatWindow(prompt.key));
        notification.show();
    }
    petWindow?.webContents.send('pet:prompt', prompt);
    chatWindow?.webContents.send('pet:prompt', prompt);
    showChatWindow(prompt.key);
}

function startReminderLoop() {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = setInterval(() => {
        const now = new Date();
        applyPetSchedule(now);
        if (isPetHiddenForToday(now)) return;
        for (const prompt of PROMPTS) {
            if (!hasPromptBeenSent(prompt.key) && now >= reminderAt(prompt, now)) {
                triggerPrompt(prompt);
                break;
            }
        }
    }, 30000);
}

function isPetHiddenForToday(now = new Date()) {
    if (!PET_VISIBLE_HOURS) return false;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const { start, end } = PET_VISIBLE_HOURS;
    const isVisible = start <= end
        ? minutes >= start && minutes <= end
        : minutes >= start || minutes <= end;
    return !isVisible;
}

function applyPetSchedule(now = new Date()) {
    refreshPetModelForNewDay();
    if (isPetHiddenForToday(now)) {
        petWindow?.hide();
        chatWindow?.hide();
        petWindow?.webContents.send('pet:chat-visibility', { visible: false });
        return;
    }
    if (petWindow && !petWindow.isVisible()) {
        petWindow.showInactive();
    }
}

ipcMain.handle('pet:get-state', async () => {
    await syncTodayTasks();
    return getChatSyncPayload();
});

ipcMain.handle('pet:save-answer', async (_event, payload) => {
    const time = String(payload?.time || '').trim();
    const content = String(payload?.content || '').trim();
    if (!content) {
        throw new Error('请输入任务内容');
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
        throw new Error('请选择有效时间');
    }
    saveTaskEntry({
        entryId: payload?.entryId,
        time,
        content
    });
    const synced = await syncTodayTasks();
    syncStateToWindows();
    return synced.record;
});

ipcMain.handle('pet:generate-weekly-summary', async () => {
    const days = await getWeeklyTaskRecords();
    return generateWeeklyReview(days);
});

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
    petWindow?.webContents.send('pet:chat-visibility', { visible: false });
});

ipcMain.on('pet:activate-prompt', (_event, payload) => {
    const promptKey = String(payload?.promptKey || '').trim();
    if (!promptKey) return;
    currentPromptKey = promptKey;
    showChatWindow(promptKey);
});

ipcMain.on('pet:drag-window', (_event, payload) => {
    if (!petWindow) return;
    const bounds = petWindow.getBounds();
    const deltaX = Number(payload?.deltaX);
    const deltaY = Number(payload?.deltaY);
    let nextX;
    let nextY;
    if (Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
        nextX = bounds.x + deltaX;
        nextY = bounds.y + deltaY;
    } else {
        nextX = Number(payload?.x);
        nextY = Number(payload?.y);
        if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    }
    const position = clampPetPosition(toWindowCoord(nextX), toWindowCoord(nextY));
    wanderPausedUntil = Date.now() + 3000;
    wanderTarget = null;
    wanderSegmentStartX = null;
    wanderCursor = { x: position.x, y: position.y };
    petWindow.webContents.send('pet:walking', { moving: false });
    petWindow.setPosition(position.x, position.y);
    if (chatWindow?.isVisible()) {
        chatWindow.setBounds(getChatPosition());
    }
});

ipcMain.on('pet:pause-wander', () => {
    wanderPausedUntil = Date.now() + 3000;
    wanderTarget = null;
    wanderSegmentStartX = null;
    wanderCursor = null;
    petWindow?.webContents.send('pet:walking', { moving: false });
});

ipcMain.on('pet:hover-state', (_event, payload) => {
    petHovered = Boolean(payload?.hovering);
    if (petHovered) {
        wanderTarget = null;
        wanderSegmentStartX = null;
    }
});

app.whenReady().then(async () => {
    registerPetProtocol();
    createTray();
    createPetWindow();
    createChatWindow();
    await syncTodayTasks();
    syncStateToWindows();
    startReminderLoop();
    startPetWander();
    applyPetSchedule();

    app.on('activate', () => {
        if (!petWindow) createPetWindow();
        if (!chatWindow) createChatWindow();
        showChatWindow(currentPromptKey || 'tasks');
    });
});

app.on('before-quit', () => {
    app.isQuitting = true;
    if (reminderTimer) clearInterval(reminderTimer);
    if (wanderTimer) clearInterval(wanderTimer);
});

app.on('window-all-closed', () => {
    // 托盘常驻，显式退出才结束。
});
