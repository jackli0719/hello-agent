// [任务 19] 售后退款 + cancel 联动 payStatus 测试
//
// 设计：
// - **测试自建订单**（CLAUDE.md P0-5 + 借鉴 orders.assign.test.ts 模式），
//   不依赖 seed-demo.ts 的具体订单 id — db:reset 跑的是 prisma/seed.ts 不创建订单
// - 文件内串行（vitest fileParallelism=false），但每个 describe 内部用 beforeEach/afterEach
//   保证测试之间状态干净
//
// 覆盖：
// 1. cancel 联动退款：paid + pending → cancel → payStatus=refunded（事务内一步）
// 2. cancel 联动退款：unpaid + pending → cancel → payStatus 保持 unpaid
// 3. cancel 联动退款：paid + in_service → cancel → payStatus=refunded + 释放师傅
// 4. refundOrder：completed + paid → payStatus=refunded（独立售后入口）
// 5. refundOrder：unpaid / refunding / refunded / pending 全部拒绝
// 6. refundOrder 乐观锁：第二次调用被拒
// 7. assignOrder 守门：refunding 订单拒绝派单
// 8. payOrder 守门：refunded 订单拒绝支付

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import {
  assignOrder,
  transitionOrder,
  refundOrder,
  payOrder,
} from "./orders";

// 三个测试订单 id（自建，不依赖 seed）
const TEST_PENDING_PAID = "_test_refund_pending_paid";
const TEST_PENDING_UNPAID = "_test_refund_pending_unpaid";
const TEST_IN_SERVICE = "_test_refund_in_service";
const TEST_COMPLETED_PAID = "_test_refund_completed_paid";
const TEST_FOR_REFUNDING = "_test_refund_refunding";

async function createPendingPaid() {
  await prisma.order.deleteMany({ where: { id: TEST_PENDING_PAID } });
  await prisma.order.create({
    data: {
      id: TEST_PENDING_PAID,
      customerName: "测试 pending paid",
      customerPhone: "13900000001",
      serviceName: "测试服务",
      address: "上海市浦东新区世纪大道 100 号",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      scheduledAt: new Date(),
      amount: 10000,
      status: "pending",
      payStatus: "paid",
    },
  });
}

async function createPendingUnpaid() {
  await prisma.order.deleteMany({ where: { id: TEST_PENDING_UNPAID } });
  await prisma.order.create({
    data: {
      id: TEST_PENDING_UNPAID,
      customerName: "测试 pending unpaid",
      customerPhone: "13900000002",
      serviceName: "测试服务",
      address: "上海市浦东新区世纪大道 101 号",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "101 号",
      scheduledAt: new Date(),
      amount: 10000,
      status: "pending",
      payStatus: "unpaid",
    },
  });
}

async function createInService() {
  await prisma.order.deleteMany({ where: { id: TEST_IN_SERVICE } });
  await prisma.order.create({
    data: {
      id: TEST_IN_SERVICE,
      customerName: "测试 in_service paid",
      customerPhone: "13900000003",
      serviceName: "测试服务",
      address: "上海市浦东新区世纪大道 102 号",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "102 号",
      scheduledAt: new Date(),
      amount: 10000,
      status: "in_service",
      payStatus: "paid",
      masterId: "T002",
      masterName: "李师傅",
    },
  });
}

async function createCompletedPaid() {
  await prisma.order.deleteMany({ where: { id: TEST_COMPLETED_PAID } });
  await prisma.order.create({
    data: {
      id: TEST_COMPLETED_PAID,
      customerName: "测试 completed paid",
      customerPhone: "13900000004",
      serviceName: "测试服务",
      address: "上海市浦东新区世纪大道 103 号",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "103 号",
      scheduledAt: new Date(),
      amount: 10000,
      status: "completed",
      payStatus: "paid",
      masterId: "T003",
      masterName: "赵师傅",
    },
  });
}

async function createPendingForRefunding() {
  await prisma.order.deleteMany({ where: { id: TEST_FOR_REFUNDING } });
  await prisma.order.create({
    data: {
      id: TEST_FOR_REFUNDING,
      customerName: "测试 refunding",
      customerPhone: "13900000005",
      serviceName: "测试服务",
      address: "上海市浦东新区世纪大道 104 号",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "104 号",
      scheduledAt: new Date(),
      amount: 10000,
      status: "pending",
      payStatus: "refunding",
    },
  });
}

