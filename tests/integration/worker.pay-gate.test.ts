// [任务 X] 师傅端 payStatus 守门回归测试
//
// 业务规则：
// - listOrdersForMaster 过滤 status NOT IN pending（status: { in: [assigned, in_service, completed, cancelled] }）
// - getOrderForWorker 第 198 行 if (row.status === "pending") return null
// - 师傅端绝不返回「未支付」订单（派单守门已拒,语义上不会到师傅手里）
//
// 目的：防回归 — 改 query 时不要去掉 status 过滤

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { listOrdersForMaster, getOrderForWorker } from "@/src/lib/worker";

const PREFIX = "_test_worker_pay_";
const MASTER_ID = "T001"; // 已有师傅
const CUSTOMER_PHONE = "13900000091";

describe("师傅端 query 层 payStatus 守门", () => {
  let sku: { id: string; name: string };

  beforeAll(async () => {
    const s = await prisma.serviceSku.findUnique({
      where: { skuCode: "CLEAN-DAILY-2H" },
    });
    if (!s) throw new Error("缺 SKU CLEAN-DAILY-2H — 请先跑 npm run db:reset");
    sku = s;
  });

  beforeEach(async () => {
    await prisma.order.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
  });

  // # spec: listOrdersForMaster 不返回 pending 订单（无论 payStatus=unpaid 或 paid）
  it("listOrdersForMaster 过滤 pending 订单: payStatus=unpaid 不出现", async () => {
    // 构造一个 pending + unpaid 订单,虽然它不会真派给师傅
    await prisma.order.create({
      data: {
        id: `${PREFIX}unpaid`,
        customerName: "未支付",
        customerPhone: CUSTOMER_PHONE,
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

    const orders = await listOrdersForMaster(MASTER_ID);
    const hasUnpaid = orders.some((o) => o.id === `${PREFIX}unpaid`);
    expect(hasUnpaid).toBe(false);
  });

  // # spec: listOrdersForMaster 也不返回 pending + paid 订单（业务上 pending 还未派给任何师傅,不会在 master 列表）
  it("listOrdersForMaster 过滤 pending 订单: payStatus=paid 也不出现", async () => {
    await prisma.order.create({
      data: {
        id: `${PREFIX}paid`,
        customerName: "已支付",
        customerPhone: CUSTOMER_PHONE,
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

    const orders = await listOrdersForMaster(MASTER_ID);
    const hasPaid = orders.some((o) => o.id === `${PREFIX}paid`);
    expect(hasPaid).toBe(false);
  });

  // # spec: getOrderForWorker 详情页也守门: pending 订单直接返 null
  it("getOrderForWorker 详情页: pending 订单返 null", async () => {
    await prisma.order.create({
      data: {
        id: `${PREFIX}detail_pending`,
        customerName: "pending 详情",
        customerPhone: CUSTOMER_PHONE,
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

    const result = await getOrderForWorker(
      `${PREFIX}detail_pending`,
      MASTER_ID,
    );
    expect(result).toBeNull();
  });

  // # spec: getOrderForWorker 退款订单也守门: payStatus=refunded 返 null
  it("getOrderForWorker 详情页: refunded 订单返 null（防师傅看到已退款）", async () => {
    await prisma.order.create({
      data: {
        id: `${PREFIX}refunded`,
        customerName: "refunded 详情",
        customerPhone: CUSTOMER_PHONE,
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
        payStatus: "refunded",
      },
    });

    const result = await getOrderForWorker(`${PREFIX}refunded`, MASTER_ID);
    expect(result).toBeNull();
  });
});
