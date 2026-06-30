<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
    agents: { type: Array, default: () => [] },
    tasks: { type: Array, default: () => [] },
    selectedAgentId: { type: String, default: '' }
});

const emit = defineEmits(['select-agent']);

const STATUS_TEXT = {
    idle: '待命中…',
    busy: '工作中',
    reviewing: '审核中…'
};

const ZONES = {
    boss: { x: 50, y: 18, label: '总经理室' },
    supervisor: { x: 28, y: 44, label: '审核台' },
    designer: { x: 14, y: 72, label: '设计工位' },
    analyst: { x: 50, y: 72, label: '数据工位' },
    researcher: { x: 86, y: 72, label: '调研工位' }
};

const POIS = [
    { id: 'coffee', x: 50, y: 56, label: '咖啡角' },
    { id: 'center', x: 50, y: 36, label: '讨论区' },
    { id: 'window', x: 76, y: 26, label: '窗边' },
    { id: 'plant', x: 10, y: 30, label: '绿植旁' }
];

const CHAT_SCRIPTS = [
    {
        pair: ['designer', 'analyst'],
        lines: [
            { from: 'designer', text: '主图配色有数据支撑吗？' },
            { from: 'analyst', text: '刚拉了 CTR 趋势，发你！' },
            { from: 'designer', text: '好，我按转化高的色系改一版' }
        ]
    },
    {
        pair: ['researcher', 'boss'],
        lines: [
            { from: 'researcher', text: '竞品本周又降价了' },
            { from: 'boss', text: '整理三点结论，下午碰一下' },
            { from: 'researcher', text: '收到，我马上汇总' }
        ]
    },
    {
        pair: ['supervisor', 'designer'],
        lines: [
            { from: 'supervisor', text: '这版 Listing 图再突出卖点' },
            { from: 'designer', text: 'OK，我加强对比和文字层级' }
        ]
    },
    {
        pair: ['analyst', 'researcher'],
        lines: [
            { from: 'analyst', text: '关键词搜索量涨了不少' },
            { from: 'researcher', text: '和竞品促销时间对上了' }
        ]
    },
    {
        pair: ['boss', 'supervisor'],
        lines: [
            { from: 'boss', text: '今天的任务拆分好了吗？' },
            { from: 'supervisor', text: '子任务都在跑，我在跟审核' }
        ]
    }
];

const AGENT_ORDER = ['boss', 'supervisor', 'designer', 'analyst', 'researcher'];

const walkers = ref({});
const activeChat = ref(null);
let walkTimer = null;
let chatTimer = null;
let chatLineTimer = null;

const sortedAgents = computed(() => {
    const map = new Map(props.agents.map(a => [a.code, a]));
    return AGENT_ORDER.map(code => map.get(code)).filter(Boolean);
});

function homeOf(code) {
    return ZONES[code] || { x: 50, y: 50, label: '工位' };
}

function initWalkers() {
    const next = { ...walkers.value };
    for (const agent of sortedAgents.value) {
        const home = homeOf(agent.code);
        if (!next[agent.code]) {
            next[agent.code] = {
                x: home.x,
                y: home.y,
                moving: false,
                facingRight: true,
                chatLine: null,
                chatRole: null,
                activity: 'desk'
            };
        }
    }
    walkers.value = next;
}

function syncWalkerToDesk(agent) {
    const home = homeOf(agent.code);
    const w = walkers.value[agent.code];
    if (!w) return;
    w.x = home.x;
    w.y = home.y;
    w.targetX = home.x;
    w.targetY = home.y;
    w.moving = false;
    w.activity = 'desk';
    w.chatLine = null;
    w.chatRole = null;
}

function isAgentIdle(agent) {
    return (agent.status || 'idle') === 'idle';
}

function isSelected(agent) {
    return props.selectedAgentId === String(agent.id);
}

function taskBubble(agent) {
    const activeTask = props.tasks.find(
        t => String(t.assigned_agent_id || '') === String(agent.id) && t.status === 'IN_PROGRESS'
    );
    if (activeTask) {
        const title = String(activeTask.title || '');
        return title.length > 12 ? title.slice(0, 12) + '…' : title;
    }
    if (agent.code === 'supervisor' && agent.status === 'reviewing') {
        const reviewing = props.tasks.find(t => t.status === 'PENDING_REVIEW');
        if (reviewing) {
            const title = String(reviewing.title || '');
            return '审：' + (title.length > 8 ? title.slice(0, 8) + '…' : title);
        }
    }
    return STATUS_TEXT[agent.status] || STATUS_TEXT.idle;
}

