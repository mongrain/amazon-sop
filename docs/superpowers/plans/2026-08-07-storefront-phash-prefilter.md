# Storefront pHash 预筛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `compareStorefrontImages` 增加感知哈希预筛：汉明距离 ≤ 10 或哈希失败时直接返回无变化，仅在判定有差异时再调用现有 Sider AI 大模型对比。

**Architecture:** 新建 `service/image-phash.js` 负责下载图片、pHash 计算与汉明距离；在 `gpt.js` 用统一入口 `compareStorefrontImages` 先调预筛，再按需调用 `compareStorefrontImagesBySiderAi`。调用方 `server.js` 不改动。

**Tech Stack:** Node.js CommonJS、`axios`（已有）、`imghash`

## Global Constraints

- 阈值默认 `10`，可用环境变量 `STOREFRONT_PHASH_THRESHOLD` 覆盖
- 哈希失败：warn 日志 + 返回无变化，不降级调用 LLM
- 返回结构必须与现有一致：`{ is_changed, promotion_type, change_details, summary }`
- 不修改 `server.js`、`service/imagediff/*`
- 不引入除 `imghash` 以外的新直接依赖
- 仅在用户明确要求时创建 git commit（本计划步骤中的 commit 为可选）

## File Structure

| 文件 | 职责 |
|------|------|
| `service/image-phash.js` | 下载、pHash、汉明距离、`perceptualHashCompare` |
| `gpt.js` | 统一入口封装预筛 + LLM |
| `package.json` / lockfile | 新增 `imghash` |
| `test/test-image-phash.js` | 汉明距离与 compare 返回结构的单元测试 |

---

### Task 1: 安装依赖并实现 `service/image-phash.js`

**Files:**
- Create: `service/image-phash.js`
- Create: `test/test-image-phash.js`
- Modify: `package.json`（通过包管理器安装自动更新）

**Interfaces:**
- Produces:
  - `hammingDistance(hashA: string, hashB: string): number`
  - `perceptualHashCompare(urlA: string, urlB: string, options?: { threshold?: number }): Promise<{ similar: boolean, distance: number, threshold: number }>`
  - 失败时抛出 Error（由 `gpt.js` 捕获）

- [ ] **Step 1: 安装依赖**

在仓库根目录执行（项目有 `pnpm-lock.yaml`，优先 pnpm）：

```bash
pnpm add imghash
```

若 pnpm 不可用：

```bash
npm install imghash
```

Expected: `package.json` dependencies 出现 `imghash`。

- [ ] **Step 2: 写失败测试（汉明距离 + 模块可加载）**

创建 `test/test-image-phash.js`：

```js
const { hammingDistance, perceptualHashCompare } = require('../service/image-phash');

let passed = 0;
let failed = 0;

function ok(name) {
    passed += 1;
    console.log(`  ✓ ${name}`);
}

function fail(name, err) {
    failed += 1;
    console.error(`  ✗ ${name}: ${err.message || err}`);
}

function assertEqual(actual, expected, name) {
    if (actual !== expected) {
        throw new Error(`期望 ${expected}，实际 ${actual}`);
    }
    ok(name);
}

async function main() {
    console.log('=== image-phash 单元测试 ===\n');

    try {
        assertEqual(hammingDistance('ff00', 'ff00'), 0, '相同 hash 距离为 0');
    } catch (err) {
        fail('相同 hash 距离为 0', err);
    }

    try {
        // ff00 vs fe00：最低字节差 1 bit（按 hex 位展开后距离应为 1）
        const d = hammingDistance('ff00', 'fe00');
        if (d !== 1) throw new Error(`期望距离 1，实际 ${d}`);
        ok('差 1 bit 的 hash 距离为 1');
    } catch (err) {
        fail('差 1 bit 的 hash 距离为 1', err);
    }

    try {
        await perceptualHashCompare('http://invalid.local/a.png', 'http://invalid.local/b.png');
        fail('无效 URL 应抛错', new Error('未抛错'));
    } catch (err) {
        if (String(err && err.message).includes('未抛错')) {
            // already failed
        } else {
            ok('无效 URL 抛错');
        }
    }

    console.log(`\n通过 ${passed}，失败 ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 3: 运行测试确认失败**

```bash
node test/test-image-phash.js
```

Expected: FAIL（模块不存在或函数未导出）

- [ ] **Step 4: 实现 `service/image-phash.js`**

```js
const axios = require('axios');
const imghash = require('imghash');

const DEFAULT_THRESHOLD = 10;

function hammingDistance(hashA, hashB) {
    const a = String(hashA || '').toLowerCase();
    const b = String(hashB || '').toLowerCase();
    if (!a || !b || a.length !== b.length) {
        throw new Error('无效的感知哈希');
    }
    let dist = 0;
    for (let i = 0; i < a.length; i += 1) {
        const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
        // 统计 4bit 中的 1
        dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
    }
    return dist;
}

async function downloadImageBuffer(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: Number(process.env.STOREFRONT_PHASH_TIMEOUT_MS || 30000),
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024
    });
    return Buffer.from(response.data);
}

async function computePhash(buffer) {
    // imghash 对 Buffer 走 hashRaw；bits=8 → 64-bit pHash（16 个 hex 字符）
    const hash = await imghash.hash(buffer, 8);
    return String(hash);
}

async function perceptualHashCompare(urlA, urlB, { threshold = DEFAULT_THRESHOLD } = {}) {
    const bufA = await downloadImageBuffer(urlA);
    const bufB = await downloadImageBuffer(urlB);
    const hashA = await computePhash(bufA);
    const hashB = await computePhash(bufB);
    const distance = hammingDistance(hashA, hashB);
    const th = Number(threshold);
    return {
        similar: distance <= th,
        distance,
        threshold: th
    };
}

module.exports = {
    hammingDistance,
    computePhash,
    perceptualHashCompare,
    downloadImageBuffer
};
```

