// [任务 X] 支付下单闭环 — 端到端集成测试（验收点 1 + 2）
//
// 验收点：
// 1. 未支付订单不派单（assignOrder 在 payStatus=unpaid 时返回 validation 错误）
// 2. 支付后可派单（payStatus=paid → assignOrder 成功）
//
// 设计：
// - 复用真实 PG（vitest 关 fileParallelism）
// - 复用真实 assignOrder 业务函数（不走 server action,绕开 redirect 异常）
// - 用 prisma.order 直接构造测试订单（不依赖 seed 状态）
// - 收口清理：删除所有 _test_pay_gate_ 订单

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { assignOrder, payOrder } from "@/src/lib/orders";

const PREFIX = "_test_pay_gate_";

describe("支付下单闭环 — 端到端验收", () => {
  let availableMasterId: string;
  let sku: { id: string; name: string; category: { categoryCode: string } };

  beforeAll(async () => {
    // 找一笔已存在的 master T001 + 一笔已存在的 SKU 作为测试载体
    const [m, s] = await Promise.all([
      prisma.master.findUnique({ where: { id: "T001" } }),
      prisma.serviceSku.findUnique({
        where: { skuCode: "CLEAN-DAILY-2H" },
        include: { category: true },
      }),
    ]);
    if (!m) throw new Error("缺 master T001 — 请先跑 npm run db:reset");
    if (!s) throw new Error("缺 SKU CLEAN-DAILY-2H");
    availableMasterId = m.id;
    sku = s;
  });

  beforeEach(async () => {
    // 清理测试数据（每次跑前重置）
    await prisma.order.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    // 复位 T001-T004 到 seed 初值（[任务 4-0] 之前只复位 T001，但 auto-dispatch 选 rating 最高的
    //     available 师傅，T003(5.0) > T001(4.9)。如果前面 test 把 T002/T003 改 available
    //     又没回退，auto-dispatch 会选 T003 而不是 T001 → 测试期望失败）
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "available" },
    });
    await prisma.master.update({
      where: { id: "T002" },
      data: { status: "busy" },
    });
    await prisma.master.update({
      where: { id: "T003" },
      data: { status: "busy" },
    });
    await prisma.master.update({
      where: { id: "T004" },
      data: { status: "available" },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.master.update({
      where: { id: availableMasterId },
      data: { status: "available" },
    });
  });

  // ============================================================
  // 验收点 1: 未支付订单不派单
  // ============================================================

  // # spec: 未支付订单 assignOrder 失败 — payStatus=unpaid 时返回 validation 错误
  it("验收点 1: payStatus=unpaid 订单 assignOrder → validation 错误", async () => {
    const orderId = `${PREFIX}001_unpaid`;
    await prisma.order.create({
      data: {
        id: orderId,
        customerName: "未支付测试",
        customerPhone: "13900000091",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试地址",
        addressDetail: "1 号",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "unpaid", // 未支付
      },
    });

    const r = await assignOrder(orderId, availableMasterId);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("期望 assignOrder 失败,实际成功");
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/未支付|payStatus/);
  });

  // # spec: 未支付订单 DB masterId 仍 null（assignOrder 失败时不动 master）
  it("验收点 1 副作用: assignOrder 失败 → order.masterId 仍 null, master.status 仍 available", async () => {
    const orderId = `${PREFIX}002_unpaid_sideeffect`;
    await prisma.order.create({
      data: {
        id: orderId,
        customerName: "未支付副作用测试",
        customerPhone: "13900000092",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试地址",
        addressDetail: "1 号",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "unpaid",
      },
    });

    await assignOrder(orderId, availableMasterId);

    const [after, master] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId } }),
      prisma.master.findUnique({ where: { id: availableMasterId } }),
    ]);
    expect(after?.masterId).toBeNull();
    expect(after?.status).toBe("pending");
    expect(master?.status).toBe("available");
  });

  // ============================================================
  // 验收点 2: 支付后可派单
  // ============================================================

  // [任务 20] 更新：支付成功后会自动派单（tryAutoDispatch），
  // 派单条件 = 订单必须未派单（status=pending）→ assignOrder 会失败
  // 验证：支付后 status 已 assigned（自动派单成功）
  // # spec: 完整闭环 — payStatus=unpaid → payOrder → payStatus=paid → assignOrder 成功
  it("验收点 2: 完整闭环 unpaid → payOrder → paid → 自动派单成功", async () => {
    const orderId = `${PREFIX}003_full_flow`;
    await prisma.order.create({
      data: {
        id: orderId,
        customerName: "完整闭环测试",
        customerPhone: "13900000093",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试地址",
        addressDetail: "1 号",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "unpaid",
      },
    });

    // Step 1: 支付
    const payRes = await payOrder(orderId);
    expect(payRes.ok).toBe(true);
    if (!payRes.ok) return;

    // Step 2: 验证 payStatus=paid
    const paid = await prisma.order.findUnique({ where: { id: orderId } });
    expect(paid?.payStatus).toBe("paid");
    expect(paid?.paidAt).not.toBeNull();
    // [任务 20] 支付后自动派单 — 状态可能已是 assigned（自动派单成功）
    // 也可能仍是 pending（无规则 / 无师傅 / 区域无商家 — 自动派单失败）
    // 演示期：seed 中有 dispatch rule + master + area，期望自动派单成功
    expect(["pending", "assigned"]).toContain(paid?.status);

    // Step 3: 如果订单仍 pending → 手动派单；否则已是 assigned（自动成功）跳过
    if (paid?.status === "pending") {
      const assignRes = await assignOrder(orderId, availableMasterId);
      expect(assignRes.ok).toBe(true);
      if (!assignRes.ok) {
        throw new Error(`派单失败: ${assignRes.error}`);
      }
    }

    // Step 4: 验证 order=assigned, master=busy
    const final = await prisma.order.findUnique({ where: { id: orderId } });
    const master = await prisma.master.findUnique({
      where: { id: availableMasterId },
    });
    expect(final?.status).toBe("assigned");
    expect(final?.masterId).toBe(availableMasterId);
    expect(master?.status).toBe("busy");
  });

  // ============================================================
  // 反向验证: payStatus=refunded 也不能派单
  // ============================================================

  // # spec: refunded 状态也守门 — 不能派单（虽然本次不做退款 UI）
  it("refunded 订单 assignOrder 失败（预留字段守门）", async () => {
    const orderId = `${PREFIX}004_refunded`;
    await prisma.order.create({
      data: {
        id: orderId,
        customerName: "refunded 测试",
        customerPhone: "13900000094",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试地址",
        addressDetail: "1 号",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "refunded",
      },
    });

    const r = await assignOrder(orderId, availableMasterId);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("refunded 订单不应能派单");
    expect(r.category).toBe("validation");
  });
});
