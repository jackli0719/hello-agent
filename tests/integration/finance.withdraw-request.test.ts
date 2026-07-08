// [任务 16] 财务链路 integration test — T13 withdraw-request 端到端
//
// 起源：scripts/verify-withdraw-request.ts（任务 13 端到端验证脚本）
// 迁移原因（P1-#5）：verify 脚本不在 npm run test 链路，CI 不会触发；财务核心链路应进 Vitest。
//
// 与 src/lib/withdraw-request.test.ts 的分工：
// - 单测：覆盖每条规则（场景 1-7 已分散在 withdraw-request.test.ts 各 describe 块）
// - 本 integration：覆盖 **复合断言**（场景 8 approved/rejected 复合）+ **跨模块查询**（场景 9）
//
// 设计：
// - 跑前自建独立 merchant + archived settlement（cleanupFor 兜底）
// - 跑后强制删 merchant（cascade 删 settlement + withdraw）
// - 共享 dev DB（vitest.config.ts fileParallelism: false）
//
// 覆盖：
// 1. 场景 8 复合：approved 计入 totalPending，rejected 不计，available 计算正确
// 2. 场景 9：listWithdrawRequests 跨 merchant 隔离
//
// # spec: 复合断言 — totalPending = approved 之和（不含 rejected）
// # spec: 列表查询 — listWithdrawRequests 按 merchantId 过滤
// # spec: 测试数据隔离 — 自建 merchant + cleanup 不污染 seed 数据

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  approveWithdrawRequest,
  createWithdrawRequest,
  getMerchantAvailable,
  listWithdrawRequests,
  rejectWithdrawRequest,
} from "@/src/lib/withdraw-request";

describe("T13 withdraw-request — integration smoke", () => {
  let testMerchantId: string;

  beforeAll(async () => {
    // 独立 merchant（不入 seed 主数据）
    const now = Date.now().toString().slice(-9);
    const merchant = await prisma.merchant.create({
      data: {
        name: "integration withdraw test",
        contactName: "测试",
        phone: `139000${now}`,
        inviteCode: `W${now}`.slice(0, 8),
        province: "广东",
        city: "深圳",
        district: "南山",
        street: "测试街",
        addressDetail: "1号",
        status: "active",
      },
    });
    testMerchantId = merchant.id;

    // archived settlement (merchantIncome=10000 分) 作为可提现余额来源
    await prisma.merchantSettlement.create({
      data: {
        merchantId: merchant.id,
        period: `2099-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(5, "0")}`,
        totalOrderCount: 1,
        totalAmount: 30000,
        platformFee: 20000,
        merchantIncome: 10000,
        workerIncome: 0,
        status: "archived",
      },
    });
  });

  afterAll(async () => {
    // 先删 merchant（cascade 删 settlement + withdraw）
    if (testMerchantId) {
      await prisma.merchant.deleteMany({ where: { id: testMerchantId } });
    }
  });

  // # spec: 复合断言 — approved 计入 pending, rejected 不计, available 正确
  it("场景 8: approved(1000) 计入 totalPending, rejected(2000) 不计, available=9000", async () => {
    // 步骤 1: a1 approved (1000)
    const c1 = await createWithdrawRequest({
      merchantId: testMerchantId,
      amount: 1000,
    });
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;
    const a1 = await approveWithdrawRequest({
      id: c1.id,
      reviewerName: "admin",
    });
    expect(a1.ok).toBe(true);

    // 步骤 2: a2 rejected (2000) — a1 已 approved，pending unique 释放
    const c2 = await createWithdrawRequest({
      merchantId: testMerchantId,
      amount: 2000,
    });
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;
    const a2 = await rejectWithdrawRequest({
      id: c2.id,
      reviewerName: "admin",
      rejectReason: "integration test",
    });
    expect(a2.ok).toBe(true);

    // 复合断言：totalPending = a1 approved 1000；a2 rejected 2000 不计入
    const av = await getMerchantAvailable(testMerchantId);
    expect(av.totalPending).toBe(1000); // a1 approved
    expect(av.available).toBe(10000 - 1000 - 0); // income - pending - paid = 9000
    expect(av.totalIncome).toBe(10000);
    expect(av.totalPaid).toBe(0);
  });

  // # spec: 列表查询 — listWithdrawRequests 按 merchantId 过滤
  it("场景 9: listWithdrawRequests 按 merchantId 过滤, 只返回该 merchant 的 withdraw", async () => {
    const list = await listWithdrawRequests({ merchantId: testMerchantId });
    // 场景 8 创建了 a1 + a2，2 条
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((w) => w.merchantId === testMerchantId)).toBe(true);
    // 应该包含 1 approved + 1 rejected
    const statuses = list.map((w) => w.status);
    expect(statuses).toContain("approved");
    expect(statuses).toContain("rejected");
  });
});
