const els = {
    petBtn: document.getElementById('petBtn'),
    petBubble: document.getElementById('petBubble'),
    petDot: document.getElementById('petDot')
};

const state = {
    currentPromptKey: '',
    reminders: {},
    isDragging: false
};

let pointerStart = null;
let clickTimer = null;

function bubbleText(promptKey) {
    if (promptKey === 'euAdsReport') return '欧洲广告日报来了';
    if (promptKey === 'tasks') return '来记一条任务呀';
    if (promptKey === 'progress') return '再补一条任务呀';
    return '点我记任务呀';
}

function handlePointerMove(event) {
    if (!pointerStart) return;
    const deltaX = event.screenX - pointerStart.screenX;
    const deltaY = event.screenY - pointerStart.screenY;
    if (!state.isDragging && Math.abs(deltaX) + Math.abs(deltaY) > 4) {
        state.isDragging = true;
        els.petBtn.classList.add('dragging');
    }
    if (!state.isDragging) return;
    window.desktopPet.dragWindow({
        x: pointerStart.windowX + deltaX,
        y: pointerStart.windowY + deltaY
    });
}

function stopPointerDrag() {
    pointerStart = null;
    setTimeout(() => {
        state.isDragging = false;
        els.petBtn.classList.remove('dragging');
    }, 0);
    window.removeEventListener('mousemove', handlePointerMove);
    window.removeEventListener('mouseup', stopPointerDrag);
}

els.petBtn.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    pointerStart = {
        screenX: event.screenX,
        screenY: event.screenY,
        windowX: window.screenX,
        windowY: window.screenY
    };
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopPointerDrag);
});

els.petBtn.addEventListener('click', () => {
    if (state.isDragging) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
        window.desktopPet.openChat({
            promptKey: state.currentPromptKey || 'tasks',
            viewMode: 'edit',
            resetDraft: true
        });
        clickTimer = null;
    }, 220);
});

els.petBtn.addEventListener('dblclick', () => {
    if (state.isDragging) return;
    clearTimeout(clickTimer);
    clickTimer = null;
    window.desktopPet.openChat({
        promptKey: state.currentPromptKey || 'tasks',
        viewMode: 'preview'
    });
});

window.desktopPet.onPrompt((prompt) => {
    state.currentPromptKey = prompt.key;
    els.petBubble.textContent = prompt.question;
    els.petDot.classList.remove('hidden');
});

window.desktopPet.onStateUpdated((payload) => {
    state.currentPromptKey = payload.currentPromptKey || state.currentPromptKey || 'tasks';
    state.reminders = payload.reminders || {};
    els.petBubble.textContent = bubbleText(state.currentPromptKey);
    const hasPending = !((payload.record?.taskEntries || []).length);
    els.petDot.classList.toggle('hidden', !hasPending);
});