async function cleanupAllTestOrders() {
  await prisma.order.deleteMany({
    where: {
      id: {
        in: [
          TEST_PENDING_PAID,
          TEST_PENDING_UNPAID,
          TEST_IN_SERVICE,
          TEST_COMPLETED_PAID,
          TEST_FOR_REFUNDING,
        ],
      },
    },
  });
}

async function resetMasterStatuses() {
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "available",
    T002: "available",
    T003: "available",
    T004: "available",
  };
  for (const [id, status] of Object.entries(map)) {
    await prisma.master.update({ where: { id }, data: { status } });
  }
}

// ============================================================
// cancel 联动 payStatus 退款（事务内）
// ============================================================

// # spec: cancel 联动退款事务 = paid + pending → cancel → payStatus=refunded
describe("[任务 19] cancel 联动 payStatus 退款", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await createPendingPaid();
    await createPendingUnpaid();
    await createInService();
  });

  afterEach(async () => {
    await cleanupAllTestOrders();
    await resetMasterStatuses();
  });

  // # spec: 取消 paid + pending 订单 → status=cancelled + payStatus=refunded
  it("paid + pending → cancel → status=cancelled + payStatus=refunded", async () => {
    const r = await transitionOrder(
      TEST_PENDING_PAID,
      "cancelled",
      undefined,
      "用户主动取消",
    );
    expect(r.ok).toBe(true);
    const after = await prisma.order.findUnique({
      where: { id: TEST_PENDING_PAID },
      select: { status: true, payStatus: true, cancelReason: true },
    });
    expect(after?.status).toBe("cancelled");
    expect(after?.payStatus).toBe("refunded");
    expect(after?.cancelReason).toBe("用户主动取消");
  });

  // # spec: 取消 unpaid + pending 订单 → status=cancelled + payStatus 保持 unpaid（无退款语义）
  it("unpaid + pending → cancel → status=cancelled + payStatus 保持 unpaid", async () => {
    const r = await transitionOrder(
      TEST_PENDING_UNPAID,
      "cancelled",
      undefined,
      "未支付取消",
    );
    expect(r.ok).toBe(true);
    const after = await prisma.order.findUnique({
      where: { id: TEST_PENDING_UNPAID },
      select: { status: true, payStatus: true },
    });
    expect(after?.status).toBe("cancelled");
    expect(after?.payStatus).toBe("unpaid");
  });

  // # spec: 取消 paid + in_service 订单 → status=cancelled + payStatus=refunded + 释放师傅
  it("paid + in_service → cancel → status=cancelled + payStatus=refunded + 师傅从 busy 释放回 available", async () => {
    await prisma.master.update({ where: { id: "T002" }, data: { status: "busy" } });
    const r = await transitionOrder(
      TEST_IN_SERVICE,
      "cancelled",
      undefined,
      "服务中客户取消",
    );
    expect(r.ok).toBe(true);
    const after = await prisma.order.findUnique({
      where: { id: TEST_IN_SERVICE },
      select: { status: true, payStatus: true },
    });
    expect(after?.status).toBe("cancelled");
    expect(after?.payStatus).toBe("refunded");
    const m = await prisma.master.findUnique({
      where: { id: "T002" },
      select: { status: true },
    });
    expect(m?.status).toBe("available");
  });
});

// ============================================================
// refundOrder 独立售后入口 — completed 订单专属
// ============================================================

