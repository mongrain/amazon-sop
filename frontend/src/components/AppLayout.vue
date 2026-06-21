<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { http } from '@/utils/index.js';
import AppSidebar from './AppSidebar.vue';

const route = useRoute();
const router = useRouter();
const currentUser = ref(null);
const active = computed(() => route.meta.active || '');

onMounted(async () => {
    try {
        const { data } = await http.get('/api/auth/me');
        currentUser.value = data.user;
    } catch (e) {
        /* handled by router guard */
    }
});

watch(
    () => route.meta.title,
    (title) => {
        document.title = (title ? title + ' - ' : '') + 'Amazon 运营SOP管理系统';
    },
    { immediate: true }
);

async function logout() {
    try {
        await http.post('/api/auth/logout');
    } catch (e) {
        /* ignore */
    }
    router.push('/login');
}
</script>

<template>
    <div class="app">
        <AppSidebar :active="active" :current-user="currentUser" @logout="logout" />
        <main class="main-content">
            <router-view />
        </main>
    </div>
</template>
