import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const els = {
    petBtn: document.getElementById('petBtn'),
    petBubble: document.getElementById('petBubble'),
    petDot: document.getElementById('petDot'),
    petCanvas: document.getElementById('petCanvas'),
    petStatus: document.getElementById('petStatus')
};

const state = {
    currentPromptKey: '',
    reminders: {},
    isDragging: false,
    isHovering: false,
    isChatOpen: false,
    isMoving: false
};

let pointerStart = null;
let clickTimer = null;
let petModel = null;
let walkDirection = 'left';
let animBobY = 0;
let animRotX = 0;
let animRotZ = 0;
let animRotY = 0;

function showPetError(message) {
    console.error(message);
    els.petStatus.textContent = '模型加载失败';
    els.petStatus.hidden = false;
}

function startThreePet() {
    const renderer = new THREE.WebGLRenderer({
        canvas: els.petCanvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
    camera.position.set(0, 0.38, 2.45);
    const petRoot = new THREE.Group();
    scene.add(petRoot);

    new GLTFLoader().load('./scene.gltf', (gltf) => {
        gltf.scene.traverse((node) => {
            if (node.name.startsWith('Hachiware') || node.name.startsWith('Usagi') || node.name.startsWith('Mouth.003') || node.name.startsWith('Eyes.002')) {
                node.visible = false;
            }
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        gltf.scene.position.sub(center);
        gltf.scene.position.y += size.y / 2;
        petRoot.add(gltf.scene);
        petModel = petRoot;
    }, undefined, (error) => showPetError(`无法加载 Chiikawa 模型：${error?.message || error}`));

    function render(now) {
        const width = els.petCanvas.clientWidth;
        const height = els.petCanvas.clientHeight;
        if (els.petCanvas.width !== width * renderer.getPixelRatio() || els.petCanvas.height !== height * renderer.getPixelRatio()) {
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        if (petModel) {
            const walking = state.isMoving && !state.isDragging && !state.isHovering && !state.isChatOpen;
            const gait = now * 0.00275;
            const targetBob = walking ? Math.abs(Math.sin(now * 0.0035)) * 0.022 : 0;
            // 模型没有独立头部骨骼，使用头身轻转向表达左右看；原始正面轴与屏幕 X 相反。
            const walkingTurn = THREE.MathUtils.degToRad(12);
            const targetTurn = walking ? (walkDirection === 'right' ? walkingTurn : -walkingTurn) : 0;
            const targetRotX = walking ? Math.sin(gait * 1.7) * 0.055 : 0;
            const targetRotZ = walking ? Math.sin(gait) * 0.04 : 0;
            // 平滑插值，避免行走开关与转向时出现跳帧感。
            const ease = walking ? 0.12 : 0.18;
            animBobY = THREE.MathUtils.lerp(animBobY, targetBob, ease);
            animRotY = THREE.MathUtils.lerp(animRotY, targetTurn, ease);
            animRotX = THREE.MathUtils.lerp(animRotX, targetRotX, ease);
            animRotZ = THREE.MathUtils.lerp(animRotZ, targetRotZ, ease);
            petModel.position.y = animBobY;
            petModel.rotation.y = animRotY;
            petModel.rotation.x = animRotX;
            petModel.rotation.z = animRotZ;
        }
        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

try {
    startThreePet();
} catch (error) {
    showPetError(`无法初始化 3D 渲染：${error?.message || error}`);
}

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
    const stepX = event.screenX - pointerStart.lastScreenX;
    const stepY = event.screenY - pointerStart.lastScreenY;
    pointerStart.lastScreenX = event.screenX;
    pointerStart.lastScreenY = event.screenY;
    window.desktopPet.dragWindow({ deltaX: stepX, deltaY: stepY });
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
        lastScreenX: event.screenX,
        lastScreenY: event.screenY
    };
    window.desktopPet.pauseWander();
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopPointerDrag);
});

els.petBtn.addEventListener('mouseenter', () => {
    state.isHovering = true;
    window.desktopPet.setHoverState({ hovering: true });
});

els.petBtn.addEventListener('mouseleave', () => {
    state.isHovering = false;
    window.desktopPet.setHoverState({ hovering: false });
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
    if (els.petBubble) els.petBubble.textContent = prompt.question;
    els.petDot.classList.remove('hidden');
});

window.desktopPet.onStateUpdated((payload) => {
    state.currentPromptKey = payload.currentPromptKey || state.currentPromptKey || 'tasks';
    state.reminders = payload.reminders || {};
    if (els.petBubble) els.petBubble.textContent = bubbleText(state.currentPromptKey);
    const hasPending = !((payload.record?.taskEntries || []).length);
    els.petDot.classList.toggle('hidden', !hasPending);
});

window.desktopPet.onWalking((payload) => {
    state.isMoving = Boolean(payload?.moving);
    if (payload?.direction) {
        walkDirection = payload.direction === 'right' ? 'right' : 'left';
    }
});

window.desktopPet.onChatVisibility((payload) => {
    state.isChatOpen = Boolean(payload?.visible);
});
