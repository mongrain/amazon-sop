<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const isAuthLayout = computed(() => route.meta.layout === 'auth');
</script>

<template>
    <div :class="isAuthLayout ? 'auth-shell' : ''">
        <router-view />
    </div>
</template>

<style>
.auth-shell {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
}
</style>
