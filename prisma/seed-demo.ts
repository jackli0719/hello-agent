// Demo 数据初始化脚本 — [v0.9.2] 一键重置完整演示数据
//
// 跟 prisma/seed.ts（基础种子）平行存在，互不影响。
// 业务规则要求：覆盖三端完整演示链路
// - 1 admin + 2 customer + 4 worker
// - 4 师傅资料
// - 3 服务品类 + 8 服务 SKU
// - 20 订单覆盖 5 状态
// - 8 派单规则覆盖 SKU 精确 + 品类兜底 + 暂无推荐
// - 若干 Activity Log
//
// 用法：npm run seed:demo
// （外键顺序：清表倒序，写表正序 — 见 CLAUDE.md 业务规则 #7）
//
// # [v0.9.9] 生产保护：演示期项目，缺保护会清掉生产数据
// 触发条件（任一即拒执行）：
//   1. NODE_ENV === "production"
//   2. DATABASE_URL 指向非本地 DB（postgres:// 不含 localhost/127.0.0.1）
// 显式覆盖：设置 ALLOW_DEMO_SEED=1 可绕过保护（测试用）

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

// ============================================================
// [v0.9.9] 生产保护
// ============================================================
function guardProduction() {
  if (process.env.ALLOW_DEMO_SEED === "1") {
    console.log("⚠️  ALLOW_DEMO_SEED=1 — 跳过生产保护（不推荐，仅测试用）");
    return;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "seed:demo 在生产环境被禁用：会清空所有业务数据。\n" +
        "如果确认要跑，设置 ALLOW_DEMO_SEED=1。\n" +
        "（CLAUDE.md 错误卡类 4「流程纪律」+ v0.9.9 节点）",
    );
  }
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (
    dbUrl.startsWith("postgres://") &&
    !/localhost|127\.0\.0\.1/.test(dbUrl)
  ) {
    throw new Error(
      `seed:demo 在远程 DB 被禁用：${dbUrl}\n` +
        "如果确认要跑，设置 ALLOW_DEMO_SEED=1。",
    );
  }
  console.log("✓ 生产保护通过（本地 DB 或显式 ALLOW）");
}

// ============================================================
// 清表（按依赖倒序）
// ============================================================
async function clearAll() {
  await prisma.activityLog.deleteMany();
  await prisma.order.deleteMany();
  await prisma.dispatchRule.deleteMany();
  // [任务 2] MerchantArea 依赖 Merchant / PlatformArea，先于它俩删
  try {
    await prisma.merchantArea.deleteMany();
  } catch {
    // 老 Prisma Client 无 merchantArea — 跳过
  }
  await prisma.user.deleteMany();
  await prisma.master.deleteMany();
  try {
    await prisma.merchant.deleteMany();
  } catch {
    // 老 Prisma Client 无 merchant — 跳过
  }
  try {
    await prisma.platformArea.deleteMany();
  } catch {
    // 老 Prisma Client 无 platformArea — 跳过
  }
  await prisma.serviceSku.deleteMany();
  await prisma.serviceCategory.deleteMany();
}

// ============================================================
// 1. 服务品类 × 3
// ============================================================
const CATEGORIES = [
  { code: "CLEAN", name: "家政" },
  { code: "APPLIANCE", name: "家电清洗" },
  { code: "REPAIR", name: "维修" },
] as const;
// ============================================================
// 2. 服务 SKU × 8
// ============================================================
const SKUS = [
  {
    code: "CLEAN-DAILY-2H",
    name: "日常保洁 2 小时",
    categoryCode: "CLEAN",
    basePrice: 158,
    durationMinutes: 120,
    requiredSkills: ["保洁"],
    enabled: true,
  },
  {
    code: "CLEAN-DEEP-3H",
    name: "深度保洁 3 小时",
    categoryCode: "CLEAN",
    basePrice: 268,
    durationMinutes: 180,
    requiredSkills: ["保洁"],
    enabled: true,
  },
  {
    code: "APPLIANCE-AC-WALL",
    name: "空调清洗（挂机）",
    categoryCode: "APPLIANCE",
    basePrice: 128,
    durationMinutes: 60,
    requiredSkills: ["空调维修"],
    enabled: true,
  },
  {
    code: "APPLIANCE-AC-CABINET",
    name: "空调清洗（柜机）",
    categoryCode: "APPLIANCE",
    basePrice: 168,
    durationMinutes: 90,
    requiredSkills: ["空调维修"],
    enabled: true,
  },
  {
    code: "REPAIR-PIPE",
    name: "水管维修",
    categoryCode: "REPAIR",
    basePrice: 180,
    durationMinutes: 60,
    requiredSkills: ["水电维修"],
    enabled: true,
  },
  {
    code: "REPAIR-APPLIANCE",
    name: "家电维修",
    categoryCode: "REPAIR",
    basePrice: 120,
    durationMinutes: 60,
    requiredSkills: ["家电维修"],
    enabled: true,
  },
  {
    code: "CLEAN-LOCKSMITH",
    name: "开锁换锁",
    categoryCode: "CLEAN", // 用家政类目兜底演示
    basePrice: 199,
    durationMinutes: 30,
    requiredSkills: ["开锁"], // 没有任何师傅会「开锁」→ 演示「暂无推荐」
    enabled: true,
  },
  {
    code: "REPAIR-DISABLED",
    name: "已下架服务（演示）",
    categoryCode: "REPAIR",
    basePrice: 99,
    durationMinutes: 60,
    requiredSkills: [],
    enabled: false,
  },
] as const;

