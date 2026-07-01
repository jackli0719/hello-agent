// 数据库种子脚本 — 把现有 mock 数据原样写入 SQLite。
// 运行：`npm run db:seed`（依赖 db:push 先建好表）

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MOCK_ORDERS, MOCK_SERVICES, MOCK_TECHNICIANS } from "../lib/mock-data";
import { assertValidCode } from "../src/lib/codes";

const prisma = new PrismaClient();

// [v0.5.0] 密码哈希 — bcrypt rounds=10（演示足够）
const BCRYPT_ROUNDS = 10;

const PLATFORM_AREAS = [
  {
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    enabled: true,
  },
  {
    province: "广东省",
    city: "深圳市",
    district: "福田区",
    street: "华强北街道",
    enabled: true,
  },
  {
    province: "广东省",
    city: "广州市",
    district: "天河区",
    street: "石牌街道",
    enabled: true,
  },
  {
    province: "广东省",
    city: "深圳市",
    district: "宝安区",
    street: "西乡街道",
    enabled: true,
  },
];

const MERCHANTS = [
  {
    name: "深圳南山服务商 A",
    contactName: "南山负责人",
    phone: "13900001001",
    status: "active",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    addressDetail: "科技园演示地址 1 号",
  },
  {
    name: "深圳福田服务商 B",
    contactName: "福田负责人",
    phone: "13900001002",
    status: "active",
    province: "广东省",
    city: "深圳市",
    district: "福田区",
    street: "华强北街道",
    addressDetail: "华强北演示地址 2 号",
  },
  {
    name: "广州天河服务商 C",
    contactName: "天河负责人",
    phone: "13900001003",
    status: "active",
    province: "广东省",
    city: "广州市",
    district: "天河区",
    street: "石牌街道",
    addressDetail: "石牌演示地址 3 号",
  },
];

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

  // ----- 1. 清表（按依赖倒序） -----
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.order.deleteMany();
  await prisma.serviceSku.deleteMany();
  await prisma.serviceCategory.deleteMany();
  await prisma.master.deleteMany();
  await prisma.dispatchRule.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.platformArea.deleteMany();
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
  // [v0.5.0] 密码 bcrypt 哈希（修 ADR-013 A1 P0 风险）
  await prisma.user.createMany({
    data: [
      {
        name: "admin",
        phone: null,
        password: await bcrypt.hash("admin123", BCRYPT_ROUNDS),
        role: "admin",
        workerId: null,
      },
      {
        // 绑第一个 Master（演示用）
        name: "worker1",
        phone: MOCK_TECHNICIANS[0]?.phone ?? "13900000001",
        password: await bcrypt.hash("worker123", BCRYPT_ROUNDS),
        role: "worker",
        workerId: MOCK_TECHNICIANS[0]?.id ?? null,
      },
      {
        name: "customer1",
        // 用一个测试手机号（seed 订单里也用这个号，方便演示）
        phone: "13900000099",
        password: await bcrypt.hash("customer123", BCRYPT_ROUNDS),
        role: "customer",
        workerId: null,
      },
    ],
  });
  console.log(
    `  ✓ User × 3（admin / worker1 / customer1，密码已 bcrypt 哈希）`,
  );

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

  // ----- 6.5. PlatformArea / Merchant（任务 1：商家平台模式底座）-----
  await prisma.platformArea.createMany({ data: PLATFORM_AREAS });
  console.log(`  ✓ PlatformArea × ${PLATFORM_AREAS.length}`);

  await prisma.merchant.createMany({ data: MERCHANTS });
  console.log(`  ✓ Merchant × ${MERCHANTS.length}`);

  // ----- 7. ActivityLog（操作日志示例）-----
  // 仅 5 条示例，让 Dashboard 启动就有内容看
  await prisma.activityLog.createMany({
    data: [
      {
        actorId: null,
        actorName: "system",
        actorRole: "system",
        action: "service_sku_created",
        targetType: "serviceSku",
        targetId: MOCK_SERVICES[0]?.id ?? "S001",
        message: `初始化服务 SKU：${MOCK_SERVICES[0]?.name ?? ""}`,
        metadata: JSON.stringify({ skuCode: MOCK_SERVICES[0]?.skuCode }),
      },
      {
        actorId: null,
        actorName: "system",
        actorRole: "system",
        action: "master_created",
        targetType: "master",
        targetId: MOCK_TECHNICIANS[0]?.id ?? "T001",
        message: `初始化师傅：${MOCK_TECHNICIANS[0]?.name ?? ""}`,
        metadata: JSON.stringify({ phone: MOCK_TECHNICIANS[0]?.phone }),
      },
      {
        actorId: null,
        actorName: "system",
        actorRole: "system",
        action: "order_created",
        targetType: "order",
        targetId: MOCK_ORDERS[0]?.id ?? "O0001",
        message: `客户 ${MOCK_ORDERS[0]?.customerName ?? ""} 创建了订单 ${MOCK_ORDERS[0]?.id ?? ""}`,
        metadata: JSON.stringify({ skuCode: MOCK_ORDERS[0]?.serviceName }),
      },
      {
        actorId: null,
        actorName: "system",
        actorRole: "system",
        action: "order_assigned",
        targetType: "order",
        targetId: MOCK_ORDERS[1]?.id ?? "O0002",
        message: `管理员将订单 ${MOCK_ORDERS[1]?.id ?? ""} 派给师傅 ${MOCK_ORDERS[1]?.technicianName ?? ""}`,
        metadata: JSON.stringify({
          masterName: MOCK_ORDERS[1]?.technicianName,
        }),
      },
      {
        actorId: null,
        actorName: "system",
        actorRole: "system",
        action: "dispatch_rule_created",
        targetType: "dispatchRule",
        targetId: "seed-rule-1",
        message: "初始化派单规则：SKU 精确：S003 空调清洗（挂机）",
        metadata: JSON.stringify({ priority: 100 }),
      },
    ],
  });
  console.log(`  ✓ ActivityLog × 5（示例）`);

  // ----- 8. 校验 -----
  const counts = {
    categories: await prisma.serviceCategory.count(),
    skus: await prisma.serviceSku.count(),
    masters: await prisma.master.count(),
    orders: await prisma.order.count(),
    rules: await prisma.dispatchRule.count(),
    platformAreas: await prisma.platformArea.count(),
    merchants: await prisma.merchant.count(),
    users: await prisma.user.count(),
    activityLogs: await prisma.activityLog.count(),
  };
  console.log("📊 当前数据：", counts);

  if (
    counts.categories !== categoryNames.length ||
    counts.skus !== MOCK_SERVICES.length ||
    counts.masters !== MOCK_TECHNICIANS.length ||
    counts.orders !== MOCK_ORDERS.length ||
    counts.platformAreas !== PLATFORM_AREAS.length ||
    counts.merchants !== MERCHANTS.length ||
    counts.users !== 3 ||
    counts.activityLogs !== 5
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
