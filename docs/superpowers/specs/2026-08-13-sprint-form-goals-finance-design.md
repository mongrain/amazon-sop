# 冲刺广告表单：周期回填、冲刺目标与财务风控

日期：2026-08-13  
状态：已确认设计，待实现

## 背景

冲刺广告表单需支持：按目标周期回填结束日期；排名改为自由文本；业务目标增加冲刺目标（CTR/CVR/CPC/所需曝光）；财务风控按产品毛利默认回填 TACOS/亏损额度，并以所需曝光×CPC 得到预算上限；移除 ACoS。

## 目标

1. 有开始日期且目标周期有效时，结束日期 = 开始日期 + 目标周期天数 − 1（可手改）
2. 当前排名、目标排名为 text，placeholder：`请输入小类排名xx名, 大类排名xx名`
3. 业务目标下增加「冲刺目标」：7日日均CTR(%)、7日日均CVR(%)、CPC($)、所需曝光
4. 所需曝光 = 目标日均单量 ÷ ((CTR/100)×(CVR/100))；依赖变化一律自动重算，可手改但会被后续依赖变化覆盖
5. 预算上限 = 所需曝光 × CPC；同样随依赖自动重算
6. ASIN 旁「查询」按钮：调用 `GET /api/product/:asin`，回填利润率与财务默认值
7. 推广期允许TACOS(%) = 毛利率×100；稳定期目标TACOS(%) = 毛利率×100×0.6
8. 7天最大亏损额度 = 单件利润USD × 当前日均单量 × 7（当前日均单量为空则暂不填）
9. 移除表单与列表中的 ACoS；列表以预算上限列替代

## 非目标

- 不改周复盘、每日填报、产品经济核算公式本身
- 不删除 DB 列 `acos_limit`（新保存写 NULL 即可）
- 不做「手改锁定不再自动覆盖」

## 决策摘要

| 项 | 选择 |
|----|------|
| 实现方案 | 前端派生计算 + ASIN 查询接口回填 |
| 所需曝光公式 | 目标日均单量 ÷ ((CTR/100)×(CVR/100)) |
| CTR/CVR 录入 | 百分数（0.3 = 0.3%） |
| 结束日期 | 开始 + 周期 − 1（含当天） |
| TACOS 默认 | 推广期=毛利×100；稳定期=×0.6 |
| 亏损额度 | profit_usd × 当前日均单量 × 7 |
| ASIN 查询 | 按钮触发，复用 `GET /api/product/:asin` |
| 自动重算 | 依赖变化一律重算 |

## 表单结构

### 基础信息
- ASIN * +「查询」按钮（编辑态 ASIN 只读，仍可查询）
- 负责人、状态、开始日期 *、结束日期 *、目标周期(天)

### 业务目标
- 当前日均单量、目标日均单量
- 当前排名、目标排名（text + 指定 placeholder）
- 冲刺目标：7日日均CTR(%)、7日日均CVR(%)、CPC($)、所需曝光

### 财务风控
- 推广期允许TACOS(%)、稳定期目标TACOS(%)、7天最大亏损额度($)、利润率(%)、预算上限($)
- 无 ACoS

## 计算与回填

- `end_date`：`start_date` 或 `target_cycle_days` 变化且有效时重算
- `required_impressions`：目标日均单量、CTR、CVR 均有效且分母>0 时重算
- `budget_cap`：所需曝光与 CPC 均有效时重算
- 查询成功：
  - `profit_margin`(%) = `computed.profit_margin × 100`
  - `promo_tacos_limit` = 同上
  - `stable_tacos_target` = 同上 × 0.6
  - `max_loss_7d` = `computed.profit_usd × current_daily_orders × 7`（单量有效时）
- 查无产品：提示错误，不清空已有财务手填值

## 数据与接口

### `sprint_projects`
- `current_rank` / `target_rank` → `VARCHAR(255)`
- 新增可空数值：`ctr_7d`、`cvr_7d`、`cpc`、`required_impressions`、`budget_cap`
- `database.js` 启动 ALTER + `init.sql` 同步

### API
- 查询：复用 `GET /api/product/:asin`
- 保存：`saveSprint` 读写新字段；排名按字符串；`acos_limit` 写 NULL

### 列表
- 去掉 ACoS 列，增加预算上限列

## 验收标准

1. 改开始日期/周期后结束日期按公式回填，仍可手改
2. 排名为文本占位符正确；可保存长文本描述
3. 填 CTR/CVR/目标单量后所需曝光自动算；改 CPC/曝光后预算上限自动算
4. 点查询后 TACOS/利润率/亏损额度按规则回填（有单量时）
5. 表单与列表无 ACoS；列表可见预算上限
6. 其它冲刺 CRUD、周复盘不受影响

## 风险

- 旧数据 `current_rank`/`target_rank` 为 INT，ALTER 为 VARCHAR 可保留数字字符串
- 依赖变化一律重算会覆盖手改曝光/预算；已明确接受