说明：`imghash` 以 `sharp` 为传递依赖处理常见图片格式；若运行时 `imghash.hash(Buffer)` API 与文档不符，改为先写入临时文件再 `imghash.hash(filePath, 8)`，用完删除临时文件（仅作实现兜底，优先 Buffer）。

- [ ] **Step 5: 运行测试确认通过**

```bash
node test/test-image-phash.js
```

Expected: 全部通过（无效 URL 抛错用例通过）

- [ ] **Step 6: Commit（仅当用户明确要求时）**

```bash
git add package.json pnpm-lock.yaml package-lock.json service/image-phash.js test/test-image-phash.js
git commit -m "$(cat <<'EOF'
feat: 新增店铺截图感知哈希预筛模块

EOF
)"
```

---

### Task 2: 在 `gpt.js` 封装统一入口

**Files:**
- Modify: `gpt.js`
- Test: `test/test-gpt.js`（可选补充预筛短路说明；核心验证用临时脚本或扩展现有测试）

**Interfaces:**
- Consumes: `perceptualHashCompare` from `./service/image-phash`
- Produces: `compareStorefrontImages(imageUrlA, imageUrlB) -> Promise<{ is_changed, promotion_type, change_details, summary }>`

- [ ] **Step 1: 修改 `gpt.js`**

在文件顶部增加：

```js
const { perceptualHashCompare } = require('./service/image-phash');
```

在 `compareStorefrontImagesBySiderAi` 之后新增：

```js
function unchangedResult() {
    return {
        is_changed: false,
        promotion_type: 'None',
        change_details: [],
        summary: ''
    };
}

async function compareStorefrontImages(imageUrlA, imageUrlB) {
    try {
        const threshold = Number(process.env.STOREFRONT_PHASH_THRESHOLD || 10);
        const pre = await perceptualHashCompare(imageUrlA, imageUrlB, { threshold });
        console.log('感知哈希预筛', { distance: pre.distance, threshold: pre.threshold, similar: pre.similar });
        if (pre.similar) {
            return unchangedResult();
        }
    } catch (err) {
        console.warn('感知哈希预筛失败，按无修改处理:', err.message || err);
        return unchangedResult();
    }
    return compareStorefrontImagesBySiderAi(imageUrlA, imageUrlB);
}
```

将导出从：

```js
module.exports = { compareStorefrontImages: compareStorefrontImagesBySiderAi, parseGptJsonContent, chatCompletionJson, chatCompletionText, chat };
```

改为：

```js
module.exports = { compareStorefrontImages, parseGptJsonContent, chatCompletionJson, chatCompletionText, chat };
```

- [ ] **Step 2: 自检语法与导出**

```bash
node -e "const g=require('./gpt'); console.log(typeof g.compareStorefrontImages)"
```

Expected: 打印 `function`

- [ ] **Step 3: 验证哈希失败短路（不调 LLM）**

```bash
node -e "(async()=>{ const {compareStorefrontImages}=require('./gpt'); const r=await compareStorefrontImages('http://127.0.0.1:9/a.png','http://127.0.0.1:9/b.png'); console.log(JSON.stringify(r)); })()"
```

Expected: `{"is_changed":false,"promotion_type":"None","change_details":[],"summary":""}`，且不因 LLM 抛错而失败。

- [ ] **Step 4: Commit（仅当用户明确要求时）**

```bash
git add gpt.js
git commit -m "$(cat <<'EOF'
feat: compareStorefrontImages 接入感知哈希预筛

EOF
)"
```

---

### Task 3: 规格对齐自检

**Files:**
- Verify only（只读对照 `docs/superpowers/specs/2026-08-07-storefront-phash-prefilter-design.md`）

- [ ] **Step 1: 对照 checklist**

确认以下全部满足：

1. `compareStorefrontImages` 为统一入口，先 pHash 再 LLM  
2. 默认阈值 10，环境变量可覆盖  
3. 相似 → `is_changed: false`  
4. 哈希失败 → warn + 无变化，不调 LLM  
5. `server.js` / `imagediff` 未改  
6. 仅新增 `imghash` 直接依赖

- [ ] **Step 2: 跑单元测试**

```bash
node test/test-image-phash.js
```

Expected: exit code 0

---

## Spec Coverage

| Spec 要求 | Task |
|-----------|------|
| `service/image-phash.js` | Task 1 |
| `gpt.js` 统一封装 | Task 2 |
| 依赖 imghash | Task 1 |
| 阈值 10 / env | Task 1–2 |
| 哈希失败按无变化 | Task 2 |
| 不改 server.js | Task 3 验证 |
| 返回结构一致 | Task 2 |

## Placeholder Scan

无 TBD/TODO；实现代码完整给出。
