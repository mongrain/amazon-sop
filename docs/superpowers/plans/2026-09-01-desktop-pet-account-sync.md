# 桌宠任务账号同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌宠任务按 SOP 账号同步到服务端，多机按 `client_id` 合并。

**Architecture:** 新建表 + 受保护 API；合并逻辑抽成纯函数供服务端与桌宠共用；桌宠主进程用 `.env` 账号登录拿 JWT，拉/存时与本地 JSON 合并。

**Tech Stack:** Node.js、MySQL、Express（现有 page-api）、Electron 主进程、`assert` 单测。

## Global Constraints

- 鉴权：`DESKTOP_PET_USERNAME` + `DESKTOP_PET_PASSWORD` → `POST /api/auth/login` → Bearer JWT
- reminders 不同步；红点逻辑不变
- 本版不做条目删除 API
- 不提交 `.env` 真密码；仅更新 `.env.example`
- 不擅自 git commit（除非用户要求）

---

### Task 1: 合并纯函数 + 单测

**Files:**
- Create: `service/desktop-pet-sync.js`
- Create: `test/test-desktop-pet-sync.js`

**Interfaces:**
- Produces: `mergeTaskEntries(localEntries, remoteEntries) → entries[]`
- Entry shape: `{ id, time, content, createdAt, updatedAt }`（与桌宠一致）

- [ ] **Step 1: 写失败单测**
- [ ] **Step 2: 实现 `mergeTaskEntries`**
- [ ] **Step 3: `node test/test-desktop-pet-sync.js` 通过**

合并规则：以 `id` 为键并集；两侧都有取 `updatedAt` 较新（相等保留 remote）；单侧独有保留；结果按 `time` 再 `id` 排序。

---

### Task 2: 建表

**Files:**
- Modify: `database.js`（在 `daily_rants` 建表块附近增加 `desktop_pet_task_entries`）

- [ ] **Step 1: `CREATE TABLE IF NOT EXISTS desktop_pet_task_entries`**（列与规格一致，UNIQUE `(user_id, entry_date, client_id)`）

---

### Task 3: API

**Files:**
- Modify: `routes/page-api.js`（`registerProtectedPageApi` 内）
- Optionally thin helpers in `service/desktop-pet-sync.js`: `rowsToEntries` / `entryToRow`

- [ ] **Step 1: `GET /api/desktop-pet/tasks?date=`**
- [ ] **Step 2: `PUT /api/desktop-pet/tasks`** body `{ date, entries }`：读库 → merge → upsert 合并结果 → 返回合并后列表
- [ ] **Step 3: 仅操 `req.user.id`；校验 date `YYYY-MM-DD`、time `HH:MM`**

---

### Task 4: 桌宠主进程同步

**Files:**
- Modify: `desktop-pet/main.js`

- [ ] **Step 1: 读 `DESKTOP_PET_API_URL` / `USERNAME` / `PASSWORD`；缺一则纯本地**
- [ ] **Step 2: `loginDesktopPet()` 缓存 JWT；401 时重登一次**
- [ ] **Step 3: `syncTodayTasks()`：GET → merge 本地 → 写本地 → PUT → 用响应写本地**
- [ ] **Step 4: 在 `getTodayState` 对外同步点调用：`pet:get-state` 与 `pet:save-answer` 成功后触发 sync（失败不阻断本地保存）**

---

### Task 5: `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 增加三个空配置项与注释**

---

## Spec coverage

| 规格项 | Task |
|--------|------|
| 新表 | 2 |
| GET/PUT API + 合并 | 1+3 |
| .env 登录 | 4+5 |
| 本地缓存 + reminders 本地 | 4 |
| 离线降级 | 4 |
| 单测合并 | 1 |