function bubbleText(agent) {
    const w = walkers.value[agent.code];
    if (w && w.chatLine) return w.chatLine;
    if (!isAgentIdle(agent)) return taskBubble(agent);
    if (w && w.activity === 'walk') return '去逛逛…';
    return STATUS_TEXT.idle;
}

function bubbleClass(agent) {
    const w = walkers.value[agent.code];
    if (w && w.chatLine) {
        return w.chatRole === 'self' ? 'speech-bubble--chat-self' : 'speech-bubble--chat-other';
    }
    if (!isAgentIdle(agent)) return 'speech-bubble--work';
    return 'speech-bubble--idle';
}

function walkerStyle(agent) {
    const w = walkers.value[agent.code] || homeOf(agent.code);
    return {
        left: w.x + '%',
        top: w.y + '%',
        zIndex: w.moving || (w.chatLine && activeChat.value) ? 8 : 5
    };
}

function isAtHome(agent) {
    const w = walkers.value[agent.code];
    const home = homeOf(agent.code);
    if (!w) return true;
    return Math.abs(w.x - home.x) < 1 && Math.abs(w.y - home.y) < 1 && !w.moving;
}

function moveWalker(code, x, y, activity) {
    const w = walkers.value[code];
    if (!w) return;
    w.targetX = x;
    w.targetY = y;
    w.facingRight = x >= w.x;
    w.moving = true;
    w.activity = activity || 'walk';
    w.x = x;
    w.y = y;
}

function pickRandomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function scheduleIdleWalk() {
    const idleAgents = sortedAgents.value.filter(a => {
        const w = walkers.value[a.code];
        return isAgentIdle(a) && w && w.activity === 'desk' && !w.moving && isAtHome(a) && !activeChat.value;
    });
    if (!idleAgents.length) return;

    const agent = pickRandomItem(idleAgents);
    const poi = pickRandomItem(POIS);
    moveWalker(agent.code, poi.x, poi.y, 'walk');

    setTimeout(() => {
        const w = walkers.value[agent.code];
        if (!w || !isAgentIdle(agent) || activeChat.value) return;
        moveWalker(agent.code, homeOf(agent.code).x, homeOf(agent.code).y, 'desk');
    }, 3200);
}

function clearChatTimers() {
    if (chatLineTimer) {
        clearInterval(chatLineTimer);
        chatLineTimer = null;
    }
}

function endChat() {
    clearChatTimers();
    const chat = activeChat.value;
    if (chat) {
        for (const code of chat.codes) {
            const agent = sortedAgents.value.find(a => a.code === code);
            if (agent && isAgentIdle(agent)) {
                moveWalker(code, homeOf(code).x, homeOf(code).y, 'desk');
            }
            const w = walkers.value[code];
            if (w) {
                w.chatLine = null;
                w.chatRole = null;
            }
        }
    }
    activeChat.value = null;
}

function startChat() {
    if (activeChat.value) return;

    const idleAgents = sortedAgents.value.filter(a => isAgentIdle(a) && isAtHome(a));
    if (idleAgents.length < 2) return;

    let script = pickRandomItem(CHAT_SCRIPTS);
    const a = sortedAgents.value.find(x => x.code === script.pair[0]);
    const b = sortedAgents.value.find(x => x.code === script.pair[1]);
    if (!a || !b || !isAgentIdle(a) || !isAgentIdle(b)) {
        const codes = idleAgents.map(x => x.code);
        const c1 = pickRandomItem(idleAgents);
        const c2 = pickRandomItem(idleAgents.filter(x => x.code !== c1.code));
        if (!c2) return;
        script = {
            pair: [c1.code, c2.code],
            lines: [
                { from: c1.code, text: '忙完一起对一下？' },
                { from: c2.code, text: '行，我这边快好了' }
            ]
        };
    }

    const codeA = script.pair[0];
    const codeB = script.pair[1];
    const meet = {
        x: Math.round((homeOf(codeA).x + homeOf(codeB).x) / 2),
        y: Math.round((homeOf(codeA).y + homeOf(codeB).y) / 2 - 6)
    };

    activeChat.value = { codes: [codeA, codeB], lineIndex: -1, script };

    moveWalker(codeA, meet.x - 4, meet.y, 'chat');
    moveWalker(codeB, meet.x + 4, meet.y, 'chat');

    let lineIndex = 0;
    const showLine = () => {
        if (!activeChat.value) return;
        const line = script.lines[lineIndex];
        if (!line) {
            setTimeout(endChat, 1800);
            return;
        }
        for (const code of [codeA, codeB]) {
            const w = walkers.value[code];
            if (!w) continue;
            if (code === line.from) {
                w.chatLine = line.text;
                w.chatRole = 'self';
            } else {
                w.chatLine = '…';
                w.chatRole = 'other';
            }
        }
        lineIndex += 1;
    };

    setTimeout(showLine, 800);
    chatLineTimer = setInterval(() => {
        if (lineIndex >= script.lines.length) {
            clearChatTimers();
            setTimeout(endChat, 2000);
            return;
        }
        showLine();
    }, 2600);
}

