import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { initImageViewer } from './utils/viewer.js';

import './assets/style.css';
import 'github-markdown-css/github-markdown.css';
import 'highlight.js/styles/github.css';

initImageViewer();

const app = createApp(App);
app.use(router);
app.mount('#app');

document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }
    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.target === '_blank') return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) {
        return;
    }
    if (href.startsWith('/')) {
        event.preventDefault();
        router.push(href);
    }
});
