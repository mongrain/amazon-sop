const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPet', {
    getState: () => ipcRenderer.invoke('pet:get-state'),
    saveAnswer: (payload) => ipcRenderer.invoke('pet:save-answer', payload),
    copySummary: (payload) => ipcRenderer.invoke('pet:copy-summary', payload),
    openChat: (payload) => ipcRenderer.send('pet:open-chat', payload),
    hideChat: () => ipcRenderer.send('pet:hide-chat'),
    activatePrompt: (payload) => ipcRenderer.send('pet:activate-prompt', payload),
    dragWindow: (payload) => ipcRenderer.send('pet:drag-window', payload),
    pauseWander: () => ipcRenderer.send('pet:pause-wander'),
    setHoverState: (payload) => ipcRenderer.send('pet:hover-state', payload),
    onPrompt: (callback) => ipcRenderer.on('pet:prompt', (_event, payload) => callback(payload)),
    onOpenChat: (callback) => ipcRenderer.on('pet:open-chat', (_event, payload) => callback(payload)),
    onStateUpdated: (callback) => ipcRenderer.on('pet:state-updated', (_event, payload) => callback(payload)),
    fetchEuAdsReport: () => ipcRenderer.invoke('pet:fetch-eu-ads-report'),
    onEuAdsReport: (callback) => ipcRenderer.on('pet:eu-ads-report', (_event, payload) => callback(payload)),
    onWalking: (callback) => ipcRenderer.on('pet:walking', (_event, payload) => callback(payload)),
    onChatVisibility: (callback) => ipcRenderer.on('pet:chat-visibility', (_event, payload) => callback(payload))
});
