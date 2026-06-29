/**
 * SQLite → PostgreSQL 数据迁移脚本
 *
 * 用途：阶段 3 — 把 prisma/dev.db 里的数据搬到 Postgres。
 *
 * 设计原则：
 * - 源用 better-sqlite3 直读（不跟 Prisma 跨 provider 冲）
 * - 目标用 PrismaClient（schema.prisma 配的 Postgres）
 * - 只读源 SQLite，绝不删/改源数据
 * - 全部用「存在则跳过」策略，可重复跑
 * - unique 冲突：跳过 + warn 打印，不中断
 * - 启动时打印源/目标连接串，让用户看清楚
 *
 * 依赖顺序（外键 → 主键）：
 *   1. ServiceCategory  (no FK)
 *   2. ServiceSku       (FK → ServiceCategory)
 *   3. Master           (no FK)
 *   4. Order            (FK → ServiceSku, Master)
 *   5. DispatchRule     (no FK)
 *
 * 运行：
 *   npm run db:migrate:sqlite-to-postgres
 *
 * 前提：
 *   - .env 里 DATABASE_URL 指向目标 Postgres
 *   - prisma/dev.db 存在且 schema 是旧版 sqlite
 */

import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import * as path from "node:path";

// ============================================================
// 启动横幅
// ============================================================

function printBanner(
  srcPath: string,
  dstUrl: string,
  srcRowCounts: Record<string, number>,
) {
  const line = "─".repeat(70);
  console.log(line);
  console.log("🔄 SQLite → PostgreSQL 数据迁移");
  console.log(line);
  console.log("  源 (SQLite):    ", srcPath);
  console.log("  目标 (Postgres):", dstUrl);
  console.log(line);
  console.log("  源数据快照：");
  for (const [name, n] of Object.entries(srcRowCounts)) {
    console.log(`    - ${name}: ${n} 条`);
  }
  console.log(line);
  console.log("  ⚠️  本脚本只读源数据，绝不删除/修改 SQLite。");
  console.log("  ⚠️  重复跑是安全的（存在则跳过）。");
  console.log(line);
  console.log("");
}

// ============================================================
// 统计
// ============================================================

interface Stats {
  total: number;
  inserted: number;
  skipped: number;
  errors: number;
}

function newStats(): Stats {
  return { total: 0, inserted: 0, skipped: 0, errors: 0 };
}

function printStats(name: string, stats: Stats) {
  console.log(
    `  ${name}: 总 ${stats.total} · 新增 ${stats.inserted} · 跳过 ${stats.skipped} · 错 ${stats.errors}`,
  );
}

// ============================================================
// 迁移函数
// ============================================================

async function migrateServiceCategory(
  src: Database.Database,
  dst: PrismaClient,
): Promise<Stats> {
  const stats = newStats();
  const rows = src
    .prepare("SELECT * FROM ServiceCategory ORDER BY createdAt ASC")
    .all() as any[];
  stats.total = rows.length;

  for (const row of rows) {
    try {
      const existing = await dst.serviceCategory.findUnique({
        where: { categoryCode: row.categoryCode },
      });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      await dst.serviceCategory.create({
        data: {
          id: row.id,
          name: row.name,
          categoryCode: row.categoryCode,
          enabled: Boolean(row.enabled),
          createdAt: new Date(row.createdAt),
        },
      });
      stats.inserted += 1;
    } catch (e: any) {
      stats.errors += 1;
      console.warn(`    ⚠️  ${row.categoryCode}: ${e.message}`);
    }
  }
  return stats;
}

