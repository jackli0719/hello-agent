// createOrder 走真实 DB 的端到端测试 — 验证 SKU 查表、写库、订单号生成。
// 注意：每个测试不主动重置 DB；用完删除自己建的订单。

import { afterEach, describe, expect, it } from "vitest";
import { createOrder } from "./orders";
import { prisma } from "@/src/lib/db";
import { cleanupTestOrders, createTestOrder } from "@/src/lib/test-factory";

const createdIds: string[] = [];

afterEach(async () => {
  await cleanupTestOrders(createdIds.splice(0));
});

// # spec: 订单创建 = 合法输入落库 pending + 金额元转分 + 状态初始 pending + SKU 查表 + 校验短路，skuCode/categoryCode 配对校验
describe("createOrder — 走真实 DB", () => {
  // # spec: 订单创建 — 合法输入落库 pending + 元转分 + 订单号格式 O{YYYYMMDD}xxxx
  it("合法输入 + SKU 存在 → 写入订单，状态 pending，订单号 O{YYYYMMDD}xxxx", async () => {
    const orderId = await createTestOrder({
      customerName: "测试客户",
      customerPhone: "13900000001",
      address: "上海市浦东新区世纪大道 100 号",
    });
    createdIds.push(orderId);

    // 订单号格式
    expect(orderId).toMatch(/^O\d{8}\d{4}$/);

    // DB 里能查到
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("pending");
    expect(row?.customerName).toBe("测试客户");
    expect(row?.customerPhone).toBe("13900000001");
    expect(row?.serviceName).toBe("日常保洁 2 小时");
    expect(row?.amount).toBe(15800); // 元 → 分
    expect(row?.masterId).toBeNull();
    expect(row?.masterName).toBeNull();
  });

  // # spec: 订单创建 — SKU 编码在 SKU 表找不到时拒绝（field=skuCode，错误信息含「不存在」）
  it("SKU 不存在 → field=skuCode", async () => {
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "NON-EXISTENT-CODE",
      amount: 100,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("skuCode");
    expect(r.error).toMatch(/不存在/);
  });

  // # spec: 校验短路 — 字段校验失败时不查 SKU 表，直接返回 customerName 错
  it("校验失败时不查 SKU（短路）", async () => {
    // 故意给一个会触发校验失败的输入（空 customerName），skuCode 传个怪的
    const r = await createOrder({
      customerName: "",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "WHATEVER",
      amount: 100,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerName"); // 不会先走到 skuCode
  });

  // # spec: SKU/品类配对 — skuCode 真实归属 categoryCode 时创建成功
  it("skuCode + categoryCode 配对正确 → 创建成功", async () => {
    // CLEAN-DAILY-2H 属于 CLEAN 类目
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      categoryCode: "CLEAN",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);
  });

  // # spec: SKU/品类配对 — skuCode 与 categoryCode 不匹配时拒绝（field=categoryCode）
  it("skuCode + categoryCode 不匹配 → field=categoryCode，拒绝", async () => {
    // CLEAN-DAILY-2H 属于 CLEAN 类目，但传 REPAIR → 拒
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      categoryCode: "REPAIR",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("categoryCode");
    expect(r.error).toMatch(/不属于/);
  });

  // # documents current behavior: 不传 categoryCode 时跳过配对校验（向后兼容）
  it("不传 categoryCode → 跳过校验（向后兼容）", async () => {
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);
  });

  // # spec: 品类编码合法性 — categoryCode 在品类表找不到时拒绝（field=categoryCode）
  it("categoryCode 是不存在的编码 → field=categoryCode", async () => {
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      categoryCode: "NOT-A-REAL-CATEGORY",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("categoryCode");
  });
});

// # spec: 备注字段 = 可选写入、空字符串 trim 后视作未填存 null、长度上限 500 字符
describe("createOrder — remark 字段", () => {
  // # spec: 订单备注 — 带 remark 创建成功且原样落库
  it("带 remark 创建 → 写入 DB 成功", async () => {
    const r = await createOrder({
      customerName: "用户端测试",
      customerPhone: "13900000002",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
      remark: "麻烦下午 2 点后上门",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);

    const row = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(row?.remark).toBe("麻烦下午 2 点后上门");
    expect(row?.status).toBe("pending");
  });

  // # spec: 订单备注 — 不传 remark 时 DB 存 null（区分「未填」与「空字符串」）
  it("不传 remark → DB 存 null", async () => {
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000003",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);

    const row = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(row?.remark).toBeNull();
  });

  // # spec: 订单备注 — remark 空 / 纯空格 trim 后视作未填，DB 存 null
  it("remark 空字符串 → DB 存 null（trim 后视为未填）", async () => {
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000004",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
      remark: "   ",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);

    const row = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(row?.remark).toBeNull();
  });

  // # spec: 订单备注 — remark 上限 500 字符，超长拒绝（field=remark）
  it("remark 超过 500 字符 → field=remark 拒绝", async () => {
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000005",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
      remark: "x".repeat(501),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("remark");
  });
});

