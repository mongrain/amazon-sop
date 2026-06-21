import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

export default {
    name: 'ChangePasswordView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const currentUser = ref(null);
        const forced = ref(false);
        const error = ref('');
        const submitting = ref(false);
        const form = ref({ current_password: '', new_password: '', confirm_password: '' });

        onMounted(async () => {
            try {
                const { data } = await http.get('/api/auth/me');
                currentUser.value = data.user;
                forced.value = !!(data.user && data.user.mustChangePassword);
            } catch (e) { /* handled by interceptor */ }
        });

        async function submitChange() {
            error.value = '';
            submitting.value = true;
            try {
                const { data } = await http.post('/api/auth/change-password', form.value);
                router.push(data.redirect || '/dashboard');
            } catch (e) {
                error.value = getApiError(e, '修改密码失败');
            } finally {
                submitting.value = false;
            }
        }

        return { currentUser, forced, error, submitting, form, submitChange };
    },
    template: `
        <div class="login-card">
            <div class="login-title">修改密码</div>
            <div v-if="forced" class="login-warn">首次登录须修改默认密码后才能使用系统</div>
            <div v-else-if="currentUser" class="login-desc">当前账号：<strong>{{ currentUser.name }}</strong></div>
            <div v-if="error" class="login-error">{{ error }}</div>
            <form @submit.prevent="submitChange">
                <div class="login-field">
                    <label class="login-label" for="current_password">当前密码</label>
                    <input class="search-input login-input" id="current_password" v-model="form.current_password" type="password" required autocomplete="current-password">
                </div>
                <div class="login-field">
                    <label class="login-label" for="new_password">新密码</label>
                    <input class="search-input login-input" id="new_password" v-model="form.new_password" type="password" required minlength="4" autocomplete="new-password">
                </div>
                <div class="login-field">
                    <label class="login-label" for="confirm_password">确认新密码</label>
                    <input class="search-input login-input" id="confirm_password" v-model="form.confirm_password" type="password" required minlength="4" autocomplete="new-password">
                </div>
                <button type="submit" class="btn-primary" style="width:100%; margin-top:8px;" :disabled="submitting">{{ submitting ? '保存中…' : '保存并进入系统' }}</button>
            </form>
            <div v-if="!forced" style="margin-top:16px; text-align:center;">
                <router-link to="/dashboard" style="font-size:13px; color:var(--text-secondary);">取消</router-link>
            </div>
        </div>
    `
};
