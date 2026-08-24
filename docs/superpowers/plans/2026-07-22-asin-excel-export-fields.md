# 数据采集 Excel 导出字段精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数据采集 ASIN Excel 导出仅输出 ASIN、标题、五点、价格四列。

**Architecture:** 在 `export.js` 增加固定列白名单；`buildExportData` 只按白名单投影行数据；`column-labels.js` 将五点表头改为「五点」。JSON 导出与爬取链路不动。

**Tech Stack:** Node.js、xlsx、现有 assert 单测脚本

**Spec:** `docs/superpowers/specs/2026-07-22-asin-excel-export-fields-design.md`

## Global Constraints

- Excel 仅四列，顺序固定：ASIN → 标题 → 五点 → 价格
- 价格字段：`product.buybox.price.value`
- 五点字段：`product.feature_bullets`，表头「五点」
- 缺字段单元格留空，不报错
- 不改 JSON 导出、爬取、缓存、flatten、前端
- 不引入新依赖
- 未经用户要求不 git commit

---

## File Map

| 文件 | 职责 |
|------|------|
| `service/data-collection/asin/export.js` | 白名单列 + `buildExportData` 投影 |
| `service/data-collection/asin/column-labels.js` | 「卖点」→「五点」 |
| `test/test-asin-crawler-export.js` | 白名单、表头、缺字段留空 |

---

### Task 1: 导出白名单与表头

**Files:**
- Modify: `service/data-collection/asin/export.js`
- Modify: `service/data-collection/asin/column-labels.js`
- Modify: `test/test-asin-crawler-export.js`

**Interfaces:**
- Produces: `EXPORT_COLUMNS`（`string[]`，固定 4 项）；`buildExportData` 返回的 `columns` 始终等于该白名单

- [ ] **Step 1: 写失败单测**

替换/扩展 `test/test-asin-crawler-export.js` 为：

```js
const assert = require('assert');
const XLSX = require('xlsx');
const {
    EXPORT_COLUMNS,
    buildExportFilename,
    buildWorkbook
} = require('../service/data-collection/asin/export');
const { translateColumnHeader, buildColumnLabels } = require('../service/data-collection/asin/column-labels');

assert.deepStrictEqual(EXPORT_COLUMNS, [
    '_crawl_asin',
    'product.title',
    'product.feature_bullets',
    'product.buybox.price.value'
]);

assert.strictEqual(translateColumnHeader('product.title'), '标题');
assert.strictEqual(translateColumnHeader('product.feature_bullets'), '五点');
assert.strictEqual(translateColumnHeader('product.buybox.price.value'), '价格');
assert.strictEqual(buildExportFilename(['B0TEST1234'], 'json'), 'B0TEST1234.json');
assert.strictEqual(buildExportFilename(['A', 'B'], 'xlsx'), 'A_B.xlsx');

const columnLabels = buildColumnLabels(EXPORT_COLUMNS);
assert.deepStrictEqual(
    EXPORT_COLUMNS.map(c => columnLabels[c]),
    ['ASIN', '标题', '五点', '价格']
);

const wb = buildWorkbook({
    columns: EXPORT_COLUMNS,
    rows: [{
        _crawl_asin: 'B0TEST1234',
        'product.title': 'Hello',
        'product.feature_bullets': 'line one\nline two'
        // 故意缺价格
    }],
    columnLabels
});
assert.ok(wb.SheetNames.includes('ASIN数据'));
const sheet = wb.Sheets['ASIN数据'];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
assert.deepStrictEqual(aoa[0], ['ASIN', '标题', '五点', '价格']);
assert.deepStrictEqual(aoa[1], ['B0TEST1234', 'Hello', 'line one\nline two', '']);

console.log('test-asin-crawler-export: PASS');
```

- [ ] **Step 2: 跑测确认失败**

Run: `node test/test-asin-crawler-export.js`  
Expected: FAIL（`EXPORT_COLUMNS` 未导出，或「卖点」≠「五点」）

- [ ] **Step 3: 改 `column-labels.js`**

```js
'product.feature_bullets': '五点',
```

以及：

```js
feature_bullets: '五点',
```

- [ ] **Step 4: 改 `export.js`**

在文件顶部 `require` 之后增加：

```js
const EXPORT_COLUMNS = [
    '_crawl_asin',
    'product.title',
    'product.feature_bullets',
    'product.buybox.price.value'
];
```

将 `buildExportData` 改为：

```js
async function buildExportData(jobId) {
    const items = await queryAll(
        `SELECT asin, flat_json FROM asin_crawl_items
         WHERE job_id = ? AND status = 'success' AND flat_json IS NOT NULL
         ORDER BY id ASC`,
        [Number(jobId)]
    );
    const asins = items.map(item => item.asin);
    const columns = [...EXPORT_COLUMNS];
    const columnLabels = buildColumnLabels(columns);

    const rows = items.map(item => {
        const flat = typeof item.flat_json === 'string'
            ? JSON.parse(item.flat_json)
            : (item.flat_json || {});
        const row = { _crawl_asin: item.asin };
        for (const col of columns) {
            if (col === '_crawl_asin') continue;
            const value = flat[col];
            row[col] = value == null ? '' : value;
        }
        return row;
    });

    return { columns, rows, columnLabels, asins };
}
```

`module.exports` 增加 `EXPORT_COLUMNS`。

`buildWorkbook` 保持不变（已按 `columns` 输出）。

- [ ] **Step 5: 跑测确认通过**

Run: `node test/test-asin-crawler-export.js`  
Expected: `test-asin-crawler-export: PASS`

- [ ] **Step 6: Commit（仅当用户明确要求时）**

```bash
git add service/data-collection/asin/export.js service/data-collection/asin/column-labels.js test/test-asin-crawler-export.js docs/superpowers/specs/2026-07-22-asin-excel-export-fields-design.md docs/superpowers/plans/2026-07-22-asin-excel-export-fields.md
git commit -m "$(cat <<'EOF'
fix(data-collection): Excel 导出仅保留 ASIN/标题/五点/价格

EOF
)"
```

---

## Spec Coverage Self-Review

| Spec 要求 | Task |
|-----------|------|
| Excel 仅四列且顺序固定 | Task 1 |
| 价格用 `product.buybox.price.value` | Task 1 `EXPORT_COLUMNS` |
| 五点表头「五点」 | Task 1 `column-labels.js` |
| 缺字段留空 | Task 1 投影逻辑 + 单测 |
| 不改 JSON / 爬取 / 前端 | 无对应改动（刻意） |