// ============================================================
// 2.5 平台合作区域 × 4（[任务 1] 平台确认开放合作的服务区域）
// ============================================================
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
] as const;

// ============================================================
// 2.6 服务商 / 商家 × 3（[任务 1] 商家基础资料）
// ============================================================
const MERCHANTS = [
  {
    id: "M001",
    name: "深圳南山服务商 A",
    contactName: "张三",
    phone: "13900000100",
    status: "active",
    // [任务 4] 邀请码 — 可入驻
    inviteCode: "NANSHAN01",
    inviteCodeEnabled: true,
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    addressDetail: "科技园 1 号楼 5 楼",
  },
  {
    id: "M002",
    name: "深圳福田服务商 B",
    contactName: "李四",
    phone: "13900000200",
    status: "active",
    // [任务 4] 邀请码 — 禁用（测 inviteCodeEnabled=false 拒）
    inviteCode: "FUTIAN02",
    inviteCodeEnabled: false,
    province: "广东省",
    city: "深圳市",
    district: "福田区",
    street: "华强北街道",
    addressDetail: "华强广场 A 座 12 楼 1203",
  },
  {
    id: "M003",
    name: "广州天河服务商 C",
    contactName: "王五",
    phone: "13900000300",
    status: "inactive",
    // [任务 4] 邀请码 — 商家 inactive 测拒
    inviteCode: "TIANHE03",
    inviteCodeEnabled: true,
    province: "广东省",
    city: "广州市",
    district: "天河区",
    street: "石牌街道",
    addressDetail: "天河路 383 号",
  },
] as const;

// ============================================================
// 2.7 商家合作区域绑定 × 4（[任务 2] 多对多）
// 覆盖场景：1 商家多区域 / 1 区域多商家
// 商家 A 绑 1 个、商家 B 绑 2 个、商家 C 绑 1 个
// 区域 PA001 被 2 个商家绑（验证多对多）
// ============================================================
const MERCHANT_AREAS = [
  { merchantId: "M001", platformAreaId: "PA001", enabled: true },
  { merchantId: "M002", platformAreaId: "PA001", enabled: true }, // PA001 被多商家
  { merchantId: "M002", platformAreaId: "PA002", enabled: true }, // 商家 B 绑多区域
  { merchantId: "M003", platformAreaId: "PA003", enabled: true },
] as const;