function onSelect(agent) {
    emit('select-agent', agent.id);
}

watch(() => props.agents, (agents) => {
    initWalkers();
    for (const agent of agents) {
        if (!isAgentIdle(agent)) {
            if (activeChat.value && activeChat.value.codes.includes(agent.code)) {
                endChat();
            }
            syncWalkerToDesk(agent);
        }
    }
}, { deep: true, immediate: true });

onMounted(() => {
    initWalkers();
    walkTimer = setInterval(scheduleIdleWalk, 7000);
    chatTimer = setInterval(startChat, 16000);
    setTimeout(startChat, 4000);
});

onUnmounted(() => {
    if (walkTimer) clearInterval(walkTimer);
    if (chatTimer) clearInterval(chatTimer);
    clearChatTimers();
});
</script>

<template>
    <div class="ai-office-scene">
        <div class="scene-header">
            <div class="scene-title">🏢 AI 办公室 · 小镇模式</div>
            <div class="scene-hint">同事会走动聊天 · 点击角色筛选任务 · 忙碌时回到工位</div>
        </div>

        <div class="scene-floor">
            <div class="floor-tile" aria-hidden="true"></div>
            <div class="scene-decor plant plant-a">🪴</div>
            <div class="scene-decor plant plant-b">🌿</div>

            <div
                v-for="poi in POIS"
                :key="poi.id"
                class="poi-marker"
                :style="{ left: poi.x + '%', top: poi.y + '%' }"
                :title="poi.label"
            >
                <span v-if="poi.id === 'coffee'">☕</span>
                <span v-else-if="poi.id === 'center'">💬</span>
                <span v-else-if="poi.id === 'window'">🪟</span>
                <span v-else>🌿</span>
            </div>

            <button
                v-for="agent in sortedAgents"
                :key="'desk-' + agent.id"
                type="button"
                class="desk-zone"
                :class="[
                    'desk-zone--' + agent.code,
                    { 'desk-zone--selected': isSelected(agent), 'desk-zone--away': !isAtHome(agent) && isAgentIdle(agent) }
                ]"
                :style="{ left: homeOf(agent.code).x + '%', top: (homeOf(agent.code).y + 8) + '%' }"
                @click="onSelect(agent)"
            >
                <div class="desk">
                    <div class="desk-surface"></div>
                    <div class="desk-items">
                        <span v-if="agent.code === 'boss'" class="desk-item">📊</span>
                        <span v-else-if="agent.code === 'supervisor'" class="desk-item">✅</span>
                        <span v-else-if="agent.code === 'designer'" class="desk-item">🖌️</span>
                        <span v-else-if="agent.code === 'analyst'" class="desk-item">📈</span>
                        <span v-else class="desk-item">🔎</span>
                    </div>
                </div>
                <div class="desk-zone-label">
                    <strong>{{ agent.name }}</strong>
                    <span>{{ homeOf(agent.code).label }}</span>
                </div>
            </button>

            <button
                v-for="agent in sortedAgents"
                :key="'walker-' + agent.id"
                type="button"
                class="walker"
                :class="[
                    'walker--' + agent.code,
                    'walker--' + (agent.status || 'idle'),
                    {
                        'walker--moving': walkers[agent.code] && walkers[agent.code].moving,
                        'walker--selected': isSelected(agent),
                        'walker--flip': walkers[agent.code] && !walkers[agent.code].facingRight
                    }
                ]"
                :style="walkerStyle(agent)"
                @click="onSelect(agent)"
            >
                <div class="speech-bubble" :class="bubbleClass(agent)">{{ bubbleText(agent) }}</div>
                <div class="character-shadow"></div>
                <div class="character" :class="'character--' + (agent.status || 'idle')">
                    <span class="character-emoji">{{ agent.avatar_emoji || '🤖' }}</span>
                    <span v-if="agent.status === 'busy'" class="typing-dots"><i></i><i></i><i></i></span>
                </div>
                <div v-if="!isAgentIdle(agent)" class="walker-stats">
                    <span v-if="agent.active_tasks">⚡{{ agent.active_tasks }}</span>
                </div>
            </button>

            <div v-if="activeChat" class="chat-link" aria-hidden="true"></div>
        </div>

        <div class="scene-legend">
            <span><i class="dot dot-idle"></i> 空闲走动</span>
            <span><i class="dot dot-busy"></i> 忙碌</span>
            <span><i class="dot dot-review"></i> 审核</span>
            <span><i class="dot dot-chat"></i> 同事对话</span>
        </div>
    </div>
