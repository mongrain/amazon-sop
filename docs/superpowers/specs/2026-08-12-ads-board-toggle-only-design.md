# 广告看板侧栏：展开/收起与跳转拆分

日期：2026-08-12  
状态：已确认设计，待实现

## 背景

「广告看板」父级点击当前会同时 toggle 展开并 `router.push('/sprints')`，不符合常见侧栏习惯。其它菜单保持平铺，不新增分组。

## 目标

1. 点击「广告看板」整行（含 caret）：仅展开/收起子菜单，不跳转
2. 子项「冲刺广告」「每日填报」负责进入对应路由
3. 进入 `sprints` / `metrics` 相关页（含周复盘 `active: 'sprints'`）时，父级自动展开并高亮
4. 在广告相关页允许用户手动收起；再次进入相关页时由 `watch` 再次展开

## 非目标

- 不做整栏收窄/隐藏
- 不把其它平铺菜单改成分组
- 不引入 localStorage
- 不改路由、后端、其它页面文案

## 改动范围

- `frontend/src/components/AppSidebar.vue`：`onAdsBoardClick` 只做 `adsExpanded = !adsExpanded`，去掉 `router.push`
- CSS：仅在必要时微调 caret（默认可不动）

## 验收

1. 点父级：子项显隐切换，URL 不变
2. 点子项：正常进入 `/sprints`、`/metrics/manual`
3. 打开冲刺/填报/周复盘：父级高亮，子菜单展开
4. 其它侧栏项行为不变
