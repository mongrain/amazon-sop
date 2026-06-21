import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getApiError, http } from '@/utils/index.js';

export default {
    name: 'UsersView',
    setup() {
        const router = useRouter();
        const route = useRoute();
        const users = ref([]);
        const error = ref('');
        const loading = ref(true);
        const addForm = ref({ name: '', password: '', role: 'OPS' });
        const resetPasswords = ref({});
        const submitting = ref(false);

        onMounted(loadData);

        async function loadData() {
            loading.value = true;
            try {
                const { data } = await http.get('/api/users');
                users.value = data.users || [];
            } catch (e) {
                users.value = [];
            } finally {
                loading.value = false;
            }
        }

        async function submitAdd() {
            error.value = '';
            submitting.value = true;
            try {
                await http.post('/api/users', addForm.value);
                addForm.value = { name: '', password: '', role: 'OPS' };
                await loadData();
            } catch (e) {
                error.value = getApiError(e, '新增失败');
            } finally {
                submitting.value = false;
            }
        }

        async function resetPassword(userId) {
            error.value = '';
            const password = resetPasswords.value[userId] || '';
            try {
                await http.post('/api/users/' + userId + '/password', { password });
                resetPasswords.value[userId] = '';
                await loadData();
            } catch (e) {
                error.value = getApiError(e, '重置密码失败');
            }
        }

        async function deleteUser(userId) {
            if (!confirm('确认删除该人员？')) return;
            error.value = '';
            try {
                await http.post('/api/users/' + userId + '/delete');
                await loadData();
            } catch (e) {
                error.value = getApiError(e, '删除失败');
            }
        }

        return { users, error, loading, addForm, resetPasswords, submitting, submitAdd, resetPassword, deleteUser };
    },
    template: `<div class="page-header">
                <h1>人员管理</h1>
                <div class="page-desc">管理登录账号（姓名为登录账号），用于系统登录与吐槽作者识别</div>
            </div>
            <div v-if="error" style="background:#fef0f0; border:1px solid #fde2e2; color:#f56c6c; padding:12px 16px; border-radius:8px; margin-bottom:16px;">
                {{ error }}
            </div>
            <div class="module-card" style="margin-bottom:16px;">
                <div class="module-header" style="cursor:default;">
                    <div class="module-name">新增人员</div>
                </div>
                <div class="module-body">
                    <form @submit.prevent="submitAdd" style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
                        <div>
                            <div style="font-size:13px; color:#606266; margin-bottom:6px;">姓名（登录账号）*</div>
                            <input class="search-input" v-model="addForm.name" required autocomplete="off">
                        </div>
                        <div>
                            <div style="font-size:13px; color:#606266; margin-bottom:6px;">密码 *</div>
                            <input class="search-input" v-model="addForm.password" type="password" required minlength="4" autocomplete="new-password">
                        </div>
                        <div>
                            <div style="font-size:13px; color:#606266; margin-bottom:6px;">角色 *</div>
                            <select class="filter-select" v-model="addForm.role" required>
                                <option value="OPS">运营 (OPS)</option>
                                <option value="DESIGN">美工 (DESIGN)</option>
                                <option value="MANAGER">主管 (MANAGER)</option>
                            </select>
                        </div>
                        <button type="submit" class="btn-primary" :disabled="submitting">{{ submitting ? '提交中…' : '新增' }}</button>
                    </form>
                </div>
            </div>
            <div class="table-container">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="min-width:80px">ID</th>
                            <th style="min-width:200px">姓名</th>
                            <th style="min-width:160px">角色</th>
                            <th style="min-width:280px">重置密码</th>
                            <th style="min-width:120px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="loading">
                            <td colspan="5" style="text-align:center; padding:40px; color:#999;">加载中…</td>
                        </tr>
                        <tr v-else-if="!users.length">
                            <td colspan="5" style="text-align:center; padding:40px; color:#999;">暂无人员</td>
                        </tr>
                        <tr v-for="u in users" :key="u.id">
                            <td>{{ u.id }}</td>
                            <td>{{ u.name }}</td>
                            <td>{{ u.role }}</td>
                            <td>
                                <form @submit.prevent="resetPassword(u.id)" style="display:flex; gap:8px; align-items:center;">
                                    <input class="search-input" v-model="resetPasswords[u.id]" type="password" placeholder="新密码" minlength="4" required style="width:140px;">
                                    <button class="btn-secondary" type="submit" style="padding:6px 12px; font-size:12px;">重置</button>
                                </form>
                            </td>
                            <td>
                                <button class="btn-danger" type="button" @click="deleteUser(u.id)">删除</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>`
};
