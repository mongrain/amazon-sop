# 竞品监控图片回传接口文档

## 1. 接口说明

- 接口名称：竞品监控图片回传接口
- 使用对象：外部监控团队
- 接口用途：每半小时回传一次竞品监控图片地址，由系统自动对比前后两次截图并判断是否有变化

## 2. 业务规则

- 仅竞品库中 `status = 0` 的竞品允许回传
- 每次回传都会保存一条监控记录
- 系统会自动查询该竞品上一条监控图片，与本次图片进行 AI 视觉对比
- 首次回传（无历史图片）时，`has_change` 固定为 `false`
- 若 AI 判定 `has_change = false`，只保存监控记录，不新增变化动作
- 若 AI 判定 `has_change = true`，除了保存监控记录，还会新增一条变化动作，文案取自 AI 返回的 `summary`

## 3. 请求信息

- 请求方式：`POST`
- 请求路径：`/api/external/competitor-monitor`
- Content-Type：`application/json`

## 4. 请求参数

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `competitor_id` | number/string | 否 | 竞品 ID，推荐优先传这个 |
| `brand_name` | string | 否 | 竞品品牌名；当没有 `competitor_id` 时可用它匹配 |
| `image_url` | string | 是 | 监控图片地址，最大 1000 字符 |

> `has_change` 与 `action_text` 不再由外部传入，均由系统通过 AI 图片对比自动生成。

## 5. 参数规则

- `competitor_id` 和 `brand_name` 至少传一个
- 推荐传 `competitor_id`，避免品牌名重复导致识别不准确

## 6. 请求示例

### 6.1 常规回传

```json
{
  "competitor_id": 12,
  "image_url": "https://example.com/monitor/2026-06-11-1030.png"
}
```

### 6.2 按品牌名回传

```json
{
  "brand_name": "BrandX",
  "image_url": "https://example.com/monitor/2026-06-11-1130.png"
}
```

## 7. 成功响应

```json
{
  "status": "ok",
  "competitor_id": 12,
  "brand_name": "BrandX",
  "monitor_record_id": 88,
  "has_change": true,
  "action_text": "首页横幅更换为 Prime Day 促销主题",
  "action_added": true
}
```

## 8. 成功响应字段说明

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | 固定为 `ok` |
| `competitor_id` | number | 系统识别到的竞品 ID |
| `brand_name` | string | 系统识别到的品牌名 |
| `monitor_record_id` | number/null | 本次监控记录 ID |
| `has_change` | boolean | AI 对比结果，是否有实质性变化 |
| `action_text` | string/null | AI 生成的变化摘要（`summary`） |
| `action_added` | boolean | 是否新增了变化动作 |

## 9. 失败响应示例

### 9.1 参数缺失

```json
{
  "error": "competitor_id 或 brand_name 至少传一个"
}
```

### 9.2 竞品不存在

```json
{
  "error": "竞品不存在"
}
```

### 9.3 竞品不是跟踪状态

```json
{
  "error": "当前竞品不是跟踪状态，不能接收监控回传"
}
```

### 9.4 未传图片地址

```json
{
  "error": "image_url 为必填项"
}
```

### 9.5 AI 对比失败

```json
{
  "error": "GPT 返回内容为空"
}
```

## 10. HTTP 状态码

- `200`：成功
- `400`：请求参数错误，或当前竞品不可回传
- `404`：竞品不存在
- `500`：服务端异常（含 AI 对比失败）

## 11. 调用建议

- 推荐固定每 30 分钟调用一次
- 推荐统一传 `competitor_id`
- 推荐 `image_url` 传完整地址，例如 `https://...`
- 首次回传仅建立基准图，不会产生变化动作；从第二次回传开始才会进行 AI 对比

## 12. curl 示例

```bash
curl -X POST "http://你的域名/api/external/competitor-monitor" \
  -H "Content-Type: application/json" \
  -d "{\"competitor_id\":12,\"image_url\":\"https://example.com/monitor/test.png\"}"
```
