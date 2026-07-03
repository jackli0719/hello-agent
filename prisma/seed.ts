// 数据库种子脚本 — 把现有 mock 数据写入本地 PostgreSQL。
// 运行：`npm run db:seed`（依赖 db:push 先建好表）
//
// [v1.0] 扩 seed：复用 seed-demo.ts 的 demoMain() 灌完整演示数据
// 解决任务 18+X 集成测试 baseline 81 fail（fixture 缺失）
// 保留 seed.ts 独有的 T006 邀请码师傅 + 2 笔 payTestSamples
// count 校验对齐 demo 预期 + 增量

import { PrismaClient } from "@prisma/client";
import { demoMain } from "./seed-demo";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 开始 seed（含演示数据）...");

  // ----- 1. 灌完整演示数据 -----
  await demoMain();

  // ----- 2. seed.ts 独占：T006 邀请码师傅 + 2 笔 payTestSamples -----
  // （demoMain 已灌 T001~T005；T006 是邀请码入驻样本，给 /masters 列表看 joinSource=invite_code 标记）
  // （payTestSamples 是 payOrder 集成测试 fixture，payStatus=unpaid）

  // 2.1 T006 邀请码师傅
  await prisma.master.create({
    data: {
      id: "T006",
      name: "林师傅",
      phone: "13900088001",
      skills: JSON.stringify(["保洁", "家电清洗"]),
      rating: 5.0,
      completedJobs: 0,
      status: "offline",
      serviceArea: "深圳",
      merchantId: "M001",
      joinSource: "invite_code",
    },
  });
  console.log("  ✓ Master T006（邀请码入驻样本）");

  // 2.2 payTestSamples — [v1.0] demo 已包含 O20260629002 + O20260630002（payStatus=unpaid）
  //     不再重复灌，payOrder 集成测试直接用 demo 自己的两笔
  console.log(
    "  ✓ Order payTestSamples（O20260629002 + O20260630002，demo 已灌）",
  );

  // ----- 8. 校验 -----
  // [v1.0] seed 改为调 demoMain + 追加 T006 + payTestSamples
  // 期望值：seed-demo 灌 5 master + 9 user + 20 orders + 3 merchants + ...
  //       + 1 master (T006) + 2 orders (payTestSamples)
  const counts = {
    categories: await prisma.serviceCategory.count(),
    skus: await prisma.serviceSku.count(),
    masters: await prisma.master.count(),
    orders: await prisma.order.count(),
    rules: await prisma.dispatchRule.count(),
    platformAreas: await prisma.platformArea.count(),
    merchants: await prisma.merchant.count(),
    merchantAreas: await prisma.merchantArea.count(),
    commissionStrategies: await prisma.commissionStrategy.count(),
    settlementPreviews: await prisma.settlementPreview.count(),
    merchantSettlements: await prisma.merchantSettlement.count(),
    users: await prisma.user.count(),
    activityLogs: await prisma.activityLog.count(),
  };
  console.log("📊 当前数据：", counts);

  if (
    // [v1.0] seed-demo 预期：categories=3 / skus=8 / masters=5 / orders=20 / users=9
    //        + 1 master (T006) (payTestSamples O20260629002/O20260630002 已在 demo 20 笔里)
    counts.categories !== 3 ||
    counts.skus !== 8 ||
    counts.masters !== 6 || // 5 (demo) + 1 (T006)
    counts.orders !== 20 || // demo 20 笔 (含 payTestSamples)
    counts.users !== 9 || // 1 admin + 2 customer + 4 worker + 2 merchant (demo)
    counts.merchants !== 3 // M001/M002/M003
  ) {
    throw new Error(
      `seed 后行数对不上（期望 categories=3 / skus=8 / masters=6 / orders=20 / users=9 / merchants=3）\n` +
        `实际：${JSON.stringify(counts, null, 2)}`,
    );
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
