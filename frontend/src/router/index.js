import { createRouter, createWebHistory } from 'vue-router';
import { http, setRouter } from '@/utils/index.js';
import AppLayout from '@/components/AppLayout.vue';

import LoginView from '@/views/LoginView.js';
import ChangePasswordView from '@/views/ChangePasswordView.js';
import DashboardView from '@/views/DashboardView.js';
import SopView from '@/views/SopView.js';
import ImportView from '@/views/ImportView.js';
import AnnualActivitiesView from '@/views/AnnualActivitiesView.js';
import KnowledgeView from '@/views/KnowledgeView.js';
import KnowledgeDocView from '@/views/KnowledgeDocView.js';
import DailyRantsView from '@/views/DailyRantsView.js';
import DailyRantEditView from '@/views/DailyRantEditView.js';
import CompetitorsView from '@/views/CompetitorsView.js';
import UsersView from '@/views/UsersView.js';
import SprintsView from '@/views/SprintsView.js';
import SprintFormView from '@/views/SprintFormView.js';
import ReviewsView from '@/views/ReviewsView.js';
import ReviewFormView from '@/views/ReviewFormView.js';
import MetricsManualView from '@/views/MetricsManualView.js';
import TicketsView from '@/views/TicketsView.js';
import TicketDetailView from '@/views/TicketDetailView.js';
import ProductView from '@/views/ProductView.js';
import ProductVersionView from '@/views/ProductVersionView.js';
import ProductSelectionView from '@/views/ProductSelectionView.js';
import DataCollectionView from '@/views/DataCollectionView.js';
import AmcAdsView from '@/views/AmcAdsView.js';
import AiOfficeView from '@/views/AiOfficeView.js';
import AiOfficeTaskView from '@/views/AiOfficeTaskView.js';
import ProductEliminationView from '@/views/ProductEliminationView.js';

const layoutChildren = [
    { path: '', redirect: '/dashboard' },
    { path: 'dashboard', name: 'dashboard', component: DashboardView, meta: { active: 'dashboard', title: '产品看板' } },
    { path: 'sop', name: 'sop', component: SopView, meta: { active: 'sop', title: 'SOP模板' } },
    { path: 'import', name: 'import', component: ImportView, meta: { active: 'import', title: '导入数据' } },
    { path: 'annual-activities', name: 'annual-activities', component: AnnualActivitiesView, meta: { active: 'annual_activities', title: '年度活动' } },
    { path: 'knowledge', name: 'knowledge', component: KnowledgeView, meta: { active: 'knowledge', title: '焚诀' } },
    { path: 'knowledge/new', name: 'knowledge-new', component: KnowledgeDocView, meta: { active: 'knowledge', title: '新建文档' } },
    { path: 'knowledge/:id', name: 'knowledge-doc', component: KnowledgeDocView, meta: { active: 'knowledge', title: '文档' } },
    { path: 'daily-rants', name: 'daily-rants', component: DailyRantsView, meta: { active: 'daily_rants', title: '碎碎念' } },
    { path: 'daily-rants/new', name: 'daily-rants-new', component: DailyRantEditView, meta: { active: 'daily_rants', title: '来一句' } },
    { path: 'daily-rants/:id', name: 'daily-rant-edit', component: DailyRantEditView, meta: { active: 'daily_rants', title: '碎碎念' } },
    { path: 'competitors', name: 'competitors', component: CompetitorsView, meta: { active: 'competitors', title: '竞品库' } },
    { path: 'product-selection', name: 'product-selection', component: ProductSelectionView, meta: { active: 'product_selection', title: '选品分析' } },
    { path: 'data-collection', name: 'data-collection', component: DataCollectionView, meta: { active: 'data_collection', title: '数据采集' } },
    { path: 'amc-ads', name: 'amc-ads', component: AmcAdsView, meta: { active: 'amc_ads', title: 'AMC 广告' } },
    { path: 'product-elimination', name: 'product-elimination', component: ProductEliminationView, meta: { active: 'product_elimination', title: '产品淘汰分析' } },
    { path: 'users', name: 'users', component: UsersView, meta: { active: 'users', title: '人员管理' } },
    { path: 'sprints', name: 'sprints', component: SprintsView, meta: { active: 'sprints', title: '冲刺项目' } },
    { path: 'sprints/new', name: 'sprints-new', component: SprintFormView, meta: { active: 'sprints', title: '新建冲刺项目' } },
    { path: 'sprints/:id', name: 'sprint-edit', component: SprintFormView, meta: { active: 'sprints', title: '编辑冲刺项目' } },
    { path: 'reviews', name: 'reviews', component: ReviewsView, meta: { active: 'sprints', title: '周复盘' } },
    { path: 'reviews/:id', name: 'review-edit', component: ReviewFormView, meta: { active: 'sprints', title: '周复盘填写' } },
    { path: 'metrics/manual', name: 'metrics-manual', component: MetricsManualView, meta: { active: 'metrics', title: '每日数据填报' } },
    { path: 'tickets', name: 'tickets', component: TicketsView, meta: { active: 'tickets', title: '工单看板' } },
    { path: 'tickets/:id', name: 'ticket-detail', component: TicketDetailView, meta: { active: 'tickets', title: '工单详情' } },
    { path: 'ai-office', name: 'ai-office', component: AiOfficeView, meta: { active: 'ai_office', title: 'AI 办公室' } },
    { path: 'ai-office/tasks/:id', name: 'ai-office-task', component: AiOfficeTaskView, meta: { active: 'ai_office', title: 'AI 任务详情' } },
    { path: 'product/:asin', name: 'product', component: ProductView, meta: { active: '', title: '产品详情' } },
    { path: 'product/:asin/version/:versionId', name: 'product-version', component: ProductVersionView, meta: { active: '', title: '产品版本' } }
];

const routes = [
    {
        path: '/login',
        name: 'login',
        component: LoginView,
        meta: { public: true, title: '登录', layout: 'auth' }
    },
    {
        path: '/account/change-password',
        name: 'change-password',
        component: ChangePasswordView,
        meta: { title: '修改密码', layout: 'auth' }
    },
    {
        path: '/',
        component: AppLayout,
        children: layoutChildren
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

router.beforeEach(async (to) => {
    document.title = (to.meta.title ? to.meta.title + ' - ' : '') + 'Amazon OMC';

    if (to.meta.public) {
        try {
            await http.get('/api/auth/me');
            return to.query.next || '/dashboard';
        } catch (e) {
            return true;
        }
    }

    try {
        await http.get('/api/auth/me');
        return true;
    } catch (e) {
        return { name: 'login', query: { next: to.fullPath } };
    }
});

setRouter(router);

export default router;