</template>

<style scoped>
.ai-office-scene {
    --floor: #e8dcc8;
    --wall: #f5f0e8;
    --accent: #409eff;
    --busy: #e6a23c;
    --review: #67c23a;
    --chat: #9b59b6;
    background: linear-gradient(180deg, var(--wall) 0%, #ebe3d5 100%);
    border-radius: 12px;
    border: 1px solid #dcdfe6;
    overflow: hidden;
    margin-bottom: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
}

.scene-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    background: rgba(255, 255, 255, 0.5);
}

.scene-title { font-weight: 700; font-size: 15px; color: #303133; }
.scene-hint { font-size: 12px; color: #909399; }

.scene-floor {
    position: relative;
    min-height: 340px;
    padding: 16px 20px 24px;
    background:
        repeating-linear-gradient(90deg, transparent, transparent 31px, rgba(0,0,0,0.03) 31px, rgba(0,0,0,0.03) 32px),
        repeating-linear-gradient(0deg, transparent, transparent 31px, rgba(0,0,0,0.03) 31px, rgba(0,0,0,0.03) 32px),
        var(--floor);
}

.floor-tile {
    position: absolute;
    inset: 12px;
    border: 2px dashed rgba(0, 0, 0, 0.06);
    border-radius: 8px;
    pointer-events: none;
}

.scene-decor {
    position: absolute;
    font-size: 20px;
    opacity: 0.85;
    pointer-events: none;
    z-index: 1;
}

.plant-a { top: 14px; left: 6px; }
.plant-b { top: 14px; right: 6px; }

.poi-marker {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 18px;
    opacity: 0.55;
    pointer-events: none;
    z-index: 1;
    filter: grayscale(0.2);
}

.desk-zone {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px;
    border: 2px solid transparent;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    font: inherit;
    color: inherit;
}

.desk-zone:hover { background: rgba(255,255,255,0.25); }
.desk-zone--selected {
    border-color: var(--accent);
    background: rgba(64,158,255,0.06);
}
.desk-zone--away { opacity: 0.72; }

.desk-zone--boss .desk-surface {
    width: 84px;
    background: linear-gradient(180deg, #8b6914 0%, #6b4f12 100%);
}

.desk { position: relative; margin-bottom: 2px; }

.desk-surface {
    width: 68px;
    height: 10px;
    background: linear-gradient(180deg, #a67c52 0%, #8b6914 100%);
    border-radius: 2px;
    box-shadow: 0 2px 0 #5c4a2e;
}

.desk-items {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
}

.desk-zone-label {
    text-align: center;
    line-height: 1.25;
    margin-top: 2px;
}

.desk-zone-label strong { display: block; font-size: 11px; color: #606266; }
.desk-zone-label span { font-size: 10px; color: #909399; }

.walker {
    position: absolute;
    transform: translate(-50%, -100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: left 2.6s ease-in-out, top 2.6s ease-in-out;
    font: inherit;
    color: inherit;
}

.walker--moving { transition-duration: 2.8s; }
.walker--moving .character-emoji { animation: walk-bob 0.35s ease-in-out infinite alternate; }
.walker--flip .character-emoji { transform: scaleX(-1); }

.walker--selected .character-emoji {
    filter: drop-shadow(0 0 6px rgba(64,158,255,0.6));
}

@keyframes walk-bob {
    from { transform: translateY(0) rotate(-3deg); }
    to { transform: translateY(-3px) rotate(3deg); }
}

.walker--flip.walker--moving .character-emoji {
    animation-name: walk-bob-flip;
}

@keyframes walk-bob-flip {
    from { transform: scaleX(-1) translateY(0) rotate(-3deg); }
    to { transform: scaleX(-1) translateY(-3px) rotate(3deg); }
}

.character-shadow {
    width: 22px;
    height: 6px;
    background: rgba(0,0,0,0.12);
    border-radius: 50%;
    margin-bottom: -2px;
}

.walker--moving .character-shadow {
    animation: shadow-pulse 0.35s ease-in-out infinite alternate;
}

@keyframes shadow-pulse {
    from { transform: scaleX(1); opacity: 0.12; }
    to { transform: scaleX(0.85); opacity: 0.08; }
}

.speech-bubble {
    position: relative;
    max-width: 130px;
    padding: 5px 9px;
    margin-bottom: 4px;
    background: #fff;
    border: 1px solid #dcdfe6;
    border-radius: 12px;
    font-size: 11px;
    color: #303133;
    line-height: 1.35;
    text-align: center;
    box-shadow: 0 2px 10px rgba(0,0,0,0.08);
    animation: bubble-pop 0.35s ease-out;
}

.speech-bubble::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: #fff;
    border-bottom: 0;
}

.speech-bubble--idle { animation: bubble-float 2.5s ease-in-out infinite; }
.speech-bubble--work { border-color: #f5dab1; background: #fdf6ec; }
.speech-bubble--work::after { border-top-color: #fdf6ec; }
.speech-bubble--chat-self {
    border-color: #c6e2ff;
    background: #ecf5ff;
    animation: bubble-pop 0.3s ease-out;
}
.speech-bubble--chat-self::after { border-top-color: #ecf5ff; }
.speech-bubble--chat-other {
    border-color: #e1d5f0;
    background: #f5f0fa;
    color: #909399;
    font-size: 10px;
    padding: 4px 8px;
}
.speech-bubble--chat-other::after { border-top-color: #f5f0fa; }

@keyframes bubble-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
}

@keyframes bubble-pop {
    from { transform: scale(0.85); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

.character { position: relative; }

.character-emoji {
    display: block;
    font-size: 34px;
    line-height: 1;
    filter: drop-shadow(0 2px 2px rgba(0,0,0,0.15));
    transition: transform 0.2s;
}

.walker:not(.walker--moving) .character--idle .character-emoji {
    animation: idle-bob 2s ease-in-out infinite;
}

.character--busy .character-emoji { animation: busy-work 0.4s ease-in-out infinite alternate; }
.character--reviewing .character-emoji { animation: review-scan 1.2s ease-in-out infinite; }

@keyframes idle-bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
}

@keyframes busy-work {
    from { transform: translateY(0) rotate(-2deg); }
    to { transform: translateY(-2px) rotate(2deg); }
}

@keyframes review-scan {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-3px); }
    75% { transform: translateX(3px); }
}

.typing-dots {
    position: absolute;
    right: -6px;
    top: 2px;
    display: flex;
    gap: 2px;
}

.typing-dots i {
    display: block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--busy);
    animation: dot-blink 1s infinite;
}

.typing-dots i:nth-child(2) { animation-delay: 0.15s; }
.typing-dots i:nth-child(3) { animation-delay: 0.3s; }

@keyframes dot-blink {
    0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-3px); }
}

.walker-stats {
    font-size: 10px;
    color: #606266;
    margin-top: 2px;
}

.scene-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 10px 16px;
    border-top: 1px solid rgba(0,0,0,0.06);
    background: rgba(255,255,255,0.45);
    font-size: 12px;
    color: #606266;
}

.scene-legend span { display: inline-flex; align-items: center; gap: 6px; }

.dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.dot-idle { background: #909399; }
.dot-busy { background: var(--busy); }
.dot-review { background: var(--review); }
.dot-chat { background: var(--chat); }

@media (max-width: 700px) {
    .scene-floor { min-height: 380px; }
    .speech-bubble { max-width: 100px; font-size: 10px; }
    .character-emoji { font-size: 28px; }
}
</style>
