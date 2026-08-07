# 店铺截图对比：感知哈希预筛设计

日期：2026-08-07  
状态：待审阅

## 背景

`compareStorefrontImages` 当前直接调用 Sider AI 大模型对比两张店铺主页截图，成本高且对「几乎相同」的图也会完整走 LLM。需要先用感知哈希（pHash）做本地预筛，仅在判定有视觉差异时再调用大模型。

## 目标

- 对外仍导出统一入口 `compareStorefrontImages`，`server.js` 等调用方无需改动。
- 汉明距离 ≤ 10 视为无实质差异，跳过 LLM。
- 哈希链路失败时按无变化处理（不抛错、不降级 LLM）。
- 返回结构与现有 LLM 结果字段一致。

## 非目标

- 不替换 Sider AI / API 对比实现本身。
- 不改监控入库、动作写入等业务逻辑。
- 不做批量哈希缓存或持久化。

## 架构

```
compareStorefrontImages(urlA, urlB)          // gpt.js 统一入口
  ├─ perceptualHashCompare(urlA, urlB)      // service/image-phash.js
  │    ├─ 下载图片
  │    ├─ imghash 计算 pHash
  │    └─ 汉明距离 ≤ threshold？
  │         ├─ 是 → 返回 unchanged 结果，结束
  │         └─ 否 → 继续
  └─ compareStorefrontImagesBySiderAi(...)  // 现有大模型路径
```

## 模块职责

### `service/image-phash.js`（新建）

- `downloadImageBuffer(url)`：下载为 Buffer（用完即释放，不强制落盘）。
- `computePhash(buffer)`：基于 `imghash` 计算十六进制 pHash（bits=8，64-bit / 16 hex 字符）。
- `hammingDistance(hashA, hashB)`：计算汉明距离。
- `perceptualHashCompare(urlA, urlB, { threshold = 10 })`：
  - 成功且距离 ≤ threshold → `{ similar: true, distance, threshold }`
  - 成功且距离 > threshold → `{ similar: false, distance, threshold }`
  - 任一步失败 → 抛错，由上层捕获后按无变化处理

### `gpt.js`

新增封装：

```js
async function compareStorefrontImages(imageUrlA, imageUrlB) {
  try {
    const pre = await perceptualHashCompare(imageUrlA, imageUrlB, {
      threshold: Number(process.env.STOREFRONT_PHASH_THRESHOLD || 10)
    });
    if (pre.similar) {
      return {
        is_changed: false,
        promotion_type: 'None',
        change_details: [],
        summary: ''
      };
    }
  } catch (err) {
    console.warn('感知哈希预筛失败，按无修改处理:', err.message || err);
    return {
      is_changed: false,
      promotion_type: 'None',
      change_details: [],
      summary: ''
    };
  }
  return compareStorefrontImagesBySiderAi(imageUrlA, imageUrlB);
}
```

`module.exports.compareStorefrontImages` 改为上述封装（不再直接等于 `BySiderAi`）。

## 依赖

- 新增：`imghash`（`sharp` 为其传递依赖，不直接声明）。
- 不引入其他无关依赖。

## 阈值与配置

| 项 | 默认 | 说明 |
|---|---|---|
| `STOREFRONT_PHASH_THRESHOLD` | `10` | 汉明距离 ≤ 该值视为相同 |

## 错误处理

| 场景 | 行为 |
|---|---|
| 哈希成功且距离 ≤ 10 | `is_changed: false`，不调 LLM |
| 哈希成功且距离 > 10 | 调现有 LLM，返回其结果 |
| 下载/解码/哈希失败 | warn 日志 + `is_changed: false`，不调 LLM |
| LLM 失败 | 仍由 `server.js` 现有 catch 处理 |

## 测试建议

- 两张相同图：应跳过 LLM，返回 `is_changed: false`。
- 两张明显不同图：应进入 LLM 路径（可 mock LLM）。
- 无效 URL：哈希失败 → `is_changed: false`，不抛到调用方。

## 变更文件

- 新建 `service/image-phash.js`
- 修改 `gpt.js`（统一入口封装）
- 修改 `package.json` / lockfile（新增依赖）
- 不修改 `server.js`、`service/imagediff/*`（除非后续复用下载逻辑，本次不做）
