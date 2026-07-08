/**
 * 迁移验证脚本 — 对比 SQLite vs Postgres 数据一致性
 *
 * 用途：阶段 4 模拟 — 在不动业务代码的前提下，
 *       读两边数据逐行对比，输出差异报告。
 *
 * 设计：
 * - 源：better-sqlite3 readonly（避免 Prisma 跨 provider 问题）
 * - 目标：PrismaClient（schema 配的 Postgres）
 * - 逐表对比：行数 + 每个字段值
 * - 输出：✓ 通过 或 ✗ 列出差异
 * - 退出码：0=一致，1=有差异
 *
 * 运行：
 *   npm run db:verify-migration
 *
 * 前提：
 *   - .env 的 DATABASE_URL 指向目标 Postgres
 *   - 目标 Postgres 已经跑过 migrate deploy + 数据迁移
 *   - prisma/dev.db 存在
 */

import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import * as path from "node:path";

// ============================================================
// 类型
// ============================================================

interface FieldDiff {
  field: string;
  src: any;
  dst: any;
}

interface RowDiff {
  key: string;
  diffs: FieldDiff[];
}

interface TableReport {
  name: string;
  srcCount: number;
  dstCount: number;
  missing: string[]; // 在源里但不在目标里
  extra: string[]; // 在目标里但不在源里
  fieldDiffs: RowDiff[]; // 字段值不一致
}

// ============================================================
// 工具
// ============================================================

function normalize(v: any): any {
  if (v === null || v === undefined) return null;
  // Date 对象 → ISO 字符串
  if (v instanceof Date) return v.toISOString();
  // Boolean（SQLite 0/1 vs Postgres boolean）
  if (typeof v === "boolean") return v ? 1 : 0;
  // SQLite 把 DateTime 存成 Unix timestamp（数字，秒或毫秒）
  // Postgres / Prisma 返回 Date 对象（上面已处理）
  // 启发式：> 1e12 视为毫秒；> 1e9 视为秒
  if (typeof v === "number") {
    if (v > 1e12) {
      // 毫秒 → ISO
      return new Date(v).toISOString();
    }
    if (v > 1e9) {
      // 秒 → ISO
      return new Date(v * 1000).toISOString();
    }
    return v;
  }
  if (typeof v === "string") return v;
  return String(v);
}

function deepEqual(a: any, b: any): boolean {
  return normalize(a) === normalize(b);
}

// ============================================================
// 表对比
// ============================================================