// # spec: refundOrder 售后入口 — 仅 completed + payStatus=paid 可走
describe("[任务 19] refundOrder 独立售后入口", () => {
  beforeEach(async () => {
    await createCompletedPaid();
  });

  afterEach(async () => {
    await cleanupAllTestOrders();
  });

  // # spec: completed + paid → refundOrder → payStatus=refunded
  it("completed + paid → refundOrder 成功，payStatus=refunded", async () => {
    const r = await refundOrder(TEST_COMPLETED_PAID);
    expect(r.ok).toBe(true);
    const after = await prisma.order.findUnique({
      where: { id: TEST_COMPLETED_PAID },
      select: { payStatus: true, status: true },
    });
    expect(after?.payStatus).toBe("refunded");
    // status 保持 completed — 售后是财务操作，不改业务状态
    expect(after?.status).toBe("completed");
  });

  // # spec: pending 订单（无论 payStatus）→ refundOrder 拒绝
  it("pending 订单 → refundOrder 拒绝", async () => {
    await createPendingPaid();
    const r = await refundOrder(TEST_PENDING_PAID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/completed/);
  });

  // # spec: in_service 订单 → refundOrder 拒绝（必须先完成才能走售后）
  it("in_service 订单 → refundOrder 拒绝", async () => {
    await createInService();
    const r = await refundOrder(TEST_IN_SERVICE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/completed/);
  });

  // # spec: completed + unpaid → refundOrder 拒绝（无需退）
  it("completed + unpaid → refundOrder 拒绝「无需退款」", async () => {
    await prisma.order.update({
      where: { id: TEST_COMPLETED_PAID },
      data: { payStatus: "unpaid", paidAt: null },
    });
    const r = await refundOrder(TEST_COMPLETED_PAID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/未支付|无需/);
  });

  // # spec: completed + refunding → refundOrder 拒绝「处理中请勿重复」
  it("completed + refunding → refundOrder 拒绝「处理中」", async () => {
    await prisma.order.update({
      where: { id: TEST_COMPLETED_PAID },
      data: { payStatus: "refunding" },
    });
    const r = await refundOrder(TEST_COMPLETED_PAID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/处理中|请勿重复/);
  });

  // # spec: completed + refunded 第二次 refundOrder 拒绝「已退款」
  it("completed + refunded → refundOrder 拒绝「已退款」", async () => {
    await prisma.order.update({
      where: { id: TEST_COMPLETED_PAID },
      data: { payStatus: "refunded" },
    });
    const r = await refundOrder(TEST_COMPLETED_PAID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/已退款/);
  });

  // # spec: 乐观锁 — payStatus=paid 改成 refunded 后，第二次 refundOrder 被 updateMany 条件拒绝
  it("乐观锁：第二次 refundOrder 被拒（payStatus 已变）", async () => {
    const r1 = await refundOrder(TEST_COMPLETED_PAID);
    expect(r1.ok).toBe(true);
    const r2 = await refundOrder(TEST_COMPLETED_PAID);
    // 第二次进函数后头部校验就拒绝（payStatus === "refunded"） — 不进事务
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toMatch(/已退款/);
  });

  // # spec: 不存在的订单 → refundOrder 拒绝「订单不存在」
  it("不存在的订单 → refundOrder 拒绝", async () => {
    const r = await refundOrder("NOT-EXIST-ORDER");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });
});

// ============================================================
// 派单守门 — refunding 订单拒绝
// ============================================================

// # spec: 派单守门 — refunding 订单 assignOrder 拒绝（payStatus !== "paid" 已自动挡）
describe("[任务 19] assignOrder 拒绝 refunding 订单", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await createPendingForRefunding();
  });

  afterEach(async () => {
    await cleanupAllTestOrders();
    await resetMasterStatuses();
  });

  // # spec: refunding 订单 → assignOrder 拒绝「未支付」
  it("refunding 订单 → assignOrder 拒绝（payStatus 不是 paid）", async () => {
    const r = await assignOrder(TEST_FOR_REFUNDING, "T001");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/未支付|payStatus/);
  });
});

// ============================================================
// payOrder 守门 — refunded 订单拒绝
// ============================================================

// # spec: payOrder 守门 — refunded 订单不能再付（避免退款后又能付费）
describe("[任务 19] payOrder 拒绝 refunded 订单", () => {
  beforeEach(async () => {
    await createCompletedPaid();
  });

  afterEach(async () => {
    await cleanupAllTestOrders();
  });

  // # spec: refunded 订单 → payOrder 拒绝（payStatus !== "unpaid" 守门）
  it("refunded 订单 → payOrder 拒绝（payStatus 不是 unpaid）", async () => {
    await prisma.order.update({
      where: { id: TEST_COMPLETED_PAID },
      data: { status: "cancelled", payStatus: "refunded" },
    });
    const r = await payOrder(TEST_COMPLETED_PAID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});
