// 数据库种子脚本 — 把现有 mock 数据原样写入 SQLite。
// 运行：`npm run db:seed`（依赖 db:push 先建好表）

import { PrismaClient } from "@prisma/client";
import { MOCK_ORDERS, MOCK_SERVICES, MOCK_TECHNICIANS } from "../lib/mock-data";
import { assertValidCode } from "../src/lib/codes";

const prisma = new PrismaClient();

/**
 * seed 前的「孤儿引用检测」。
 * 当直接跑 db:seed（不清表）时：如果 DB 里有订单引用了「新 seed 列表里没有」的 skuCode，
 * 我们删不掉这条引用（因为外键约束），seed 就会卡住或半成功。
 *
 * 这个函数给出清晰的错误：「以下订单引用的 skuCode 不在本次 seed 列表」+「请先清理」。
 *
 * db:reset 路径（先 deleteMany 再 seed）这个函数返回空数组，不影响流程。
 */
async function checkOrphanedReferences(): Promise<{
  sku: string[];
  category: string[];
}> {
  const newSkuCodes = new Set(MOCK_SERVICES.map((s) => s.skuCode));
  const newCategoryCodes = new Set(MOCK_SERVICES.map((s) => s.categoryCode));

  // 查所有「被 Order 引用、但不在新 seed 列表」的 SKU code
  const usedSkuCodes = await prisma.order.findMany({
    where: { serviceSkuId: { not: null } },
    select: { serviceSku: { select: { skuCode: true } } },
  });
  const orphanedSkus = usedSkuCodes
    .map((r) => r.serviceSku?.skuCode)
    .filter(
      (code): code is string => code !== undefined && !newSkuCodes.has(code),
    );
  const uniqueOrphanedSkus = Array.from(new Set(orphanedSkus));

  // 同理检查 category（Order 不直接引 category，但 Master.skills 可能引；
  // 当前 schema Master.skills 是字符串数组，不做 deep 检查）
  // 简单做法：列出现在 DB 里有但 seed 列表里没的 categoryCode
  const dbCategories = await prisma.serviceCategory.findMany({
    select: { categoryCode: true },
  });
  const orphanedCategories = dbCategories
    .map((c) => c.categoryCode)
    .filter((code) => !newCategoryCodes.has(code));

  return { sku: uniqueOrphanedSkus, category: orphanedCategories };
}