// ============================================================
// 3. 师傅 × 4（[任务 2] merchantId 必填）
// T001 绑商家 A, T002 绑商家 B, T003 绑商家 B (同商家多师傅), T004 绑商家 C
// ============================================================
const MASTERS = [
  {
    id: "T001",
    name: "李师傅",
    phone: "13900000010",
    skills: ["保洁", "家电清洗"],
    rating: 4.9,
    completedJobs: 326,
    serviceArea: "上海",
    merchantId: "M001", // 深圳南山服务商 A
  },
  {
    id: "T002",
    name: "赵师傅",
    phone: "13900000020",
    skills: ["水电维修", "管道疏通"],
    rating: 4.8,
    completedJobs: 412,
    serviceArea: "上海, 苏州",
    merchantId: "M002", // 深圳福田服务商 B
  },
  {
    id: "T003",
    name: "周姐",
    phone: "13900000030",
    skills: ["家电维修", "保洁"],
    rating: 5.0,
    completedJobs: 89,
    serviceArea: "上海",
    merchantId: "M002", // 深圳福田服务商 B（同商家多师傅）
  },
  {
    id: "T004",
    name: "孙师傅",
    phone: "13900000040",
    skills: ["空调维修", "家电维修"],
    rating: 4.6,
    completedJobs: 207,
    serviceArea: "上海, 北京",
    merchantId: "M003", // 广州天河服务商 C
  },
  {
    id: "T005",
    name: "林师傅",
    phone: "13900000050",
    skills: ["保洁", "家电清洗"],
    rating: 5.0,
    completedJobs: 0,
    serviceArea: "深圳",
    merchantId: "M001", // 通过 NANSHAN01 邀请码入驻
    joinSource: "invite_code", // [任务 4] 邀请码入驻
  },
] as const;

// ============================================================
// 4. User × 7（1 admin + 2 customer + 4 worker）
// ============================================================
const USERS = [
  // 1 admin
  {
    name: "admin",
    phone: null,
    password: "admin123",
    role: "admin",
    workerId: null,
  },
  // 2 customer — 演示查询用 customer1 / customer2
  {
    name: "customer1",
    phone: "13900000099",
    password: "customer123",
    role: "customer",
    workerId: null,
  },
  {
    name: "customer2",
    phone: "13900000088",
    password: "customer123",
    role: "customer",
    workerId: null,
  },
  // 4 worker — 各自绑到一个 master
  {
    name: "worker1",
    phone: "13900000010",
    password: "worker123",
    role: "worker",
    workerId: "T001",
  },
  {
    name: "worker2",
    phone: "13900000020",
    password: "worker123",
    role: "worker",
    workerId: "T002",
  },
  {
    name: "worker3",
    phone: "13900000030",
    password: "worker123",
    role: "worker",
    workerId: "T003",
  },
  {
    name: "worker4",
    phone: "13900000040",
    password: "worker123",
    role: "worker",
    workerId: "T004",
  },
] as const;

