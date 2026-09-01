# 桌宠任务账号同步

日期：2026-09-01  
状态：已确认设计，待写实现计划

## 背景

桌宠任务目前只写在本机 `userData/desktop-pet-state.json`，多台电脑互不同步。用户已在 A 机记过任务，B 机仍显示红点（当天无任务）。系统已有 JWT 登录与用户表，但没有桌宠任务条目的结构化存储。

## 目标

1. 桌宠任务条目按 **SOP 账号** 存到服务端，多机可见同一天记录
2. 身份来自 `.env` 的 **用户名 + 密码**（启动时登录拿 JWT，不配长期 Token）
3. 同步策略为 **按条目合并**：同一 `client_id` 保留 `updated_at` 较新者；仅一侧有的条目都保留
4. 离线仍可记本地；网络恢复后合并上传
5. 红点逻辑不变：合并后当天有任务则不显示

## 非目标

- 不做桌宠内登录 UI
- 不复用 `daily_rants` 碎碎念表/接口
- 不把 reminders（当日是否已弹过点）同步到服务端（仍本机，避免多机互相清掉提醒状态）
- 不做历史全量迁移工具（首次同步以「本机今日 + 服务端今日」合并为准）
- 不做实时 WebSocket / CRDT
- 不在渲染进程暴露密码或 JWT

## 决策摘要

| 项 | 选择 |
|----|------|
| 鉴权方式 | `.env` 用户名密码 → `POST /api/auth/login` → Bearer JWT |
| 存储 | 新建表 `desktop_pet_task_entries` |
| 合并 | 按 `client_id`；`updated_at` 新者胜；单侧独有保留 |
| 本地 | 保留 JSON 缓存；reminders 仅本地 |
| 同步时机 | 拉取状态 / 每次保存任务 |

## 配置（`.env` / `.env.example`）

```env
DESKTOP_PET_API_URL=http://localhost:5000
DESKTOP_PET_USERNAME=
DESKTOP_PET_PASSWORD=
```

- 三者任一缺失：桌宠保持纯本地模式（与现网行为一致），主进程可打一次 warn
- `DESKTOP_PET_API_URL` 无尾斜杠；请求拼 `/api/...`

## 数据模型

### 表 `desktop_pet_task_entries`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INT PK AI | 服务端主键 |
| user_id | INT NOT NULL | FK → users(id) ON DELETE CASCADE |
| entry_date | DATE NOT NULL | 任务所属自然日（本地日历日） |
| client_id | VARCHAR(64) NOT NULL | 桌宠本地条目 id，用户日内唯一 |
| time | CHAR(5) NOT NULL | `HH:MM` |
| content | TEXT NOT NULL | 任务内容 |
| created_at | DATETIME | |
| updated_at | DATETIME | 合并比较字段 |

- UNIQUE `(user_id, entry_date, client_id)`
- INDEX `(user_id, entry_date)`

### 本地条目形状（不变）

```json
{ "id": "<client_id>", "time": "12:30", "content": "...", "createdAt": "...", "updatedAt": "..." }
```

服务端读写时：`client_id` ↔ `id`，`created_at`/`updated_at` ↔ ISO 字符串。

## API（需登录：Cookie 或 Bearer）

### `GET /api/desktop-pet/tasks?date=YYYY-MM-DD`

- 返回当前用户该日全部条目
- 响应：`{ date, entries: [{ id, time, content, createdAt, updatedAt }] }`

### `PUT /api/desktop-pet/tasks`

- Body：`{ date, entries: [...] }`（客户端提交的「本侧当日全集」或「变更集」均可；**实现约定：提交合并后的当日全集**，服务端仍按 client_id 与库内合并后再写，防止旧客户端覆盖）
- 服务端合并算法：
  1. 读出该用户该日全部行
  2. 以 `client_id` 为键，对客户端与服务端两侧做并集
  3. 两侧都有：取 `updatedAt` 较新的；同时则任取一侧（建议保留服务端）
  4. 仅一侧有：保留
  5. 写回（upsert 保留的；**本版不物理删除**——客户端未带上的服务端条目仍保留，避免误删）
- 响应：合并后的 `{ date, entries: [...] }`

> 删除：本版桌宠若暂无「删任务」UI，则 API 不做删除；若后续加删除，另开规格。

## 桌宠主进程行为

```text
启动
  → 若配置齐全：POST /api/auth/login { name, password }
       成功：缓存 JWT（仅主进程内存）
       失败：warn + 纯本地
  → 之后 pet:get-state / pet:save-answer：
       有 JWT：GET 当日 → 与本地 records[date].taskEntries 合并
            → 写本地 → PUT 合并结果 → 用响应再写本地
       无 JWT / 网络失败：只读写本地（现有逻辑）
```

- 登录与 HTTP 只在 **Electron 主进程**；preload/渲染不接触密码与 Token
- 合并函数与服务端规则一致（便于单测）
- Token 过期：下次同步 401 时重新 login 一次；仍失败则降级本地

## 安全

- 密码仅存本机 `.env`，不入库、不进日志明文
- API 必须 `requireLogin`，只能读写 `req.user.id` 自己的数据
- 不把 `DESKTOP_PET_PASSWORD` 同步进 git（仅 `.env.example` 留空键）

## 测试要点

1. 未配 `.env`：行为与现网一致（纯本地）
2. 已配且服务端有条目、本地空：启动/拉状态后本地出现远端任务，红点灭
3. 两边各有不同 `client_id`：合并后两边都在
4. 同一 `client_id` 两边内容不同：保留 `updatedAt` 较新
5. 断网保存：写入本地成功；恢复后再次保存或拉状态能上传

## 实现落点（预估）

| 区域 | 文件 |
|------|------|
| 建表 | `database.js`（及如有 `init.sql` 则同步） |
| API | `routes/page-api.js`（或薄 `service/desktop-pet-tasks.js` + 注册） |
| 合并纯函数 | `service/desktop-pet-sync.js`（主进程与单测共用） |
| 桌宠 | `desktop-pet/main.js` |
| 配置说明 | `.env.example` |
| 单测 | `test/test-desktop-pet-sync.js` |
