# AI 办公室 — 设计规格

**日期：** 2026-06-28  
**状态：** 已批准  
**项目：** amazon-sop-system

---

## 1. 背景与目标

在现有 Amazon SOP 管理系统中新增「AI 办公室」模块。参考 AI 小镇的多 Agent 协作概念，提供 5 名固定 AI 员工，用户手动创建任务并指派；指派后 AI 立即执行，产出经主管审核后才算完成。

**分两阶段交付：**

- **Phase 1**：功能型看板（任务 CRUD、派工、执行、审核、老板拆单）
- **Phase 2**：2D 可视化办公室（角色动画、状态气泡，复用 Phase 1 API）

---

## 2. 需求摘要（已确认）

| 决策项 | 选择 |
|--------|------|
| 体验形态 | C：先做功能看板，再加可视化 |
| 员工编制 | 老板、主管、设计、数据分析、竞品调研（共 5 人） |
| 任务来源 | C：自由创建 + 从业务模块一键转入 |
| 执行触发 | B：指派即执行 |
| 审核流程 | A：必须经主管审核才算完成 |
| 老板行为 | B：老板拆单后自动指派给对应员工并执行 |

---

## 3. 角色定义

| code | 名称 | 职责 | 能否接收执行任务 |
|------|------|------|------------------|
| `boss` | 老板 | 拆解任务、定优先级、自动分派子任务 | ✅（拆单型） |
| `supervisor` | 主管 | 审核所有执行产出 | ❌（仅审核） |
| `designer` | 设计 | Listing 图、视觉方案、素材建议 | ✅ |
| `analyst` | 数据分析 | 指标解读、趋势分析、复盘 | ✅ |
| `researcher` | 竞品调研 | 竞品分析、选品、市场洞察 | ✅ |

AI 员工与 `users` 表（人类账号）完全分离，不可混用。

---

## 4. 任务状态机

```
QUEUED → IN_PROGRESS → PENDING_REVIEW → DONE
                      ↘ FAILED
PENDING_REVIEW → IN_PROGRESS（主管 REJECT，原执行员工自动重跑）
```

| 状态 | 含义 |
|------|------|
| `QUEUED` | 已创建并指派，即将执行（短暂态） |
| `IN_PROGRESS` | AI 执行中 |
| `PENDING_REVIEW` | 执行完成，等待主管审核 |
| `DONE` | 主管审核通过 |
| `REJECTED` | 保留字段，实际打回后回到 `IN_PROGRESS` |
| `FAILED` | 执行失败 |

### 4.1 普通任务（指派给 designer / analyst / researcher）

1. 用户创建任务并选择执行员工
2. 保存后立即 `dispatchAiOfficeTask(taskId)`
3. 执行员工 GPT 产出 → `PENDING_REVIEW`
4. 自动触发主管审核 GPT
5. 通过 → `DONE`；打回 → `IN_PROGRESS` + 原员工重跑

### 4.2 老板任务

1. 用户创建任务并指派给 `boss`
2. 老板 GPT 输出子任务列表（标题、描述、目标 agent code）
3. 系统创建子任务（`parent_task_id` 指向父任务），自动指派并立即执行
4. 每个子任务独立走「执行 → 主管审核 → DONE/重跑」
5. 全部子任务 `DONE` 后，父任务标记 `DONE`

### 4.3 主管角色约束

- 用户不可将普通执行任务直接指派给 `supervisor`
- 主管仅在子任务/普通任务进入 `PENDING_REVIEW` 时由系统自动调用

---

## 5. 数据模型

### 5.1 `ai_agents`

