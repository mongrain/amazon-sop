import Viewer from 'viewerjs';
import 'viewerjs/dist/viewer.css';

let activeViewer = null;
let activeContainer = null;

const VIEWER_OPTIONS = {
    navbar: false,
    title: false,
    toolbar: {
        zoomIn: 1,
        zoomOut: 1,
        oneToOne: 1,
        reset: 1,
        prev: 0,
        play: 0,
        next: 0,
        rotateLeft: 0,
        rotateRight: 0,
        flipHorizontal: 0,
        flipVertical: 0
    },
    tooltip: true,
    movable: true,
    zoomable: true,
    zoomOnWheel: true,
    wheelZoomRatio: 0.5,
    transition: true,
    fullscreen: true,
    keyboard: true,
    backdrop: true,
    initialCoverage: 1,
    minZoomRatio: 0.01,
    maxZoomRatio: 100,
    zIndex: 9999
};

function destroyActiveViewer() {
    if (activeViewer) {
        activeViewer.destroy();
        activeViewer = null;
    }
    if (activeContainer) {
        activeContainer.remove();
        activeContainer = null;
    }
}

export function openViewer(src) {
    if (!src) return;
    destroyActiveViewer();

    activeContainer = document.createElement('ul');
    activeContainer.style.display = 'none';
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = src;
    img.alt = '预览图片';
    li.appendChild(img);
    activeContainer.appendChild(li);
    document.body.appendChild(activeContainer);

    activeViewer = new Viewer(activeContainer, {
        ...VIEWER_OPTIONS,
        hidden() {
            destroyActiveViewer();
        }
    });
    activeViewer.show();
}

export function closeViewer() {
    if (activeViewer) {
        activeViewer.hide();
    }
}

export function initImageViewer() {
    window.openViewer = openViewer;
}
