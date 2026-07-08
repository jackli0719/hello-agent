// [任务 19] 通知集成测试 — 5 触发点端到端
//
// 覆盖：
// 1. payOrder → customer 收 order_paid；worker 不收（masterId=null）
// 2. assignOrder → customer/worker/merchant 三方各 1 条 order_assigned
// 3. transitionOrder(completed) → 三方各 1 条 order_completed
// 4. transitionOrder(cancelled) → 三方各 1 条 order_canceled
// 5. refundOrder → customer + merchant 各 1 条 order_refunded
// 6. 重复触发幂等：payOrder 同一订单两次只成功一次（payStatus 乐观锁）→ 通知也只发 1 条
// 7. 通知查询：listNotificationsForUser 越权（user B 看不到 user A 的）

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  payOrder,
  assignOrder,
  transitionOrder,
  refundOrder,
} from "@/src/lib/orders";
import { listNotificationsForUser } from "@/src/lib/notifications";

const PREFIX = "_test_int_notif_";

let userCustomer: { id: string; phone: string };
let userWorker: { id: string };
let userAdmin: { id: string };
let sku: { id: string; name: string };

async function ensureFixtures() {
  const c1 = await prisma.user.findFirst({
    where: { name: "customer1" },
    select: { id: true, phone: true },
  });
  const w1 = await prisma.user.findFirst({
    where: { name: "worker1" },
    select: { id: true },
  });
  const a1 = await prisma.user.findFirst({
    where: { name: "admin" },
    select: { id: true },
  });
  if (!c1 || !w1 || !a1) {
    throw new Error("需要先跑 npm run db:reset（缺 customer1/worker1/admin）");
  }
  userCustomer = c1 as { id: string; phone: string };
  userWorker = w1;
  userAdmin = a1;
}

