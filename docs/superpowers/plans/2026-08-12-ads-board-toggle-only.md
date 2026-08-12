# 广告看板侧栏展开/收起与跳转拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击「广告看板」父级只展开/收起子菜单，不再跳转；子项负责导航。

**Architecture:** 仅改 `AppSidebar.vue` 的 `onAdsBoardClick`：去掉 `router.push`，改为单纯 toggle `adsExpanded`。保留 `watch(isAdsBoardActive)` 进入相关页时自动展开。可删除未再使用的 `useRouter` import。

**Tech Stack:** Vue 3 `<script setup>`、现有 `AppSidebar.vue`

**Spec:** `docs/superpowers/specs/2026-08-12-ads-board-toggle-only-design.md`

## Global Constraints

- 点父级：只 toggle，不跳转
- 子项仍进 `/sprints`、`/metrics/manual`
- 进入 sprints/metrics（含周复盘）时自动展开并高亮；允许在广告页手动收起
- 不改其它菜单、不引入 localStorage、不改 CSS（除非必要）
- 仅在用户明确要求时 git commit（commit 步骤可选）

## File Structure

| 文件 | 职责 |
|------|------|
| `frontend/src/components/AppSidebar.vue` | 父级点击仅展开/收起 |

---

### Task 1: 父级点击只 toggle

**Files:**
- Modify: `frontend/src/components/AppSidebar.vue`

**Interfaces:**
- Consumes: 现有 `adsExpanded`、`isAdsBoardActive`、`watch`
- Produces: `onAdsBoardClick` 无路由副作用

- [ ] **Step 1: 改 `onAdsBoardClick` 并清理未用 router**

将：

```js
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
// ...
const router = useRouter();
// ...
function onAdsBoardClick() {
    if (isAdsBoardActive.value) {
        adsExpanded.value = true;
    } else {
        adsExpanded.value = !adsExpanded.value;
    }
    router.push('/sprints');
}
```

改为：

```js
import { computed, ref, watch } from 'vue';
// 删除 useRouter / router
function onAdsBoardClick() {
    adsExpanded.value = !adsExpanded.value;
}
```

保留 `watch(isAdsBoardActive, ...)` 与模板不变。

- [ ] **Step 2: 静态验收**

```powershell
Select-String -Path frontend/src/components/AppSidebar.vue -Pattern "router\.push|useRouter"
```

Expected: 无匹配。

- [ ] **Step 3: 浏览器冒烟（手动）**

1. 点「广告看板」：子项显隐，URL 不变  
2. 点子项：正常跳转  
3. 打开冲刺/填报/周复盘：父级高亮且子菜单展开  
4. 广告页点父级可收起  

- [ ] **Step 4: Commit（可选）**

```bash
git add frontend/src/components/AppSidebar.vue
git commit -m "fix: 广告看板父级点击只展开收起不跳转"
```

---

## Spec Coverage

| Spec | Task |
|------|------|
| 父级只 toggle | Task 1 |
| 子项导航不变 | Task 1（未改子链） |
| 进入相关页自动展开 | Task 1（保留 watch） |
| 允许手动收起 | Task 1（纯 toggle） |