// ============================================================
// 5. 订单 × 20（实际场景分布）
// pending 8 + assigned 4 + in_service 4 + completed 3 + cancelled 1
// ============================================================
const ORDERS = [
  // ============ pending × 8 ============
  // 其中 2 个无推荐（演示「暂无推荐师傅」）
  {
    id: "O20260629001",
    customerName: "陈晓明",
    customerPhone: "13900000001",
    skuCode: "CLEAN-DEEP-3H",
    masterId: null,
    address: "广东省深圳市南山区粤海街道科技园 100 号",
    scheduledAt: "2026-06-29T10:00:00",
    amount: 268,
    status: "pending",
  },
  {
    id: "O20260629002",
    customerName: "王芳",
    customerPhone: "13900000002",
    skuCode: "APPLIANCE-AC-WALL",
    masterId: null,
    address: "广东省深圳市福田区华强北街道华强路 88 号",
    scheduledAt: "2026-06-29T14:00:00",
    amount: 128,
    status: "pending",
  },
  {
    id: "O20260629003",
    customerName: "刘建国",
    customerPhone: "13900000003",
    skuCode: "REPAIR-PIPE",
    masterId: null,
    address: "广东省广州市天河区石牌街道天河路 1234 号",
    scheduledAt: "2026-06-29T16:30:00",
    amount: 180,
    status: "pending",
  },
  {
    id: "O20260630001",
    customerName: "陈晓明",
    customerPhone: "13900000099", // customer1 的手机号 → 演示 customer1 登录能看到
    skuCode: "CLEAN-DAILY-2H",
    masterId: null,
    address: "广东省深圳市南山区粤海街道科技园 200 号",
    scheduledAt: "2026-06-30T09:00:00",
    amount: 158,
    status: "pending",
    remark: "客户要求戴鞋套",
  },
  {
    id: "O20260630002",
    customerName: "Sarah Liu",
    customerPhone: "13900000004",
    skuCode: "APPLIANCE-AC-CABINET",
    masterId: null,
    address: "广东省深圳市宝安区西乡街道宝源路 12 号",
    scheduledAt: "2026-06-30T11:00:00",
    amount: 168,
    status: "pending",
  },
  {
    id: "O20260630003",
    customerName: "赵敏",
    customerPhone: "13900000005",
    skuCode: "REPAIR-APPLIANCE",
    masterId: null,
    address: "广东省深圳市福田区华强北街道振华路 200 号",
    scheduledAt: "2026-06-30T14:00:00",
    amount: 120,
    status: "pending",
  },
  // 演示「暂无推荐师傅」 — 开锁换锁 SKU 没人会
  {
    id: "O20260630004",
    customerName: "周晓东",
    customerPhone: "13900000006",
    skuCode: "CLEAN-LOCKSMITH",
    masterId: null,
    address: "广东省深圳市南山区粤海街道高新南一道 333 号",
    scheduledAt: "2026-06-30T15:00:00",
    amount: 199,
    status: "pending",
    remark: "钥匙锁家里了，需要紧急开锁",
  },
  // 演示「暂无推荐师傅」 — 用 REPAIR-DISABLED 不可用的 SKU
  {
    id: "O20260630005",
    customerName: "林晓梅",
    customerPhone: "13900000007",
    skuCode: "CLEAN-LOCKSMITH",
    masterId: null,
    address: "广东省广州市天河区石牌街道石牌西路 1888 号",
    scheduledAt: "2026-06-30T17:00:00",
    amount: 199,
    status: "pending",
  },
  // ============ assigned × 4 ============
  {
    id: "O20260628001",
    customerName: "钱伟",
    customerPhone: "13900000011",
    skuCode: "CLEAN-DAILY-2H",
    masterId: "T001", // 李师傅 — worker1 看得到
    address: "广东省深圳市南山区粤海街道科技园 1 号",
    scheduledAt: "2026-06-28T10:00:00",
    amount: 158,
    status: "assigned",
    remark: "阿姨带吸尘器",
  },
  {
    id: "O20260628002",
    customerName: "孙丽",
    customerPhone: "13900000012",
    skuCode: "APPLIANCE-AC-WALL",
    masterId: "T004", // 孙师傅 — worker4 看得到
    address: "广东省广州市天河区石牌街道五山路 88 号",
    scheduledAt: "2026-06-28T14:00:00",
    amount: 128,
    status: "assigned",
  },
  {
    id: "O20260628003",
    customerName: "吴军",
    customerPhone: "13900000013",
    skuCode: "REPAIR-PIPE",
    masterId: "T002", // 赵师傅 — worker2 看得到
    address: "广东省深圳市福田区华强北街道深南中路 2000 号",
    scheduledAt: "2026-06-28T15:30:00",
    amount: 180,
    status: "assigned",
    internalRemark: "VIP 客户优先",
  },
  {
    id: "O20260628004",
    customerName: "郑佳",
    customerPhone: "13900000088", // customer2 的手机号
    skuCode: "REPAIR-APPLIANCE",
    masterId: "T003", // 周姐 — worker3 看得到
    address: "广东省深圳市福田区华强北街道燕南路 1027 号",
    scheduledAt: "2026-06-28T17:00:00",
    amount: 120,
    status: "assigned",
    remark: "冰箱不制冷",
  },
  // ============ in_service × 4 ============
  {
    id: "O20260629011",
    customerName: "钱伟",
    customerPhone: "13900000021",
    skuCode: "CLEAN-DEEP-3H",
    masterId: "T001",
    address: "广东省深圳市南山区粤海街道张江高科园区",
    scheduledAt: "2026-06-29T09:00:00",
    amount: 268,
    status: "in_service",
  },
  {
    id: "O20260629012",
    customerName: "周婷",
    customerPhone: "13900000022",
    skuCode: "APPLIANCE-AC-WALL",
    masterId: "T004",
    address: "广东省广州市天河区石牌街道长寿路 1000 号",
    scheduledAt: "2026-06-29T11:00:00",
    amount: 128,
    status: "in_service",
  },
  {
    id: "O20260629013",
    customerName: "冯磊",
    customerPhone: "13900000023",
    skuCode: "REPAIR-PIPE",
    masterId: "T002",
    address: "广东省深圳市福田区华强北街道控江路 1500 号",
    scheduledAt: "2026-06-29T13:30:00",
    amount: 180,
    status: "in_service",
  },
  {
    id: "O20260629014",
    customerName: "陈静",
    customerPhone: "13900000024",
    skuCode: "REPAIR-APPLIANCE",
    masterId: "T003",
    address: "广东省深圳市福田区华强北街道南京西路 1601 号",
    scheduledAt: "2026-06-29T15:00:00",
    amount: 120,
    status: "in_service",
  },
  // ============ completed × 3 ============
  // 带 serviceSummary（v0.7.6 业务扩展）
  {
    id: "O20260627001",
    customerName: "吴敏",
    customerPhone: "13900000031",
    skuCode: "CLEAN-DEEP-3H",
    masterId: "T001",
    address: "广东省深圳市南山区粤海街道漕溪北路 100 号",
    scheduledAt: "2026-06-27T10:00:00",
    amount: 268,
    status: "completed",
    serviceSummary: "厨房油烟机已深度清洗，卫生间瓷砖已除霉，客户验收满意",
  },
  {
    id: "O20260627002",
    customerName: "钱伟",
    customerPhone: "13900000032",
    skuCode: "APPLIANCE-AC-WALL",
    masterId: "T004",
    address: "广东省广州市天河区石牌街道陆家嘴金融区",
    scheduledAt: "2026-06-27T14:00:00",
    amount: 128,
    status: "completed",
    serviceSummary: "空调滤网清洗完毕，制冷效果恢复，已测试 30 分钟正常",
    internalRemark: "VIP 客户，2 个月后回访",
  },
  {
    id: "O20260626001",
    customerName: "周婷",
    customerPhone: "13900000033",
    skuCode: "REPAIR-APPLIANCE",
    masterId: "T003",
    address: "广东省深圳市福田区华强北街道天山路 888 号",
    scheduledAt: "2026-06-26T15:00:00",
    amount: 120,
    status: "completed",
    serviceSummary: "冰箱压缩机启动器更换，运行正常，已教客户使用",
  },
  // ============ cancelled × 1 ============
  // 带 cancelReason（v0.7.9 业务扩展 + v0.9.0 业务规则 #14 必填）
  {
    id: "O20260626002",
    customerName: "赵敏",
    customerPhone: "13900000041",
    skuCode: "CLEAN-DAILY-2H",
    masterId: null,
    address: "广东省深圳市南山区粤海街道鲁迅公园",
    scheduledAt: "2026-06-26T09:00:00",
    amount: 158,
    status: "cancelled",
    cancelReason: "客户临时有事取消",
    canceledAt: "2026-06-26T08:00:00",
  },
] as const;

