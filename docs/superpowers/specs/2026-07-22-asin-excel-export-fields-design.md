# 数据采集 Excel 导出字段精简

日期：2026-07-22  
状态：已确认设计，待实现

## 背景

数据采集 ASIN 爬取完成后，Excel 导出现在会把 `flat_json` 中的全部扁平字段写出，列很多、不便使用。业务只需四列：ASIN、标题、五点、价格。

## 目标

1. Excel 导出仅包含固定四列，顺序为：ASIN → 标题 → 五点 → 价格
2. 价格取数值字段 `product.buybox.price.value`
3. 「五点」对应 `product.feature_bullets`，表头显示为「五点」
4. 缺字段时对应单元格留空，不报错

## 非目标

- 不改 JSON 导出（仍导出完整 `raw_json`）
- 不改爬取、缓存、flatten、前端展示逻辑
- 不做列勾选 / 自定义导出 UI
- 不改数据库结构

## 决策摘要

| 项 | 选择 |
|----|------|
| 实现方式 | 导出白名单（方案 1） |
| 价格字段 | `product.buybox.price.value` |
| 五点表头 | 「五点」（覆盖原「卖点」） |
| JSON 导出 | 保持全量不变 |

## 实现要点

### 改动文件

1. `service/data-collection/asin/export.js`
   - 增加固定列白名单与顺序：
     - `_crawl_asin`
     - `product.title`
     - `product.feature_bullets`
     - `product.buybox.price.value`
   - `buildExportData` 只按白名单组列与取值；不再扫描全部 flat 键
   - 空结果时表头仍为上述四列（含中文标签）

2. `service/data-collection/asin/column-labels.js`
   - `EXACT_LABELS['product.feature_bullets']`：`卖点` → `五点`
   - `SEGMENT_LABELS.feature_bullets` 同步为 `五点`（与精确标签一致）

3. `test/test-asin-crawler-export.js`
   - 覆盖白名单列顺序、中文表头、缺字段留空

### 数据流

```
exportJobToXlsx(jobId)
  → buildExportData：读 success 的 flat_json
  → 按白名单取 4 列
  → buildWorkbook → xlsx buffer
```

API 路径 `/api/data-collection/asin/jobs/:id/export.xlsx` 与前端下载按钮不变。

## 测试

- 单测：`buildExportData` / `buildWorkbook` 仅输出白名单列；表头为 ASIN、标题、五点、价格
- 手工：完成一次爬取任务后下载 Excel，确认只有四列且价格为数值

## 风险与兼容

- 已完成的历史任务同样按新白名单导出（数据仍在 `flat_json`，只是导出变少）
- 依赖页面或其它脚本若依赖「全量列 Excel」，需改用 JSON 导出；当前无此已知依赖