async function migrateServiceSku(
  src: Database.Database,
  dst: PrismaClient,
): Promise<Stats> {
  const stats = newStats();
  const rows = src
    .prepare("SELECT * FROM ServiceSku ORDER BY createdAt ASC")
    .all() as any[];
  stats.total = rows.length;

  for (const row of rows) {
    try {
      const existing = await dst.serviceSku.findUnique({
        where: { skuCode: row.skuCode },
      });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      await dst.serviceSku.create({
        data: {
          id: row.id,
          skuCode: row.skuCode,
          name: row.name,
          categoryId: row.categoryId,
          basePrice: row.basePrice,
          durationMinutes: row.durationMinutes,
          requiredSkills: row.requiredSkills,
          enabled: Boolean(row.enabled),
          createdAt: new Date(row.createdAt),
        },
      });
      stats.inserted += 1;
    } catch (e: any) {
      stats.errors += 1;
      console.warn(`    ⚠️  ${row.skuCode}: ${e.message}`);
    }
  }
  return stats;
}

async function migrateMaster(
  src: Database.Database,
  dst: PrismaClient,
): Promise<Stats> {
  const stats = newStats();
  const rows = src
    .prepare("SELECT * FROM Master ORDER BY createdAt ASC")
    .all() as any[];
  stats.total = rows.length;

  // Master 没有 schema 级别的 unique — 用 (name, phone) 组合做幂等键
  for (const row of rows) {
    try {
      const existing = await dst.master.findFirst({
        where: { name: row.name, phone: row.phone },
      });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      await dst.master.create({
        data: {
          id: row.id,
          name: row.name,
          phone: row.phone,
          skills: row.skills,
          rating: row.rating,
          completedJobs: row.completedJobs,
          status: row.status,
          serviceArea: row.serviceArea,
          createdAt: new Date(row.createdAt),
        },
      });
      stats.inserted += 1;
    } catch (e: any) {
      stats.errors += 1;
      console.warn(`    ⚠️  ${row.name}(${row.phone}): ${e.message}`);
    }
  }
  return stats;
}

