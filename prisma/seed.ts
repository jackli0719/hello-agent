// 数据库种子脚本 — 把现有 mock 数据写入本地 PostgreSQL。
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
    id: "PA001",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    enabled: true,
  },
  {
    id: "PA002",
    province: "广东省",
    city: "深圳市",
    district: "福田区",
    street: "华强北街道",
    enabled: true,
  },
  {
    id: "PA003",
    province: "广东省",
    city: "广州市",
    district: "天河区",
    street: "石牌街道",
    enabled: true,
  },
  {
    id: "PA004",
    province: "广东省",
    city: "深圳市",
    district: "宝安区",
    street: "西乡街道",
    enabled: true,
  },
];

const MERCHANT_AREAS = [
  { merchantId: "M001", platformAreaId: "PA001", enabled: true },
  { merchantId: "M001", platformAreaId: "PA004", enabled: true },
  { merchantId: "M002", platformAreaId: "PA001", enabled: true },
  { merchantId: "M002", platformAreaId: "PA002", enabled: true },
  { merchantId: "M003", platformAreaId: "PA003", enabled: true },
] as const;

const MASTER_MERCHANT_BY_ID: Record<string, string> = {
  T001: "M001",
  T002: "M002",
  T003: "M001",
  T004: "M002",
  T005: "M002",
};

const MERCHANTS = [
  {
    id: "M001",
    name: "深圳南山服务商 A",
    contactName: "南山负责人",
    phone: "13900001001",
    status: "active",
    // [任务 4] 邀请码：active + inviteCodeEnabled=true（可入驻）
    inviteCode: "NANSHAN01",
    inviteCodeEnabled: true,
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    addressDetail: "科技园演示地址 1 号",
  },
  {
    id: "M002",
    name: "深圳福田服务商 B",
    contactName: "福田负责人",
    phone: "13900001002",
    status: "active",
    // [任务 4] 邀请码：active + inviteCodeEnabled=false（禁用 — 用于测拒绝）
    inviteCode: "FUTIAN02",
    inviteCodeEnabled: false,
    province: "广东省",
    city: "深圳市",
    district: "福田区",
    street: "华强北街道",
    addressDetail: "华强北演示地址 2 号",
  },
  {
    id: "M003",
    name: "广州天河服务商 C",
    contactName: "天河负责人",
    phone: "13900001003",
    status: "inactive",
    // [任务 4] 邀请码：inactive 商家 — 用于测 status=inactive 拒绝
    inviteCode: "TIANHE03",
    inviteCodeEnabled: true,
    province: "广东省",
    city: "广州市",
    district: "天河区",
    street: "石牌街道",
    addressDetail: "石牌演示地址 3 号",
  },
];

function parseSeedAddress(address: string) {
  const candidates = PLATFORM_AREAS.map((area) => {
    const prefix = `${area.province}${area.city}${area.district}${area.street}`;
    return { area, prefix };
  });
  const matched = candidates.find(({ prefix }) => address.startsWith(prefix));
  if (!matched) {
    throw new Error(`seed 地址无法匹配平台合作区域：${address}`);
  }
  return {
    province: matched.area.province,
    city: matched.area.city,
    district: matched.area.district,
    street: matched.area.street,
    addressDetail: address.slice(matched.prefix.length).trim(),
  };
}

