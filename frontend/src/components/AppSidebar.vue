<script setup>
defineProps({
    active: { type: String, default: '' },
    currentUser: { type: Object, default: null }
});
defineEmits(['logout']);
</script>

<template>
    <aside class="sidebar">
        <div class="sidebar-header">
            <h2>Amazon SOP</h2>
            <p>运营管理系统</p>
        </div>
        <nav class="sidebar-nav">
            <router-link to="/dashboard" :class="{ active: active === 'dashboard' }">产品看板</router-link>
            <router-link to="/sprints" :class="{ active: active === 'sprints' }">冲刺项目</router-link>
            <router-link to="/metrics/manual" :class="{ active: active === 'metrics' }">每日填报</router-link>
            <router-link to="/daily-rants" :class="{ active: active === 'daily_rants' }">碎碎念</router-link>
            <router-link to="/tickets" :class="{ active: active === 'tickets' }">工单看板</router-link>
            <router-link to="/ai-office" :class="{ active: active === 'ai_office' }">AI 办公室</router-link>
            <router-link to="/annual-activities" :class="{ active: active === 'annual_activities' }">年度活动</router-link>
            <router-link to="/users" :class="{ active: active === 'users' }">人员管理</router-link>
            <router-link to="/competitors" :class="{ active: active === 'competitors' }">竞品库</router-link>
            <router-link to="/product-selection" :class="{ active: active === 'product_selection' }">选品分析</router-link>
            <router-link to="/google-trends" :class="{ active: active === 'google_trends' }">Google Trends</router-link>
            <router-link to="/amc-ads" :class="{ active: active === 'amc_ads' }">AMC 广告</router-link>
            <router-link to="/knowledge" :class="{ active: active === 'knowledge' }">知识库</router-link>
            <router-link to="/sop" :class="{ active: active === 'sop' }">SOP模板</router-link>
            <router-link to="/import" :class="{ active: active === 'import' }">导入数据</router-link>
        </nav>
        <div v-if="currentUser" class="sidebar-user">
            <div class="sidebar-user-name">{{ currentUser.name }}</div>
            <div class="sidebar-user-role">{{ currentUser.role }}</div>
            <button type="button" class="sidebar-logout-btn" @click="$emit('logout')">退出登录</button>
        </div>
    </aside>
</template>
