# 竞品监控图片回传接口文档

## 1. 接口说明

- 接口名称：竞品监控图片回传接口
- 使用对象：外部监控团队
- 接口用途：每半小时回传一次竞品监控图片地址，并告知本次是否有变化

## 2. 业务规则

- 仅竞品库中 `status = 0` 的竞品允许回传
- 每次回传都会保存一条监控记录
- 如果 `has_change = false`，只保存监控记录，不新增变化动作
- 如果 `has_change = true`，除了保存监控记录，还会新增一条变化动作 `action_text`

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
| `has_change` | boolean/number/string | 是 | 是否有变化，支持 `true`/`false`/`1`/`0` |
| `action_text` | string | 条件必填 | 变化说明，最大 2000 字符；当 `has_change = true` 时必填 |

## 5. 参数规则

- `competitor_id` 和 `brand_name` 至少传一个
- 推荐传 `competitor_id`，避免品牌名重复导致识别不准确
- `has_change = false` 时，`action_text` 可不传
- `has_change = true` 时，`action_text` 必须传

## 6. 请求示例

### 6.1 无变化

```json
{
  "competitor_id": 12,
  "image_url": "https://example.com/monitor/2026-06-11-1030.png",
  "has_change": false
}
```

### 6.2 有变化

```json
{
  "competitor_id": 12,
  "image_url": "https://example.com/monitor/2026-06-11-1100.png",
  "has_change": true,
  "action_text": "主图文案发生变化，新增了折扣角标，并调整了卖点顺序"
}
```

### 6.3 按品牌名回传

```json
{
  "brand_name": "BrandX",
  "image_url": "https://example.com/monitor/2026-06-11-1130.png",
  "has_change": true,
  "action_text": "A+模块新增对比表"
}
```

## 7. 成功响应

```json
{
  "status": "ok",
  "competitor_id": 12,
  "brand_name": "BrandX",
  "monitor_record_id": 88,
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

### 9.5 变化标记不合法

```json
{
  "error": "has_change 必须为 true/false 或 1/0"
}
```

### 9.6 有变化但未传说明

```json
{
  "error": "有变化时 action_text 为必填项"
}
```

## 10. HTTP 状态码

- `200`：成功
- `400`：请求参数错误，或当前竞品不可回传
- `404`：竞品不存在
- `500`：服务端异常

## 11. 调用建议

- 推荐固定每 30 分钟调用一次
- 推荐统一传 `competitor_id`
- 推荐 `image_url` 传完整地址，例如 `https://...`
- `action_text` 建议写清楚变化点，例如：主图变更、标题变更、A+变更、价格变化、优惠变化、视频新增、文案顺序调整

## 12. curl 示例

```bash
curl -X POST "http://你的域名/api/external/competitor-monitor" \
  -H "Content-Type: application/json" \
  -d "{\"competitor_id\":12,\"image_url\":\"https://example.com/monitor/test.png\",\"has_change\":true,\"action_text\":\"主图新增折扣角标\"}"
```
