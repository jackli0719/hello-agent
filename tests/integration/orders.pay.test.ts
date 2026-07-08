// [任务 X] 支付下单闭环 — payOrder 业务函数集成测试
//
// 覆盖：
// 1. payOrder 成功路径：unpaid → paid, paidAt 设置, ActivityLog 写
// 2. payOrder 失败路径：
//    - 订单不存在
//    - status 非 pending（已 assigned / completed / cancelled）
//    - payStatus 已 paid（重复支付）
//    - payStatus 为 refunded
// 3. 业务规则：支付后订单仍 status=pending（不变 status，只改 payStatus）
//
// 设计：连真实 PG（vitest.config.ts 关了 fileParallelism），用 seed 数据
// 选 2 笔 unpaid 演示订单（O20260629002 / O20260630002）作为样本
// 1 笔 paid 订单（O20260629001）测「已支付再付被拒」

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { payOrder } from "@/src/lib/orders";

const UNPAID_SAMPLE_1 = "O20260629002"; // payStatus=unpaid, status=pending
const UNPAID_SAMPLE_2 = "O20260630002"; // payStatus=unpaid, status=pending (customer1)
const PAID_SAMPLE = "O20260629001"; // payStatus=paid, status=pending
const CANCELLED_SAMPLE = "O20260626002"; // payStatus=paid, status=cancelled

describe("payOrder — 模拟支付业务函数", () => {
  beforeAll(async () => {
    // 确认 seed 已跑（缺则报错）
    const sample = await prisma.order.findUnique({
      where: { id: UNPAID_SAMPLE_1 },
    });
    if (!sample) {
      throw new Error("需要先跑 npm run db:reset && npm run seed:demo");
    }
    if (sample.payStatus !== "unpaid") {
      throw new Error(
        `seed 数据异常: ${UNPAID_SAMPLE_1}.payStatus 应为 unpaid, 实际 ${sample.payStatus}`,
      );
    }
  });

  beforeEach(async () => {
    // 每次跑前重置测试样本（避免上次跑改过 payStatus）
    await prisma.order.update({
      where: { id: UNPAID_SAMPLE_1 },
      data: { payStatus: "unpaid", paidAt: null },
    });
    await prisma.order.update({
      where: { id: UNPAID_SAMPLE_2 },
      data: { payStatus: "unpaid", paidAt: null },
    });
  });

  afterAll(async () => {
    // 收口：还原测试样本
    await prisma.order.update({
      where: { id: UNPAID_SAMPLE_1 },
      data: { payStatus: "unpaid", paidAt: null },
    });
    await prisma.order.update({
      where: { id: UNPAID_SAMPLE_2 },
      data: { payStatus: "unpaid", paidAt: null },
    });
  });

  // # spec: 支付成功 — payStatus 改 paid, paidAt 设值, status 不变
  it("payOrder 成功：unpaid → paid + paidAt 设值 + status 仍 pending", async () => {
    const before = await prisma.order.findUnique({
      where: { id: UNPAID_SAMPLE_1 },
    });
    expect(before?.payStatus).toBe("unpaid");
    expect(before?.paidAt).toBeNull();

    const r = await payOrder(UNPAID_SAMPLE_1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe(UNPAID_SAMPLE_1);
    expect(r.paidAt).toBeInstanceOf(Date);

    const after = await prisma.order.findUnique({
      where: { id: UNPAID_SAMPLE_1 },
    });
    expect(after?.payStatus).toBe("paid");
    expect(after?.paidAt).not.toBeNull();
    // status 不变 — 支付不改 status
    expect(after?.status).toBe("pending");
  });

  // # spec: 支付成功 — 写 ActivityLog
  it("payOrder 成功：写 ActivityLog action=order_paid", async () => {
    await payOrder(UNPAID_SAMPLE_1);
    const log = await prisma.activityLog.findFirst({
      where: { action: "order_paid", targetId: UNPAID_SAMPLE_1 },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.targetType).toBe("order");
    expect(log?.actorRole).toBe("customer");
  });

  // # spec: 支付失败 — 订单不存在
  it("payOrder 失败：订单不存在 → ok=false category=validation", async () => {
    const r = await payOrder("O-NON-EXIST-9999");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });

  // # spec: 支付失败 — status 非 pending
  it("payOrder 失败：status=cancelled → 拒绝（订单已取消不能再付）", async () => {
    const r = await payOrder(CANCELLED_SAMPLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/cancelled|cancel|已取消/);
  });

  // # spec: 支付失败 — 重复支付被拒
  it("payOrder 失败：payStatus=paid → 拒绝（不能重复支付）", async () => {
    const r = await payOrder(PAID_SAMPLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/已支付|paid/);
  });

  // # spec: 支付失败 — refunded 状态被拒
  it("payOrder 失败：payStatus=refunded → 拒绝（已退款不能付）", async () => {
    // 临时构造一笔 refunded
    const temp = await prisma.order.create({
      data: {
        id: "O-TEST-PAY-REFUNDED",
        customerName: "退款测试",
        customerPhone: "13900000099",
        serviceName: "测试 SKU",
        address: "测试地址",
        scheduledAt: new Date("2026-07-01T10:00:00"),
        amount: 10000,
        status: "pending",
        payStatus: "refunded",
      },
    });
    try {
      const r = await payOrder(temp.id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      expect(r.error).toMatch(/refunded|退款/);
    } finally {
      await prisma.order.delete({ where: { id: temp.id } });
    }
  });

  // # spec: 业务不变量 — 支付后 masterId 仍 null（未派单）
  it("payOrder 成功：不改 masterId / masterName（只改 payStatus）", async () => {
    const before = await prisma.order.findUnique({
      where: { id: UNPAID_SAMPLE_2 },
    });
    expect(before?.masterId).toBeNull();

    await payOrder(UNPAID_SAMPLE_2);

    const after = await prisma.order.findUnique({
      where: { id: UNPAID_SAMPLE_2 },
    });
    expect(after?.masterId).toBeNull();
    expect(after?.masterName).toBeNull();
    expect(after?.payStatus).toBe("paid");
  });
});
