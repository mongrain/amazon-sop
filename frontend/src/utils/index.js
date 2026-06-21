import axios from 'axios';

let routerInstance = null;

export function setRouter(router) {
    routerInstance = router;
}

export const http = axios.create({
    withCredentials: true
});

http.interceptors.response.use(
    response => response,
    error => {
        const status = error.response && error.response.status;
        if (status === 401) {
            const reqUrl = (error.config && error.config.url) || '';
            const isAuthProbe = reqUrl.includes('/api/auth/me') || reqUrl.includes('/api/auth/login-hint');
            const router = routerInstance;
            if (router && !isAuthProbe) {
                const current = router.currentRoute.value;
                const onAuthPage = current.meta.public || current.name === 'login' || current.name === 'change-password';
                if (!onAuthPage) {
                    router.push({ name: 'login', query: { next: current.fullPath } });
                }
            } else if (!router && !isAuthProbe) {
                const next = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = '/login?next=' + next;
            }
            return Promise.reject(error);
        }
        if (status === 403) {
            const msg = (error.response.data && error.response.data.error) || '';
            if (msg.includes('密码')) {
                const router = routerInstance;
                if (router && router.currentRoute.value.name !== 'change-password') {
                    router.push('/account/change-password');
                } else if (!router) {
                    window.location.href = '/account/change-password';
                }
            }
        }
        return Promise.reject(error);
    }
);

export function getQueryParams() {
    const params = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
        params[key] = value;
    });
    return params;
}

export function buildQuery(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            qs.set(key, String(value));
        }
    });
    const str = qs.toString();
    return str ? ('?' + str) : '';
}

export function pct(value) {
    return Math.round(Number(value || 0) * 100);
}

export function fmtDateTime(dt) {
    if (!dt) return '-';
    const d = dt instanceof Date ? dt : new Date(dt);
    if (Number.isNaN(d.getTime())) return String(dt);
    return d.toLocaleString('zh-CN', { hour12: false });
}

export function getApiError(error, fallback) {
    return (error.response && error.response.data && error.response.data.error) || fallback || '请求失败';
}

export { createMarkdownIt as getMarkdownIt } from './markdown.js';