function compareTable(
  name: string,
  srcRows: any[],
  dstRows: any[],
  keyField: string,
): TableReport {
  const report: TableReport = {
    name,
    srcCount: srcRows.length,
    dstCount: dstRows.length,
    missing: [],
    extra: [],
    fieldDiffs: [],
  };

  // 用 keyField 建索引
  const dstByKey = new Map<string, any>();
  for (const r of dstRows) {
    dstByKey.set(String(r[keyField]), r);
  }
  const srcByKey = new Map<string, any>();
  for (const r of srcRows) {
    srcByKey.set(String(r[keyField]), r);
  }

  // 找 missing（源有目标无）+ 字段差异
  for (const [k, srcRow] of srcByKey) {
    const dstRow = dstByKey.get(k);
    if (!dstRow) {
      report.missing.push(k);
      continue;
    }
    // 字段级对比
    const diffs: FieldDiff[] = [];
    const allFields = new Set([...Object.keys(srcRow), ...Object.keys(dstRow)]);
    for (const field of allFields) {
      if (!deepEqual(srcRow[field], dstRow[field])) {
        diffs.push({
          field,
          src: normalize(srcRow[field]),
          dst: normalize(dstRow[field]),
        });
      }
    }
    if (diffs.length > 0) {
      report.fieldDiffs.push({ key: k, diffs });
    }
  }

  // 找 extra（目标有源无）
  for (const k of dstByKey.keys()) {
    if (!srcByKey.has(k)) {
      report.extra.push(k);
    }
  }

  return report;
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const dbPath = path.resolve(process.cwd(), "prisma/dev.db");
  const targetUrl = process.env.DATABASE_URL ?? "(unset)";

  console.log("─".repeat(70));
  console.log("🔍 迁移验证 — SQLite vs PostgreSQL");
  console.log("─".repeat(70));
  console.log("  源 (SQLite):    ", dbPath);
  console.log("  目标 (Postgres):", targetUrl);
  console.log("─".repeat(70));
  console.log("");

  // 源 SQLite
  const srcDb = new Database(dbPath, { readonly: true, fileMustExist: true });

  // 目标 Postgres
  const dst = new PrismaClient();
  try {
    await dst.$connect();
  } catch (e: any) {
    console.error("❌ 连不上目标 Postgres:");
    console.error(`   ${e.message}`);
    srcDb.close();
    await dst.$disconnect();
    process.exit(1);
  }

  const reports: TableReport[] = [];
  let hasDiff = false;

  try {
    // ============================================================
    // ServiceCategory（key = categoryCode）
    // ============================================================
    const srcCat = srcDb
      .prepare("SELECT * FROM ServiceCategory")
      .all() as any[];
    const dstCat = await dst.serviceCategory.findMany();
    reports.push(
      compareTable("ServiceCategory", srcCat, dstCat, "categoryCode"),
    );

    // ============================================================
    // ServiceSku（key = skuCode）
    // ============================================================
    const srcSku = srcDb.prepare("SELECT * FROM ServiceSku").all() as any[];
    const dstSku = await dst.serviceSku.findMany();
    reports.push(compareTable("ServiceSku", srcSku, dstSku, "skuCode"));

    // ============================================================
    // Master（key = id，schema 没 unique，用 id 兜底）
    // ============================================================
    const srcMaster = srcDb.prepare("SELECT * FROM Master").all() as any[];
    const dstMaster = await dst.master.findMany();
    reports.push(compareTable("Master", srcMaster, dstMaster, "id"));

    // ============================================================
    // Order（key = id）
    // ============================================================
    const srcOrder = srcDb.prepare("SELECT * FROM `Order`").all() as any[];
    const dstOrder = await dst.order.findMany();
    reports.push(compareTable("Order", srcOrder, dstOrder, "id"));

    // ============================================================
    // DispatchRule（key = id，schema 没 unique，用 id 兜底）
    // ============================================================
    const srcRule = srcDb.prepare("SELECT * FROM DispatchRule").all() as any[];
    const dstRule = await dst.dispatchRule.findMany();
    reports.push(compareTable("DispatchRule", srcRule, dstRule, "id"));

    // ============================================================
    // 输出报告
    // ============================================================
    console.log("📊 对比结果:\n");
    for (const r of reports) {
      const ok =
        r.missing.length === 0 &&
        r.extra.length === 0 &&
        r.fieldDiffs.length === 0;
      const icon = ok ? "✓" : "✗";
      if (!ok) hasDiff = true;

      console.log(`  ${icon} ${r.name}: 源 ${r.srcCount} / 目标 ${r.dstCount}`);

      if (r.missing.length > 0) {
        console.log(`    缺失 (${r.missing.length}):`);
        for (const k of r.missing) console.log(`      - ${k}`);
      }
      if (r.extra.length > 0) {
        console.log(`    多余 (${r.extra.length}):`);
        for (const k of r.extra) console.log(`      + ${k}`);
      }
      if (r.fieldDiffs.length > 0) {
        console.log(`    字段差异 (${r.fieldDiffs.length}):`);
        for (const row of r.fieldDiffs) {
          console.log(`      ${row.key}:`);
          for (const d of row.diffs) {
            console.log(
              `        ${d.field}: 源=${JSON.stringify(d.src)} 目标=${JSON.stringify(d.dst)}`,
            );
          }
        }
      }
    }

    console.log("");
    if (hasDiff) {
      console.log("⚠️  发现差异 — 迁移结果与源不完全一致。");
      process.exit(1);
    } else {
      console.log("🎉 全部表数据一致 — 迁移正确。");
    }
  } catch (e: any) {
    console.error("❌ 验证失败:", e.message);
    process.exit(1);
  } finally {
    srcDb.close();
    await dst.$disconnect();
  }
}

main();
