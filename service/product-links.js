async function getProductByAsin(asin, dbCtx) {
    return dbCtx.queryOne(
        'SELECT id, asin, name, status, seq, link_group_id FROM products WHERE asin = ?',
        [asin]
    );
}

async function allocateLinkGroupId(dbCtx) {
    const row = await dbCtx.queryOne(
        'SELECT COALESCE(MAX(link_group_id), 0) + 1 AS gid FROM products'
    );
    return row.gid;
}

async function linkProducts(asinA, asinB, dbCtx) {
    const prodA = await getProductByAsin(asinA, dbCtx);
    const prodB = await getProductByAsin(asinB, dbCtx);
    if (!prodA || !prodB) throw new Error('产品不存在');
    if (asinA === asinB) throw new Error('不能关联自身');

    const groupA = prodA.link_group_id;
    const groupB = prodB.link_group_id;
    if (groupA && groupA === groupB) {
        return getRelatedProducts(asinA, dbCtx);
    }

    if (!groupA && !groupB) {
        const targetGroup = await allocateLinkGroupId(dbCtx);
        await dbCtx.runSql(
            'UPDATE products SET link_group_id = ?, updated_at = NOW() WHERE id IN (?, ?)',
            [targetGroup, prodA.id, prodB.id]
        );
    } else if (groupA && !groupB) {
        await dbCtx.runSql(
            'UPDATE products SET link_group_id = ?, updated_at = NOW() WHERE id = ?',
            [groupA, prodB.id]
        );
    } else if (!groupA && groupB) {
        await dbCtx.runSql(
            'UPDATE products SET link_group_id = ?, updated_at = NOW() WHERE id = ?',
            [groupB, prodA.id]
        );
    } else {
        await dbCtx.runSql(
            'UPDATE products SET link_group_id = ?, updated_at = NOW() WHERE link_group_id = ?',
            [groupA, groupB]
        );
    }

    return getRelatedProducts(asinA, dbCtx);
}

async function cleanupOrphanLinkGroup(groupId, dbCtx) {
    const remaining = await dbCtx.queryAll(
        'SELECT id FROM products WHERE link_group_id = ?',
        [groupId]
    );
    if (remaining.length === 1) {
        await dbCtx.runSql(
            'UPDATE products SET link_group_id = NULL, updated_at = NOW() WHERE id = ?',
            [remaining[0].id]
        );
    }
}

async function removeFromLinkGroup(productId, groupId, dbCtx) {
    await dbCtx.runSql(
        'UPDATE products SET link_group_id = NULL, updated_at = NOW() WHERE id = ?',
        [productId]
    );
    await cleanupOrphanLinkGroup(groupId, dbCtx);
}

async function unlinkProduct(asin, dbCtx) {
    const prod = await getProductByAsin(asin, dbCtx);
    if (!prod) throw new Error('产品不存在');
    if (!prod.link_group_id) return [];

    await removeFromLinkGroup(prod.id, prod.link_group_id, dbCtx);
    return [];
}

async function unlinkRelatedProduct(asin, relatedAsin, dbCtx) {
    const prod = await getProductByAsin(asin, dbCtx);
    if (!prod) throw new Error('产品不存在');

    const related = await getProductByAsin(relatedAsin, dbCtx);
    if (!related) throw new Error('关联产品不存在');
    if (!prod.link_group_id || prod.link_group_id !== related.link_group_id) {
        throw new Error('两个产品未关联');
    }

    await removeFromLinkGroup(related.id, prod.link_group_id, dbCtx);
    return getRelatedProducts(asin, dbCtx);
}

async function getRelatedProducts(asin, dbCtx) {
    const prod = await getProductByAsin(asin, dbCtx);
    if (!prod || !prod.link_group_id) return [];

    const rows = await dbCtx.queryAll(
        `SELECT id, asin, name, status, seq
         FROM products
         WHERE link_group_id = ? AND asin != ?
         ORDER BY asin ASC`,
        [prod.link_group_id, asin]
    );
    return rows || [];
}

async function fetchAsinLinkMap(dbCtx) {
    const rows = await dbCtx.queryAll(
        'SELECT asin, link_group_id FROM products WHERE link_group_id IS NOT NULL'
    );
    const byGroup = new Map();
    for (const row of rows || []) {
        if (!byGroup.has(row.link_group_id)) byGroup.set(row.link_group_id, []);
        byGroup.get(row.link_group_id).push(row.asin);
    }

    const map = new Map();
    for (const [groupId, asins] of byGroup) {
        for (const asin of asins) {
            map.set(asin, {
                groupId,
                relatedAsins: asins.filter(a => a !== asin)
            });
        }
    }
    return map;
}

function round(v, digits = 2) {
    if (v == null || !Number.isFinite(v)) return null;
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
}

function enrichResultsWithGroupSales(results, asinLinkMap) {
    const buckets = new Map();

    for (const row of results) {
        const link = asinLinkMap.get(row.asin);
        if (!link) {
            row.relatedAsins = [];
            row.linkGroupAsins = [row.asin];
            row.groupSalesAmount = row.salesAmount || 0;
            continue;
        }
        row.relatedAsins = link.relatedAsins.filter(relatedAsin =>
            results.some(r => r.asin === relatedAsin && r.site === row.site)
        );
        const key = `${row.site}::${link.groupId}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
    }

    for (const [, groupRows] of buckets) {
        const groupSales = round(
            groupRows.reduce((sum, r) => sum + (r.salesAmount || 0), 0),
            2
        );
        const linkGroupAsins = groupRows.map(r => r.asin).sort((a, b) => a.localeCompare(b));
        for (const row of groupRows) {
            row.groupSalesAmount = groupSales;
            row.linkGroupAsins = linkGroupAsins;
        }
    }
}

/** 同站点关联组只保留一行：优先有订单的第一个，否则取 ASIN 最小 */
function collapseLinkGroupResults(results, asinLinkMap) {
    const standalone = [];
    const groupBuckets = new Map();

    for (const row of results) {
        const link = asinLinkMap.get(row.asin);
        if (!link) {
            standalone.push(row);
            continue;
        }
        const key = `${row.site}::${link.groupId}`;
        if (!groupBuckets.has(key)) groupBuckets.set(key, []);
        groupBuckets.get(key).push(row);
    }

    const collapsed = [];
    for (const [, groupRows] of groupBuckets) {
        if (groupRows.length === 1) {
            collapsed.push(groupRows[0]);
            continue;
        }
        const sorted = [...groupRows].sort((a, b) => {
            if (a.hasOrders !== b.hasOrders) return a.hasOrders ? -1 : 1;
            return a.asin.localeCompare(b);
        });
        const representative = sorted[0];
        representative.relatedAsins = (representative.linkGroupAsins || [])
            .filter(asin => asin !== representative.asin);
        collapsed.push(representative);
    }

    return [...standalone, ...collapsed];
}

module.exports = {
    linkProducts,
    unlinkProduct,
    unlinkRelatedProduct,
    getRelatedProducts,
    fetchAsinLinkMap,
    enrichResultsWithGroupSales,
    collapseLinkGroupResults
};
