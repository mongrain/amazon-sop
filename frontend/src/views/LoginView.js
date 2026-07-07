import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

export default {
    name: 'LoginView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const defaultAdminHint = ref(null);
        const error = ref('');
        const submitting = ref(false);
        const nextUrl = ref('/dashboard');
        const form = ref({ name: '', password: '' });

        onMounted(async () => {
            const qp = route.query;
            nextUrl.value = qp.next || '/dashboard';
            try {
                const { data } = await http.get('/api/auth/login-hint');
                if (data.defaultAdminHint) {
                    defaultAdminHint.value = data.defaultAdminHint;
                    form.value.name = data.defaultAdminHint.name || '';
                }
                if (data.next) nextUrl.value = data.next;
            } catch (e) { /* ignore */ }
        });

        async function submitLogin() {
            error.value = '';
            submitting.value = true;
            try {
                const { data } = await http.post('/api/auth/login', {
                    name: form.value.name,
                    password: form.value.password,
                    next: nextUrl.value
                });
                router.push(data.redirect || nextUrl.value);
            } catch (e) {
                error.value = getApiError(e, '登录失败');
            } finally {
                submitting.value = false;
            }
        }

        return { defaultAdminHint, error, submitting, form, submitLogin };
    },
    template: `
        <div class="login-card">
            <div class="login-title">Amazon SOP</div>
            <div class="login-desc">OMC · 请登录</div>
            <div v-if="defaultAdminHint" class="login-hint">
                首次部署默认账号：<strong>{{ defaultAdminHint.name }}</strong> /
                <strong>{{ defaultAdminHint.password }}</strong><br>
                登录后须立即修改密码
            </div>
            <div v-if="error" class="login-error">{{ error }}</div>
            <form @submit.prevent="submitLogin">
                <div class="login-field">
                    <label class="login-label" for="name">账号</label>
                    <input class="search-input login-input" id="name" v-model="form.name" type="text" required autocomplete="username" placeholder="姓名">
                </div>
                <div class="login-field">
                    <label class="login-label" for="password">密码</label>
                    <input class="search-input login-input" id="password" v-model="form.password" type="password" required autocomplete="current-password" placeholder="密码">
                </div>
                <button type="submit" class="btn-primary" style="width:100%; margin-top:8px;" :disabled="submitting">{{ submitting ? '登录中…' : '登录' }}</button>
            </form>
        </div>
    `
};