async function main() {
  console.log("🌱 开始 seed:demo — 一键重置完整演示数据");

  // [v0.9.9] 生产保护（演示期项目必加）
  guardProduction();

  // ============================================================
  // 0. 清表（按依赖倒序）
  // ============================================================
  await clearAll();
  console.log(
    "  ✓ 清空旧数据（ActivityLog → Order → DispatchRule → User → Master → ServiceSku → ServiceCategory）",
  );

  // ============================================================
  // 1. ServiceCategory × 3
  // ============================================================
  const categoryRecords = await Promise.all(
    CATEGORIES.map((c) =>
      prisma.serviceCategory.create({
        data: { name: c.name, categoryCode: c.code, enabled: true },
      }),
    ),
  );
  const categoryIdByCode = new Map(
    categoryRecords.map((c) => [c.categoryCode, c.id]),
  );
  console.log(
    `  ✓ ServiceCategory × ${categoryRecords.length}（家政/家电清洗/维修）`,
  );

  // ============================================================
  // 2.5 PlatformArea × 4（[任务 1]）
  // ============================================================
  for (const a of PLATFORM_AREAS) {
    await prisma.platformArea.create({ data: a });
  }
  console.log(`  ✓ PlatformArea × ${PLATFORM_AREAS.length}`);

  // ============================================================
  // 2.6 Merchant × 3（[任务 1]）
  // ============================================================
  for (const m of MERCHANTS) {
    await prisma.merchant.create({ data: m });
  }
  console.log(`  ✓ Merchant × ${MERCHANTS.length}`);

  // ============================================================
  // 2.7 MerchantArea × 4（[任务 2] 多对多绑定）
  // ============================================================
  for (const ma of MERCHANT_AREAS) {
    await prisma.merchantArea.create({ data: ma });
  }
  console.log(`  ✓ MerchantArea × ${MERCHANT_AREAS.length}`);

  // ============================================================
  // 2. ServiceSku × 8
  // ============================================================
  const skuRecords = [];
  for (const s of SKUS) {
    const categoryId = categoryIdByCode.get(s.categoryCode);
    if (!categoryId) throw new Error(`找不到类目 ${s.categoryCode}`);
    const rec = await prisma.serviceSku.create({
      data: {
        skuCode: s.code,
        name: s.name,
        categoryId,
        basePrice: Math.round(s.basePrice * 100),
        durationMinutes: s.durationMinutes,
        requiredSkills: JSON.stringify(s.requiredSkills),
        enabled: s.enabled,
      },
    });
    skuRecords.push(rec);
  }
  const skuIdByCode = new Map(skuRecords.map((s) => [s.skuCode, s.id]));
  console.log(`  ✓ ServiceSku × ${skuRecords.length}`);

  // ============================================================
  // 3. Master × 4
  // ============================================================
  const masterRecords = [];
  for (const m of MASTERS) {
    const rec = await prisma.master.create({
      data: {
        id: m.id,
        name: m.name,
        phone: m.phone,
        skills: JSON.stringify(m.skills),
        rating: m.rating,
        completedJobs: m.completedJobs,
        status: "available", // demo seed 全部 available — 让 dashboard 推荐数对得上
        serviceArea: m.serviceArea,
        // [任务 2] 师傅必须归属商家 — FK merchantId
        merchant: { connect: { id: m.merchantId } },
      },
    });
    masterRecords.push(rec);
  }
  console.log(`  ✓ Master × ${masterRecords.length}（4 师傅全 available）`);

  // ============================================================
  // 4. User × 7（1 admin + 2 customer + 4 worker）
  // ============================================================
  for (const u of USERS) {
    await prisma.user.create({
      data: {
        name: u.name,
        phone: u.phone,
        password: await bcrypt.hash(u.password, BCRYPT_ROUNDS),
        role: u.role,
        workerId: u.workerId,
      },
    });
  }
  console.log(
    `  ✓ User × ${USERS.length}（admin × 1 / customer × 2 / worker × 4，密码已 bcrypt 哈希）`,
  );

  // ============================================================
  // 4.6. [任务 5] 分成策略 — 每个商家 1 条
  // ============================================================
  for (const m of MERCHANTS) {
    // M001 10/20/70, M002 5/15/80, M003 8/18/74（之和都 = 1）
    const rates: Record<string, [number, number, number]> = {
      M001: [0.1, 0.2, 0.7],
      M002: [0.05, 0.15, 0.8],
      M003: [0.08, 0.18, 0.74],
    };
    const [p, mc, w] = rates[m.id] ?? [0.1, 0.2, 0.7];
    await prisma.commissionStrategy.create({
      data: {
        merchantId: m.id,
        name: "默认策略",
        strategyType: "percentage",
        platformRate: p,
        merchantRate: mc,
        workerRate: w,
        enabled: true,
      },
    });
  }
  console.log(`  ✓ CommissionStrategy × ${MERCHANTS.length}`);

  // ============================================================
  // 5. Order × 20
  // ============================================================
  for (const o of ORDERS) {
    const skuId = skuIdByCode.get(o.skuCode);
    if (!skuId) throw new Error(`找不到 SKU ${o.skuCode}`);
    await prisma.order.create({
      data: {
        id: o.id,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        serviceSkuId: skuId,
        serviceName: SKUS.find((s) => s.code === o.skuCode)?.name ?? "",
        masterId: o.masterId ?? null,
        masterName: o.masterId
          ? (MASTERS.find((m) => m.id === o.masterId)?.name ?? null)
          : null,
        address: o.address,
        scheduledAt: new Date(o.scheduledAt),
        amount: Math.round(o.amount * 100),
        status: o.status,
        remark: "remark" in o ? o.remark : null,
        internalRemark: "internalRemark" in o ? o.internalRemark : null,
        serviceSummary: "serviceSummary" in o ? o.serviceSummary : null,
        cancelReason: "cancelReason" in o ? o.cancelReason : null,
        canceledAt: "canceledAt" in o ? new Date(o.canceledAt) : null,
      },
    });
  }
  console.log(
    `  ✓ Order × ${ORDERS.length}（pending × 8 / assigned × 4 / in_service × 4 / completed × 3 / cancelled × 1）`,
  );

  // ============================================================
  // 6. DispatchRule × 8
  // ============================================================
  // 设计：3 条 SKU 精确 + 3 条品类兜底 + 1 条禁用（演示 enabled 切换）+ 1 条「暂无推荐」
  const rules = [
    // SKU 精确匹配（高优先级）
    {
      name: "空调清洗（挂机）：要求空调维修",
      priority: 100,
      enabled: true,
      ruleJson: {
        match: { skuId: skuIdByCode.get("APPLIANCE-AC-WALL") },
        requiredSkills: ["空调维修"],
      },
    },
    {
      name: "空调清洗（柜机）：要求空调维修",
      priority: 100,
      enabled: true,
      ruleJson: {
        match: { skuId: skuIdByCode.get("APPLIANCE-AC-CABINET") },
        requiredSkills: ["空调维修"],
      },
    },
    {
      name: "家电维修：要求家电维修",
      priority: 100,
      enabled: true,
      ruleJson: {
        match: { skuId: skuIdByCode.get("REPAIR-APPLIANCE") },
        requiredSkills: ["家电维修"],
      },
    },
    // 品类兜底（低优先级）
    {
      name: "家政类目兜底：要求保洁",
      priority: 50,
      enabled: true,
      ruleJson: {
        match: { categoryId: categoryIdByCode.get("CLEAN") },
        requiredSkills: ["保洁"],
      },
    },
    {
      name: "家电清洗类目兜底：要求空调维修",
      priority: 50,
      enabled: true,
      ruleJson: {
        match: { categoryId: categoryIdByCode.get("APPLIANCE") },
        requiredSkills: ["空调维修"],
      },
    },
    {
      name: "维修类目兜底：要求水电维修",
      priority: 50,
      enabled: true,
      ruleJson: {
        match: { categoryId: categoryIdByCode.get("REPAIR") },
        requiredSkills: ["水电维修"],
      },
    },
    // 禁用规则（演示「启用/停用」按钮）
    {
      name: "旧版水管维修规则（已停用）",
      priority: 10,
      enabled: false,
      ruleJson: {
        match: { skuId: skuIdByCode.get("REPAIR-PIPE") },
        requiredSkills: ["水电维修"],
      },
    },
    // 「暂无推荐」演示规则：要求开锁（无师傅会）
    {
      name: "开锁换锁：要求开锁（暂无可派单师傅）",
      priority: 200,
      enabled: true,
      ruleJson: {
        match: { skuId: skuIdByCode.get("CLEAN-LOCKSMITH") },
        requiredSkills: ["开锁"],
      },
    },
  ];
  for (const r of rules) {
    await prisma.dispatchRule.create({
      data: {
        name: r.name,
        priority: r.priority,
        enabled: r.enabled,
        ruleJson: JSON.stringify(r.ruleJson),
      },
    });
  }
  console.log(
    `  ✓ DispatchRule × ${rules.length}（SKU 精确 × 3 + 品类兜底 × 3 + 禁用 × 1 + 暂无推荐 × 1）`,
  );

  // ============================================================
  // 7. ActivityLog × 若干（演示各 action）
  // ============================================================
  // 设计：覆盖 order_created / order_assigned / order_completed / order_canceled / master_created 等
  const logs = [
    {
      actorId: null,
      actorName: "system",
      actorRole: "system",
      action: "service_sku_created",
      targetType: "serviceSku",
      targetId: skuIdByCode.get("CLEAN-DAILY-2H") ?? "",
      message: "初始化服务 SKU：日常保洁 2 小时",
      metadata: { skuCode: "CLEAN-DAILY-2H" },
    },
    {
      actorId: null,
      actorName: "system",
      actorRole: "system",
      action: "master_created",
      targetType: "master",
      targetId: "T001",
      message: "初始化师傅：李师傅",
      metadata: { phone: "13900000010" },
    },
    {
      actorId: null,
      actorName: "system",
      actorRole: "system",
      action: "master_created",
      targetType: "master",
      targetId: "T002",
      message: "初始化师傅：赵师傅",
      metadata: { phone: "13900000020" },
    },
    {
      actorId: null,
      actorName: "system",
      actorRole: "system",
      action: "dispatch_rule_created",
      targetType: "dispatchRule",
      targetId: "rule-init-1",
      message: "初始化派单规则：空调清洗（挂机）",
      metadata: { priority: 100 },
    },
    // customer1 创建订单
    {
      actorId: null,
      actorName: "customer1",
      actorRole: "customer",
      action: "order_created",
      targetType: "order",
      targetId: "O20260630001",
      message: "客户 陈晓明 创建了订单 O20260630001",
      metadata: { skuCode: "CLEAN-DAILY-2H", customerPhone: "13900000099" },
    },
    {
      actorId: null,
      actorName: "admin",
      actorRole: "admin",
      action: "order_assigned",
      targetType: "order",
      targetId: "O20260628001",
      message: "管理员将订单 O20260628001 派给师傅 李师傅",
      metadata: { masterName: "李师傅" },
    },
    {
      actorId: null,
      actorName: "admin",
      actorRole: "admin",
      action: "order_assigned",
      targetType: "order",
      targetId: "O20260628002",
      message: "管理员将订单 O20260628002 派给师傅 孙师傅",
      metadata: { masterName: "孙师傅" },
    },
    // 师傅完成订单（带 serviceSummary）
    {
      actorId: null,
      actorName: "李师傅",
      actorRole: "worker",
      action: "order_service_summary_added",
      targetType: "order",
      targetId: "O20260627001",
      message: "师傅李师傅填写了订单 O20260627001 的服务完成说明",
      metadata: { serviceSummary: "厨房油烟机已深度清洗" },
    },
    {
      actorId: null,
      actorName: "admin",
      actorRole: "admin",
      action: "order_completed",
      targetType: "order",
      targetId: "O20260627001",
      message: "师傅 李师傅 完成订单 O20260627001",
      metadata: { fromStatus: "in_service", toStatus: "completed" },
    },
    // 取消订单（带 cancelReason）
    {
      actorId: null,
      actorName: "customer2",
      actorRole: "customer",
      action: "order_canceled",
      targetType: "order",
      targetId: "O20260626002",
      message: "订单 O20260626002 被取消：客户临时有事取消",
      metadata: { cancelReason: "客户临时有事取消" },
    },
  ];
  for (const l of logs) {
    await prisma.activityLog.create({
      data: {
        actorId: l.actorId,
        actorName: l.actorName,
        actorRole: l.actorRole,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        message: l.message,
        metadata: JSON.stringify(l.metadata),
      },
    });
  }
  console.log(
    `  ✓ ActivityLog × ${logs.length}（覆盖 created / assigned / completed / canceled 等）`,
  );

  // ============================================================
  // 8. 校验
  // ============================================================
  const counts = {
    categories: await prisma.serviceCategory.count(),
    skus: await prisma.serviceSku.count(),
    platformAreas: await prisma.platformArea.count(), // [任务 1]
    merchants: await prisma.merchant.count(), // [任务 1]
    merchantAreas: await prisma.merchantArea.count(), // [任务 2]
    masters: await prisma.master.count(),
    users: await prisma.user.count(),
    orders: await prisma.order.count(),
    rules: await prisma.dispatchRule.count(),
    commissionStrategies: await prisma.commissionStrategy.count(), // [任务 5]
    activityLogs: await prisma.activityLog.count(),
  };
  console.log("📊 当前数据：", counts);

  // 校验订单状态分布
  const orderStats = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log(
    "📊 订单状态分布：",
    Object.fromEntries(orderStats.map((s) => [s.status, s._count._all])),
  );

  if (
    counts.categories !== 3 ||
    counts.skus !== 8 ||
    // [任务 4] 4 师傅 + 1 个 T005 林师傅（invite_code 入驻）= 5
    counts.masters !== 5 ||
    counts.users !== 7 ||
    counts.orders !== 20 ||
    counts.rules !== 8 ||
    // [任务 5] 3 个分成策略（每个商家 1 条）
    counts.commissionStrategies !== 3
  ) {
    throw new Error(
      `seed:demo 后行数对不上（期望 categories=3 / skus=8 / masters=5 / users=7 / orders=20 / rules=8）`,
    );
  }

  console.log("");
  console.log("✅ seed:demo 完成");
  console.log("");
  console.log("🔑 演示账号：");
  console.log("   管理员：admin / admin123");
  console.log("   用户：customer1 / customer123（手机 13900000099）");
  console.log("         customer2 / customer123（手机 13900000088）");
  console.log("   师傅：worker1 / worker123 → 李师傅（T001）");
  console.log("         worker2 / worker123 → 赵师傅（T002）");
  console.log("         worker3 / worker123 → 周姐（T003）");
  console.log("         worker4 / worker123 → 孙师傅（T004）");
}

main()
  .catch((e) => {
    console.error("❌ seed:demo 失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