function formatPeriod(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function seedSettlementPreviewsAndSummaries() {
  const completedOrders = await prisma.order.findMany({
    where: { status: "completed" },
    include: {
      master: {
        include: {
          merchant: {
            include: {
              commissionStrategies: {
                where: { enabled: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  for (const order of completedOrders) {
    if (!order.master?.merchant) continue;
    const strategy = order.master.merchant.commissionStrategies[0] ?? null;
    const platformAmount = strategy
      ? Math.round(order.amount * strategy.platformRate)
      : order.amount;
    const merchantAmount = strategy
      ? Math.round(order.amount * strategy.merchantRate)
      : 0;
    const workerAmount = strategy
      ? Math.round(order.amount * strategy.workerRate)
      : 0;
    await prisma.settlementPreview.create({
      data: {
        orderId: order.id,
        merchantId: order.master.merchant.id,
        masterId: order.master.id,
        strategyId: strategy?.id ?? null,
        orderAmount: order.amount,
        platformAmount,
        merchantAmount,
        workerAmount,
        status: "generated",
        createdAt: order.scheduledAt,
      },
    });
  }

  const previews = await prisma.settlementPreview.findMany();
  const groups = new Map<
    string,
    {
      merchantId: string;
      period: string;
      totalOrderCount: number;
      totalAmount: number;
      platformFee: number;
      merchantIncome: number;
      workerIncome: number;
    }
  >();
  for (const preview of previews) {
    const period = formatPeriod(preview.createdAt);
    const key = `${preview.merchantId}|${period}`;
    const current = groups.get(key) ?? {
      merchantId: preview.merchantId,
      period,
      totalOrderCount: 0,
      totalAmount: 0,
      platformFee: 0,
      merchantIncome: 0,
      workerIncome: 0,
    };
    current.totalOrderCount += 1;
    current.totalAmount += preview.orderAmount;
    current.platformFee += preview.platformAmount;
    current.merchantIncome += preview.merchantAmount;
    current.workerIncome += preview.workerAmount;
    groups.set(key, current);
  }

  for (const group of groups.values()) {
    await prisma.merchantSettlement.create({ data: group });
  }

  return {
    settlementPreviews: completedOrders.length,
    merchantSettlements: groups.size,
  };
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

  // ----- 1. 清表（按依赖倒序） -----
  await prisma.activityLog.deleteMany();
  await prisma.merchantSettlement.deleteMany();
  await prisma.settlementPreview.deleteMany();
  await prisma.user.deleteMany();
  await prisma.order.deleteMany();
  await prisma.merchantArea.deleteMany();
  await prisma.commissionStrategy.deleteMany();
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

  // ----- 3.5. PlatformArea / Merchant（任务 1：商家平台模式底座）-----
  await prisma.platformArea.createMany({ data: PLATFORM_AREAS });
  console.log(`  ✓ PlatformArea × ${PLATFORM_AREAS.length}`);

  await prisma.merchant.createMany({ data: MERCHANTS });
  console.log(`  ✓ Merchant × ${MERCHANTS.length}`);

  // [任务 5] 分成策略 — 每个商家至少 1 条，结算历史不因商家 inactive 丢失
  const merchants = await prisma.merchant.findMany({
    select: { id: true, name: true },
  });
  const strategyCount = merchants.length;
  for (const m of merchants) {
    await prisma.commissionStrategy.create({
      data: {
        merchantId: m.id,
        name: "默认策略",
        strategyType: "percentage",
        platformRate: 0.1,
        merchantRate: 0.2,
        workerRate: 0.7,
        enabled: true,
      },
    });
  }
  console.log(`  ✓ CommissionStrategy × ${strategyCount}`);

  await prisma.merchantArea.createMany({ data: [...MERCHANT_AREAS] });
  console.log(`  ✓ MerchantArea × ${MERCHANT_AREAS.length}`);

  // ----- 4. Master -----
  // [任务 4] MOCK_TECHNICIANS 5 个师傅分布到 M001/M002，避免只测单商家路径
  for (const m of MOCK_TECHNICIANS) {
    const merchantId = MASTER_MERCHANT_BY_ID[m.id] ?? "M001";
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
        merchantId,
      },
    });
  }
  // [任务 4] 额外 1 个通过邀请码入驻的师傅 — phone 11 位 1 开头 / joinSource=invite_code
  // 用于演示：/masters 列表可看到 joinSource=invite_code 标记
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
      merchantId: "M001", // 通过 Nanshan01 邀请码入驻
      joinSource: "invite_code",
    },
  });
  console.log(
    `  ✓ Master × ${MOCK_TECHNICIANS.length + 1}（含 1 个 invite_code）`,
  );

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
        ...parseSeedAddress(o.address),
        scheduledAt: new Date(o.scheduledAt),
        amount: Math.round(o.amount * 100),
        status: o.status,
      },
    });
  }
  // [任务 X 修 — 2026-07-03] payOrder 集成测试需要 2 笔 unpaid 订单样本
  // 任务 X 时只在 seed-demo.ts 加了演示数据；db:reset 跑 seed.ts 缺这 2 笔 → 测试挂
  // 这里补回，让 db:reset 流程自包含
  const payTestSamples = [
    {
      id: "O20260629002",
      customerName: "测试客户 A",
      customerPhone: "13900000099", // customer1 的手机号
      serviceName: "日常保洁 2 小时",
      technicianName: null as string | null,
      address: "广东省深圳市南山区粤海街道科技园 200 号",
      scheduledAt: "2026-06-29T10:00:00+08:00",
      amount: 200,
      status: "pending",
      payStatus: "unpaid",
    },
    {
      id: "O20260630002",
      customerName: "测试客户 B",
      customerPhone: "13900000088", // customer2 的手机号（演示）
      serviceName: "日常保洁 2 小时",
      technicianName: null as string | null,
      address: "广东省深圳市福田区华强北街道华强路 99 号",
      scheduledAt: "2026-06-30T14:00:00+08:00",
      amount: 200,
      status: "pending",
      payStatus: "unpaid",
    },
  ];
  for (const o of payTestSamples) {
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
        ...parseSeedAddress(o.address),
        scheduledAt: new Date(o.scheduledAt),
        amount: Math.round(o.amount * 100),
        status: o.status,
        payStatus: o.payStatus,
      },
    });
  }
  console.log(`  ✓ Order × ${MOCK_ORDERS.length + payTestSamples.length}（含 ${payTestSamples.length} 笔 payOrder 测试样本）`);

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

  const settlementCounts = await seedSettlementPreviewsAndSummaries();
  console.log(
    `  ✓ SettlementPreview × ${settlementCounts.settlementPreviews} / MerchantSettlement × ${settlementCounts.merchantSettlements}`,
  );

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

  // ----- 7.5. Notification（[任务 19] 通知中心示例）-----
  // 给 3 个测试账号各灌 3-4 条历史通知（含已读 + 未读混合），演示时打开 /notifications 即可看到。
  // 注意：只在 customer1 / worker1 存在时灌（admin 看 ActivityLog 不发通知）。
  // 不在断言里硬等条数（避免 Notification 表清空后断言失败）。
  const customer1 = await prisma.user.findUnique({ where: { name: "customer1" } });
  const worker1 = await prisma.user.findUnique({ where: { name: "worker1" } });
  if (customer1) {
    await prisma.notification.createMany({
      data: [
        {
          userId: customer1.id,
          role: "customer",
          type: "order_paid",
          title: "订单已支付",
          content: `您的订单 ${MOCK_ORDERS[0]?.id ?? "O0001"} 已支付成功（¥${(MOCK_ORDERS[0]?.amount ?? 100).toFixed(2)}），等待派单`,
          orderId: MOCK_ORDERS[0]?.id ?? "O0001",
          metadata: JSON.stringify({ amount: MOCK_ORDERS[0]?.amount }),
          createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), // 3 天前
        },
        {
          userId: customer1.id,
          role: "customer",
          type: "order_assigned",
          title: "订单已派单",
          content: `您的订单 ${MOCK_ORDERS[1]?.id ?? "O0002"} 已派给师傅${MOCK_ORDERS[1]?.technicianName ?? "李师傅"}，请保持电话畅通`,
          orderId: MOCK_ORDERS[1]?.id ?? "O0002",
          readAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), // 已读
          metadata: JSON.stringify({ masterName: MOCK_ORDERS[1]?.technicianName }),
          createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        },
        {
          userId: customer1.id,
          role: "customer",
          type: "order_completed",
          title: "服务已完成",
          content: `您的订单 ${MOCK_ORDERS[1]?.id ?? "O0002"} 服务已完成`,
          orderId: MOCK_ORDERS[1]?.id ?? "O0002",
          readAt: new Date(Date.now() - 1 * 24 * 3600 * 1000), // 已读
          metadata: JSON.stringify({}),
          createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
        },
        {
          userId: customer1.id,
          role: "customer",
          type: "order_canceled",
          title: "订单已取消",
          content: `您的订单 O0006 已取消：客户改时间`,
          orderId: "O0006",
          metadata: JSON.stringify({ cancelReason: "客户改时间" }),
          createdAt: new Date(Date.now() - 5 * 3600 * 1000), // 5 小时前（最新 → 列表顶部）
        },
      ],
    });
  }
  if (worker1) {
    await prisma.notification.createMany({
      data: [
        {
          userId: worker1.id,
          role: "worker",
          type: "order_assigned",
          title: "订单已派单",
          content: `您有一个新任务：订单 ${MOCK_ORDERS[1]?.id ?? "O0002"}`,
          orderId: MOCK_ORDERS[1]?.id ?? "O0002",
          readAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
          metadata: JSON.stringify({}),
          createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        },
        {
          userId: worker1.id,
          role: "worker",
          type: "order_completed",
          title: "服务已完成",
          content: `您已完成订单 ${MOCK_ORDERS[1]?.id ?? "O0002"}`,
          orderId: MOCK_ORDERS[1]?.id ?? "O0002",
          metadata: JSON.stringify({}),
          createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
        },
        {
          userId: worker1.id,
          role: "worker",
          type: "order_canceled",
          title: "订单已取消",
          content: `订单 O0006 已被取消：师傅临时有事`,
          orderId: "O0006",
          metadata: JSON.stringify({ cancelReason: "师傅临时有事" }),
          createdAt: new Date(Date.now() - 4 * 3600 * 1000),
        },
      ],
    });
  }
  const notifCount = await prisma.notification.count();
  console.log(`  ✓ Notification × ${notifCount}（示例 — customer1 / worker1）`);

  // ----- 8. 校验 -----
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
    counts.categories !== categoryNames.length ||
    counts.skus !== MOCK_SERVICES.length ||
    // [任务 4] MOCK_TECHNICIANS 5 个 + T006 邀请码入驻 1 个 = 6 个
    counts.masters !== MOCK_TECHNICIANS.length + 1 ||
    counts.orders !== MOCK_ORDERS.length + payTestSamples.length ||
    counts.platformAreas !== PLATFORM_AREAS.length ||
    counts.merchants !== MERCHANTS.length ||
    counts.merchantAreas !== MERCHANT_AREAS.length ||
    counts.commissionStrategies !== MERCHANTS.length ||
    counts.settlementPreviews !== settlementCounts.settlementPreviews ||
    counts.merchantSettlements !== settlementCounts.merchantSettlements ||
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