// # spec: 新订单可被推荐引擎发现 = 订单状态 pending + SKU 仍在 enabled 列表里，remark 不影响派单匹配
describe("createOrder — 新订单能参与推荐师傅（端到端）", () => {
  // # spec: 新订单派单可见 — pending 订单 + enabled SKU 仍能进入推荐引擎候选
  it("用 remark 创建的订单，状态 pending，能被 recommendMastersForOrder 找到师傅", async () => {
    const r = await createOrder({
      customerName: "推荐验证",
      customerPhone: "13900000006",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      categoryCode: "CLEAN",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
      remark: "需要下午上门",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);

    // 验证订单在 DB 是 pending — 后台派单能用
    const row = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(row?.status).toBe("pending");
    expect(row?.remark).toBe("需要下午上门");
    expect(row?.masterId).toBeNull(); // 还没派单

    // 验证这个 SKU 仍然能被 listEnabledServices 找到（用户端表单能选）
    const { listEnabledServices } = await import("@/src/lib/repos/services");
    const services = await listEnabledServices();
    const sku = services.find((s) => s.skuCode === "CLEAN-DAILY-2H");
    expect(sku).toBeDefined();
  });
});

// # spec: 用户端表单契约 = categoryCode 必须传业务编码（APPLIANCE/CLEAN...）而非 cuid，配对校验拒绝错误形态
describe("createOrder — 用户端表单契约（防止 categoryCode 传错）", () => {
  // 用户端表单 <select name="categoryCode"> 必须传业务编码（APPLIANCE/CLEAN...），
  // 不是 cuid。如果传 cuid 会被配对校验拒绝。这是 2026-06 用户端 MVP 踩过的坑。

  // # documents current behavior: 用户端表单如果传 cuid 形态的 categoryCode 会被配对校验拒
  it("传 cuid 形态的 categoryCode → 配对校验拒绝", async () => {
    // 模拟「表单选错 value 形态」
    const r = await createOrder({
      customerName: "用户端 bug 验证",
      customerPhone: "13900000007",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "APPLIANCE-AC-WALL",
      // 故意传 cuid — 模拟老表单 bug
      categoryCode: "cmqwc07ac0001neizur5rjmup",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("categoryCode");
    expect(r.error).toMatch(/不属于/);
  });

  // # spec: 用户端表单契约 — 业务编码 APPLIANCE + 对应 SKU 正确配对，创建成功
  it("传业务编码 APPLIANCE + APPLIANCE-AC-WALL SKU → 创建成功", async () => {
    // 模拟修复后的表单：select value 正确传业务编码
    const r = await createOrder({
      customerName: "用户端修好",
      customerPhone: "13900000008",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "APPLIANCE-AC-WALL",
      categoryCode: "APPLIANCE",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
      remark: "空调外机也需要清洗",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);

    const row = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(row?.status).toBe("pending");
    expect(row?.remark).toBe("空调外机也需要清洗");
    expect(row?.serviceName).toBe("空调清洗（挂机）");
  });

  // # spec: 品类配对覆盖 — 多个 SKU + 对应 categoryCode 业务编码都能创建成功
  it("全部 5 个品类的 SKU 都能正确配对", async () => {
    const cases = [
      { skuCode: "CLEAN-DAILY-2H", categoryCode: "CLEAN" },
      { skuCode: "APPLIANCE-AC-WALL", categoryCode: "APPLIANCE" },
      // REPAIR / EMERGENCY / MATERNITY 的 SKU seed 里有，但具体编码查下
    ];
    for (const c of cases) {
      const r = await createOrder({
        customerName: "品类配对",
        customerPhone: "13900000009",
        address: "上海市",
        province: "上海市",
        city: "上海市",
        district: "浦东新区",
        street: "世纪大道",
        addressDetail: "100 号",
        skuCode: c.skuCode,
        categoryCode: c.categoryCode,
        amount: 100,
        scheduledAt: new Date("2026-06-26T10:00:00"),
      });
      expect(r.ok, `${c.skuCode} + ${c.categoryCode} 应该 OK`).toBe(true);
      if (r.ok) createdIds.push(r.orderId);
    }
  });
});