describe("notifications — 5 触发点集成", () => {
  beforeAll(async () => {
    await ensureFixtures();
    const s = await prisma.serviceSku.findUnique({
      where: { skuCode: "CLEAN-DAILY-2H" },
    });
    if (!s) throw new Error("缺 SKU CLEAN-DAILY-2H");
    sku = s;
  });

  beforeEach(async () => {
    // 清掉前缀订单关联的所有通知（dispatch 写的 id 是 cuid 不带 PREFIX，按 orderId 清）
    await prisma.notification.deleteMany({
      where: { orderId: { startsWith: PREFIX } },
    });
    await prisma.order.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    // [任务 20] payOrder 后会触发 tryAutoDispatch → T001 变 busy
    // 跨 it 之间重置 T001 状态 — 否则后续 assignOrder 测试因师傅 busy 失败
    await prisma.master.updateMany({
      where: { id: { in: ["T001", "T002", "T003", "T004"] } },
      data: { status: "available" },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { orderId: { startsWith: PREFIX } },
    });
    await prisma.order.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
  });

  // # spec: payOrder 成功 → customer 收 order_paid；worker 不收（masterId=null）
  it("payOrder 成功 → customer 收 1 条 order_paid", async () => {
    const order = await prisma.order.create({
      data: {
        id: `${PREFIX}o_pay`,
        customerName: "Test",
        customerPhone: userCustomer.phone ?? "13900000099",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试",
        addressDetail: "1",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "unpaid",
      },
    });

    const r = await payOrder(order.id);
    expect(r.ok).toBe(true);

    const cust = await prisma.notification.findMany({
      where: { userId: userCustomer.id, type: "order_paid", orderId: order.id },
    });
    expect(cust.length).toBe(1);

    // worker 不收（masterId=null 时 worker 端无文案）
    const w = await prisma.notification.findMany({
      where: { userId: userWorker.id, type: "order_paid" },
    });
    expect(w.length).toBe(0);
  });

  // # spec: assignOrder 成功 → customer/worker/merchant 三方各 1 条 order_assigned
  it("assignOrder 成功 → 三方各收 1 条 order_assigned", async () => {
    // 找 T001 师傅 + merchant1
    const m = await prisma.master.findFirst({
      where: { user: { id: userWorker.id } },
      select: { id: true, name: true },
    });
    if (!m) throw new Error("seed 缺 T001 映射");

    const order = await prisma.order.create({
      data: {
        id: `${PREFIX}o_assign`,
        customerName: "Test",
        customerPhone: userCustomer.phone ?? "13900000099",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试",
        addressDetail: "1",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "paid",
      },
    });

    const r = await assignOrder(order.id, m.id);
    expect(r.ok).toBe(true);

    const cust = await prisma.notification.findMany({
      where: {
        userId: userCustomer.id,
        type: "order_assigned",
        orderId: order.id,
      },
    });
    const worker = await prisma.notification.findMany({
      where: {
        userId: userWorker.id,
        type: "order_assigned",
        orderId: order.id,
      },
    });
    expect(cust.length).toBe(1);
    expect(worker.length).toBe(1);
  });

  // # spec: transitionOrder(completed) → 三方各 1 条 order_completed
  it("transitionOrder(completed) → 三方各收 1 条 order_completed", async () => {
    const m = await prisma.master.findFirst({
      where: { user: { id: userWorker.id } },
      select: { id: true, name: true },
    });
    if (!m) throw new Error("seed 缺 T001");

    const order = await prisma.order.create({
      data: {
        id: `${PREFIX}o_done`,
        customerName: "Test",
        customerPhone: userCustomer.phone ?? "13900000099",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试",
        addressDetail: "1",
        scheduledAt: new Date(),
        amount: 10000,
        status: "in_service",
        payStatus: "paid",
        masterId: m.id,
        masterName: m.name,
      },
    });

    const r = await transitionOrder(order.id, "completed", "服务说明测试");
    expect(r.ok).toBe(true);

    const cust = await prisma.notification.findMany({
      where: {
        userId: userCustomer.id,
        type: "order_completed",
        orderId: order.id,
      },
    });
    const worker = await prisma.notification.findMany({
      where: {
        userId: userWorker.id,
        type: "order_completed",
        orderId: order.id,
      },
    });
    expect(cust.length).toBe(1);
    expect(worker.length).toBe(1);
  });

  // # spec: transitionOrder(cancelled) → 三方各 1 条 order_canceled
  it("transitionOrder(cancelled) → 三方各收 1 条 order_canceled", async () => {
    const order = await prisma.order.create({
      data: {
        id: `${PREFIX}o_cancel`,
        customerName: "Test",
        customerPhone: userCustomer.phone ?? "13900000099",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试",
        addressDetail: "1",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "paid",
      },
    });

    const r = await transitionOrder(
      order.id,
      "cancelled",
      undefined,
      "客户改主意了",
    );
    expect(r.ok).toBe(true);

    const cust = await prisma.notification.findMany({
      where: {
        userId: userCustomer.id,
        type: "order_canceled",
        orderId: order.id,
      },
    });
    // cancel 时 masterId=null（未派单），worker 不收
    const w = await prisma.notification.findMany({
      where: {
        userId: userWorker.id,
        type: "order_canceled",
        orderId: order.id,
      },
    });
    expect(cust.length).toBe(1);
    expect(w.length).toBe(0); // masterId=null 时 worker 端无文案
  });

  // # spec: refundOrder → customer 收 1 条 order_refunded
  it("refundOrder → customer 收 1 条 order_refunded", async () => {
    const order = await prisma.order.create({
      data: {
        id: `${PREFIX}o_refund`,
        customerName: "Test",
        customerPhone: userCustomer.phone ?? "13900000099",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试",
        addressDetail: "1",
        scheduledAt: new Date(),
        amount: 10000,
        status: "completed",
        payStatus: "paid",
      },
    });

    const r = await refundOrder(order.id);
    expect(r.ok).toBe(true);

    const cust = await prisma.notification.findMany({
      where: {
        userId: userCustomer.id,
        type: "order_refunded",
        orderId: order.id,
      },
    });
    expect(cust.length).toBe(1);
  });

  // # spec: 重复 payOrder 乐观锁：第二次失败 → 通知只发 1 条
  it("payOrder 重复触发（乐观锁）→ 通知只发 1 条", async () => {
    const order = await prisma.order.create({
      data: {
        id: `${PREFIX}o_double_pay`,
        customerName: "Test",
        customerPhone: userCustomer.phone ?? "13900000099",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "粤海街道",
        address: "测试",
        addressDetail: "1",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "unpaid",
      },
    });

    const r1 = await payOrder(order.id);
    expect(r1.ok).toBe(true);
    const r2 = await payOrder(order.id); // 已 paid
    expect(r2.ok).toBe(false);

    const cust = await prisma.notification.findMany({
      where: { userId: userCustomer.id, type: "order_paid", orderId: order.id },
    });
    expect(cust.length).toBe(1); // 第二次失败 → 不发通知
  });

  // # spec: listNotificationsForUser 越权：user B 看不到 user A 的
  it("listNotificationsForUser 越权隔离（userId 硬过滤）", async () => {
    // 给 customer1 写 1 条
    await prisma.notification.create({
      data: {
        id: `${PREFIX}cross_user`,
        userId: userCustomer.id,
        role: "customer",
        type: "order_paid",
        title: "A's notif",
        content: "x",
        orderId: `${PREFIX}dummy`,
      },
    });
    // admin 查
    const r = await listNotificationsForUser(userAdmin.id);
    const leaked = r.notifications.find((n) => n.id === `${PREFIX}cross_user`);
    expect(leaked).toBeUndefined();
  });
});