async function migrateOrder(
  src: Database.Database,
  dst: PrismaClient,
): Promise<Stats> {
  const stats = newStats();
  const rows = src
    .prepare("SELECT * FROM `Order` ORDER BY createdAt ASC")
    .all() as any[];
  stats.total = rows.length;

  for (const row of rows) {
    try {
      const existing = await dst.order.findUnique({ where: { id: row.id } });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      await dst.order.create({
        data: {
          id: row.id,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          serviceSkuId: row.serviceSkuId,
          serviceName: row.serviceName,
          masterId: row.masterId,
          masterName: row.masterName,
          address: row.address,
          scheduledAt: new Date(row.scheduledAt),
          amount: row.amount,
          status: row.status,
          remark: row.remark,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
      stats.inserted += 1;
    } catch (e: any) {
      stats.errors += 1;
      console.warn(`    ⚠️  ${row.id}: ${e.message}`);
    }
  }
  return stats;
}

async function migrateDispatchRule(
  src: Database.Database,
  dst: PrismaClient,
): Promise<Stats> {
  const stats = newStats();
  const rows = src
    .prepare("SELECT * FROM DispatchRule ORDER BY createdAt ASC")
    .all() as any[];
  stats.total = rows.length;

  // DispatchRule 也没有 unique — 按 name 幂等
  for (const row of rows) {
    try {
      const existing = await dst.dispatchRule.findFirst({
        where: { name: row.name },
      });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      await dst.dispatchRule.create({
        data: {
          id: row.id,
          name: row.name,
          priority: row.priority,
          enabled: Boolean(row.enabled),
          ruleJson: row.ruleJson,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
      stats.inserted += 1;
    } catch (e: any) {
      stats.errors += 1;
      console.warn(`    ⚠️  ${row.name}: ${e.message}`);
    }
  }
  return stats;
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  // ============================================================
  // 配置
  // ============================================================
  const dbPath = path.resolve(process.cwd(), "prisma/dev.db");
  const targetUrl = process.env.DATABASE_URL ?? "(unset)";

  // ============================================================
  // 1. 打开源 SQLite
  // ============================================================
  let srcDb: Database.Database;
  try {
    srcDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e: any) {
    console.error(`❌ 打不开源 SQLite: ${dbPath}`);
    console.error(`   ${e.message}`);
    process.exit(1);
  }

  // 抓源数据快照（启动横幅要用）
  const srcRowCounts: Record<string, number> = {};
  for (const table of [
    "ServiceCategory",
    "ServiceSku",
    "Master",
    "`Order`",
    "DispatchRule",
  ]) {
    const cleanTable = table.replace(/`/g, "");
    const row = srcDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    srcRowCounts[cleanTable] = row.n;
  }

  printBanner(dbPath, targetUrl, srcRowCounts);

  // 源 SQLite 没数据就退出
  const totalSrc =
    srcRowCounts.ServiceCategory +
    srcRowCounts.ServiceSku +
    srcRowCounts.Master +
    srcRowCounts.Order +
    srcRowCounts.DispatchRule;
  if (totalSrc === 0) {
    console.log("⚠️  源 SQLite 是空的 — 没有可迁移的数据。退出。");
    srcDb.close();
    return;
  }

  // ============================================================
  // 2. 打开目标 Postgres
  // ============================================================
  const dst = new PrismaClient();
  try {
    await dst.$connect();
  } catch (e: any) {
    console.error("❌ 连不上目标 Postgres，请检查 .env 的 DATABASE_URL:");
    console.error(`   ${e.message}`);
    srcDb.close();
    await dst.$disconnect();
    process.exit(1);
  }

  // ============================================================
  // 3. 目标已存在数据提示
  // ============================================================
  const dstCatCount = await dst.serviceCategory.count();
  if (dstCatCount > 0) {
    console.log(
      `ℹ️  目标 Postgres 已有 ${dstCatCount} 条 ServiceCategory — 已存在数据将自动跳过。`,
    );
    console.log("");
  }

  try {
    // ============================================================
    // 4. 按依赖顺序迁移
    // ============================================================
    console.log("📦 开始迁移...\n");

    console.log("[1/5] ServiceCategory");
    const catStats = await migrateServiceCategory(srcDb, dst);
    printStats("ServiceCategory", catStats);

    console.log("[2/5] ServiceSku");
    const skuStats = await migrateServiceSku(srcDb, dst);
    printStats("ServiceSku", skuStats);

    console.log("[3/5] Master");
    const masterStats = await migrateMaster(srcDb, dst);
    printStats("Master", masterStats);

    console.log("[4/5] Order");
    const orderStats = await migrateOrder(srcDb, dst);
    printStats("Order", orderStats);

    console.log("[5/5] DispatchRule");
    const ruleStats = await migrateDispatchRule(srcDb, dst);
    printStats("DispatchRule", ruleStats);

    // ============================================================
    // 5. 验证
    // ============================================================
    console.log("\n✅ 迁移完成 — 验证数据一致性...");
    const verify: Array<[string, number, number]> = [
      ["ServiceCategory", catStats.total, await dst.serviceCategory.count()],
      ["ServiceSku", skuStats.total, await dst.serviceSku.count()],
      ["Master", masterStats.total, await dst.master.count()],
      ["Order", orderStats.total, await dst.order.count()],
      ["DispatchRule", ruleStats.total, await dst.dispatchRule.count()],
    ];

    let allMatch = true;
    for (const [name, srcN, dstN] of verify) {
      // 目标计数应该 >= 源（如果目标有旧数据会更多）
      const status = dstN >= srcN ? "✓" : "✗";
      if (dstN < srcN) allMatch = false;
      console.log(`   ${status} ${name}: 源 ${srcN} / 目标 ${dstN}`);
    }

    if (allMatch) {
      console.log("\n🎉 全部数据已迁移到 Postgres。");
    } else {
      console.log("\n⚠️  目标数据少于源 — 请检查错误日志。");
      process.exit(1);
    }
  } catch (e: any) {
    console.error("❌ 迁移失败:", e.message);
    process.exit(1);
  } finally {
    srcDb.close();
    await dst.$disconnect();
  }
}

main();