```sql
CREATE TABLE IF NOT EXISTS ai_agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  avatar_emoji VARCHAR(8) DEFAULT NULL,
  role_description TEXT,
  system_prompt TEXT,
  status ENUM('idle','busy','reviewing') DEFAULT 'idle',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Seed 5 条：`boss`, `supervisor`, `designer`, `analyst`, `researcher`。

### 5.2 `ai_office_tasks`

```sql
CREATE TABLE IF NOT EXISTS ai_office_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  context_json JSON DEFAULT NULL,
  created_by INT DEFAULT NULL,
  assigned_agent_id INT DEFAULT NULL,
  parent_task_id INT DEFAULT NULL,
  status ENUM('QUEUED','IN_PROGRESS','PENDING_REVIEW','DONE','REJECTED','FAILED') DEFAULT 'QUEUED',
  priority ENUM('LOW','NORMAL','HIGH') DEFAULT 'NORMAL',
  input_payload JSON DEFAULT NULL,
  output_markdown LONGTEXT DEFAULT NULL,
  review_comment TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_agent_id) REFERENCES ai_agents(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_task_id) REFERENCES ai_office_tasks(id) ON DELETE CASCADE
);
```

`context_json` 示例：

```json
{ "source": "manual" }
{ "source": "ticket", "id": 123, "asin": "B0XXXX" }
{ "source": "product_selection", "id": 45 }
```

### 5.3 `ai_office_task_logs`

```sql
CREATE TABLE IF NOT EXISTS ai_office_task_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  agent_id INT DEFAULT NULL,
  log_type ENUM('system','agent','review') DEFAULT 'system',
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES ai_office_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE SET NULL
);
```

---

## 6. API 设计

所有端点需登录（`registerProtectedPageApi`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai-office/agents` | 5 名员工及实时状态 |
| GET | `/api/ai-office/tasks` | 任务列表（支持 status、agent_id 筛选） |
| POST | `/api/ai-office/tasks` | 创建任务 + 指派 + 立即 dispatch |
| GET | `/api/ai-office/tasks/:id` | 详情、子任务、logs |
| POST | `/api/ai-office/tasks/:id/reassign` | 改派（仅 QUEUED/FAILED） |

### POST `/api/ai-office/tasks` 请求体

```json
{
  "title": "分析 B0XXX 竞品",
  "description": "对比前三竞品 Listing 与价格带",
  "assigned_agent_code": "researcher",
  "priority": "NORMAL",
  "context_json": { "source": "manual" }
}
```

---

## 7. 前端

### 7.1 Phase 1 页面

| 路由 | 组件 | 功能 |
|------|------|------|
| `/ai-office` | `AiOfficeView.js` | 5 人卡片 + 任务池 + 新建任务 |
| `/ai-office/tasks/:id` | `AiOfficeTaskView.js` | 详情、logs、产出、子任务 |

侧边栏 `AppSidebar.vue` 增加「AI 办公室」入口。

UI 风格与现有 `TicketsView.js` / `TicketDetailView.js` 一致（inline template、Composition API）。

### 7.2 Phase 1c 业务集成入口

| 来源页面 | 按钮文案 | context_json |
|----------|----------|--------------|
| `TicketDetailView.js` | 交给 AI 办公室 | `{ source: 'ticket', id }` |
| `ProductSelectionView.js` | 交给 AI 办公室 | `{ source: 'product_selection', id }` |

跳转至 `/ai-office?prefill=...` 或 POST 后跳转详情。

### 7.3 Phase 2 可视化

- 组件 `AiOfficeScene.vue`（Canvas 或 CSS Grid 2D 场景）
- 工位布局、角色 idle/busy/reviewing 动画、对话气泡
- 点击角色过滤其任务；数据来自现有 API

---

## 8. 后端模块

```
service/ai-office.js              — CRUD、状态转换、agent 状态更新
orchestration/ai-office/
  index.js                          — dispatchAiOfficeTask（setImmediate）
  runner.js                         — 按 agent code 路由
  agents/boss.js                    — 拆单 JSON + 创建子任务
  agents/supervisor.js              — 审核 JSON（approve/reject + comment）
  agents/designer.js                — 执行产出 Markdown
  agents/analyst.js
  agents/researcher.js
```

GPT 调用复用 `gpt.js` 的 `chatCompletionJson`。各 agent 的 `system_prompt` 存于 `ai_agents` 表，可在后续版本支持管理界面。

---

## 9. 错误处理

- GPT 超时/解析失败 → 任务 `FAILED`，写入 `error_message` 和 log
- 主管打回 → log 记录 `review_comment`，原员工自动重跑（最多 3 次，超出则 `FAILED`）
- 并发：同一 agent 可多任务，agent.status 按「是否有 IN_PROGRESS 任务」计算

---

## 10. 非目标（YAGNI）

- Phase 1 不做 agent system_prompt 在线编辑
- Phase 1 不做与 Google Trends / SOP 的集成（Phase 1.5）
- Phase 1 不做实时 WebSocket（前端轮询或手动刷新）
- 不把 AI 员工写入 `users` 表

---

## 11. 验收标准

### Phase 1a

- [ ] 5 名员工 seed 数据存在
- [ ] 可创建任务并指派给 designer/analyst/researcher/boss
- [ ] 办公室页展示员工状态与任务列表

### Phase 1b

- [ ] 指派即执行，产出写入 `output_markdown`
- [ ] 执行完成后自动主管审核，通过则 DONE
- [ ] 老板任务自动拆单并分派子任务
- [ ] 主管打回后原员工重跑

### Phase 1c

- [ ] 工单详情、选品分析页可一键创建 AI 办公室任务

### Phase 2

- [ ] 2D 办公室可视化，角色状态与任务联动