async function main() {
  console.log("🌱 开始 seed...");

  // ----- 0. 校验所有业务编码格式（先报错，不要让坏数据进 DB） -----
  for (const s of MOCK_SERVICES) {
    assertValidCode(
      s.categoryCode,
      `ServiceCategory.categoryCode for "${s.name}"`,
    );
    assertValidCode(s.skuCode, `ServiceSku.skuCode for "${s.name}"`);
  }

  // ----- 0.5. 检测孤儿引用（直接 db:seed 时才有意义；db:reset 先清表会得到空数组） -----
  const orphans = await checkOrphanedReferences();
  if (orphans.sku.length > 0 || orphans.category.length > 0) {
    const lines: string[] = [];
    if (orphans.sku.length > 0) {
      lines.push(
        `  被订单引用的 SKU code（seed 中已不存在）: ${orphans.sku.join(", ")}`,
      );
    }
    if (orphans.category.length > 0) {
      lines.push(`  已下架的类目 code: ${orphans.category.join(", ")}`);
    }
    throw new Error(
      `seed 检测到孤儿引用，请先清理或跑 db:reset：\n${lines.join("\n")}`,
    );
  }

  // ----- 1. 清表（按依赖倒序） -----
  await prisma.user.deleteMany();
  await prisma.order.deleteMany();
  await prisma.serviceSku.deleteMany();
  await prisma.serviceCategory.deleteMany();
  await prisma.master.deleteMany();
  await prisma.dispatchRule.deleteMany();
  console.log("  ✓ 清空旧数据");

  // ----- 2. ServiceCategory -----
  // 同一类目名共享一个 categoryCode（从 SKU 上拿第一个）
  const categoryNames = Array.from(
    new Set(MOCK_SERVICES.map((s) => s.category)),
  );
  const categoryCodeByName = new Map<string, string>();
  for (const s of MOCK_SERVICES) {
    if (!categoryCodeByName.has(s.category)) {
      categoryCodeByName.set(s.category, s.categoryCode);
    }
  }
  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.serviceCategory.create({
        data: { name, categoryCode: categoryCodeByName.get(name)! },
      }),
    ),
  );
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));
  console.log(`  ✓ ServiceCategory × ${categories.length}`);

  // ----- 3. ServiceSku -----
  for (const s of MOCK_SERVICES) {
    const categoryId = categoryByName.get(s.category);
    if (!categoryId) throw new Error(`找不到类目 ${s.category}`);
    await prisma.serviceSku.create({
      data: {
        id: s.id,
        skuCode: s.skuCode,
        name: s.name,
        categoryId,
        basePrice: Math.round(s.basePrice * 100),
        durationMinutes: s.durationMinutes,
        requiredSkills: JSON.stringify(s.requiredSkills),
        enabled: s.enabled,
      },
    });
  }
  console.log(`  ✓ ServiceSku × ${MOCK_SERVICES.length}`);

  // ----- 4. Master -----
  for (const m of MOCK_TECHNICIANS) {
    await prisma.master.create({
      data: {
        id: m.id,
        name: m.name,
        phone: m.phone,
        skills: JSON.stringify(m.skills),
        rating: m.rating,
        completedJobs: m.completedJobs,
        status: m.status,
        serviceArea: m.serviceArea ?? "",
      },
    });
  }
  console.log(`  ✓ Master × ${MOCK_TECHNICIANS.length}`);

  // ----- 4.5. User（账号体系）-----
  // 测试账号：admin / worker1 / customer1
  // # MVP: password 明文存（按需求）
  await prisma.user.createMany({
    data: [
      {
        name: "admin",
        phone: null,
        password: "admin123",
        role: "admin",
        workerId: null,
      },
      {
        // 绑第一个 Master（演示用）
        name: "worker1",
        phone: MOCK_TECHNICIANS[0]?.phone ?? "13900000001",
        password: "worker123",
        role: "worker",
        workerId: MOCK_TECHNICIANS[0]?.id ?? null,
      },
      {
        name: "customer1",
        // 用一个测试手机号（seed 订单里也用这个号，方便演示）
        phone: "13900000099",
        password: "customer123",
        role: "customer",
        workerId: null,
      },
    ],
  });
  console.log(`  ✓ User × 3（admin / worker1 / customer1）`);

  // ----- 5. Order -----
  const skuByName = new Map(MOCK_SERVICES.map((s) => [s.name, s.id]));
  const masterByName = new Map(MOCK_TECHNICIANS.map((m) => [m.name, m.id]));

  for (const o of MOCK_ORDERS) {
    await prisma.order.create({
      data: {
        id: o.id,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        serviceSkuId: skuByName.get(o.serviceName) ?? null,
        serviceName: o.serviceName,
        masterId: o.technicianName
          ? (masterByName.get(o.technicianName) ?? null)
          : null,
        masterName: o.technicianName,
        address: o.address,
        scheduledAt: new Date(o.scheduledAt),
        amount: Math.round(o.amount * 100),
        status: o.status,
      },
    });
  }
  console.log(`  ✓ Order × ${MOCK_ORDERS.length}`);

  // ----- 6. DispatchRule -----
  // 两条规则演示「SKU 精确优先 + 类目兜底」：
  // - SKU 级：S003「空调清洗（挂机）」要求 ["空调维修"]
  // - 类目级：categoryId 对应「家政」类目要求 ["保洁"] — 兜底 S001/S002
  // 用类目名查 ID
  const jiazhengId = categoryByName.get("家政");
  if (!jiazhengId) throw new Error("找不到家政类目");

  await prisma.dispatchRule.create({
    data: {
      name: "SKU 精确：S003 空调清洗（挂机）",
      priority: 100,
      enabled: true,
      ruleJson: JSON.stringify({
        match: { skuId: "S003" },
        requiredSkills: ["空调维修"],
      }),
    },
  });

  await prisma.dispatchRule.create({
    data: {
      name: "类目兜底：家政",
      priority: 10,
      enabled: true,
      ruleJson: JSON.stringify({
        match: { categoryId: jiazhengId },
        requiredSkills: ["保洁"],
      }),
    },
  });

  console.log("  ✓ DispatchRule × 2");

  // ----- 7. 校验 -----
  const counts = {
    categories: await prisma.serviceCategory.count(),
    skus: await prisma.serviceSku.count(),
    masters: await prisma.master.count(),
    orders: await prisma.order.count(),
    rules: await prisma.dispatchRule.count(),
    users: await prisma.user.count(),
  };
  console.log("📊 当前数据：", counts);

  if (
    counts.categories !== categoryNames.length ||
    counts.skus !== MOCK_SERVICES.length ||
    counts.masters !== MOCK_TECHNICIANS.length ||
    counts.orders !== MOCK_ORDERS.length ||
    counts.users !== 3
  ) {
    throw new Error("seed 后行数对不上，请检查");
  }

  console.log("✅ seed 完成");
}

main()
  .catch((e) => {
    console.error("❌ seed 失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
