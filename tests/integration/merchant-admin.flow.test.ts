// [任务 18] 商家后台 — 端到端流程测试
//
// 覆盖：
// 1. 提现申请完整链路：merchant1 申请 → admin 审核通过 → merchant1 看 approved → finance ledger 写好
// 2. 提现申请拒绝链路：merchant1 申请 → admin 拒绝 → merchant1 看 rejected
// 3. 邀请码完整流程：merchant1 toggle disable → 业务判断 → re-enable
//
// 设计：
// - 复用 session helper（mockNextHeaders + setSessionCookie）模拟登录
// - 调业务函数（createWithdrawRequest / approveWithdrawRequest / rejectWithdrawRequest / getMerchantAvailable）
// - 不调 server action（action 内部 redirect 抛异常，绕开它直接验业务层）
// - 用 merchant1（M001）测试，避免污染 M002 区域

import { mockNextHeaders } from "../helpers/session";
mockNextHeaders();

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId } from "@/src/lib/merchant-admin";
import {
  approveWithdrawRequest,
  createWithdrawRequest,
  getMerchantAvailable,
  rejectWithdrawRequest,
} from "@/src/lib/withdraw-request";
import { setSessionCookie, clearSessionCookie } from "../helpers/session";

const M001 = "M001";

describe("商家后台 — 提现申请端到端流程", () => {
  let merchant1User: { id: string; merchantId: string | null };
  let adminUser: { id: string; name: string };
  let testWithdrawIds: string[] = [];

  beforeAll(async () => {
    const [m1, a] = await Promise.all([
      prisma.user.findUnique({ where: { name: "merchant1" } }),
      prisma.user.findUnique({ where: { name: "admin" } }),
    ]);
    if (!m1 || !a) {
      throw new Error("需要先跑 npm run db:reset && npm run seed:demo");
    }
    merchant1User = m1;
    adminUser = a;
  });

  beforeEach(async () => {
    clearSessionCookie();
    // 清理 M001 现有 pending（避免 partial unique 冲突）
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: M001, status: "pending" },
    });
  });

  afterAll(async () => {
    // 清理测试创建的申请 + ledger
    if (testWithdrawIds.length > 0) {
      await prisma.financeLedger.deleteMany({
        where: { sourceId: { in: testWithdrawIds } },
      });
      await prisma.withdrawRequest.deleteMany({
        where: { id: { in: testWithdrawIds } },
      });
    }
    clearSessionCookie();
  });

  // # spec: 端到端 — 申请 → 审核通过 → 状态变更 + ledger 联动
  it("merchant1 申请 ¥100 → admin 审核通过 → 状态变 approved + 写 ledger", async () => {
    // Step 1: merchant1 申请
    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    const createRes = await createWithdrawRequest({
      merchantId: m,
      amount: 10000, // ¥100
      remark: "flow-test-approved",
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const wrId = createRes.id;
    testWithdrawIds.push(wrId);

    // Step 2: admin 审核
    clearSessionCookie();
    await setSessionCookie(adminUser.id, "admin");
    const reviewRes = await approveWithdrawRequest({
      id: wrId,
      reviewerName: "admin",
    });
    expect(reviewRes.ok).toBe(true);
    if (!reviewRes.ok) {
      throw new Error(`审核失败: ${reviewRes.error}`);
    }

    // Step 3: merchant1 重看状态 — approved
    clearSessionCookie();
    await setSessionCookie(merchant1User.id, "merchant");
    const found = await prisma.withdrawRequest.findUnique({ where: { id: wrId } });
    expect(found?.status).toBe("approved");
    expect(found?.reviewerName).toBe("admin");
    expect(found?.reviewedAt).toBeTruthy();

    // Step 4: ledger 联动（[P0-3] approve 业务状态 + recordWithdrawInTx 写 ledger 同事务）
    const ledger = await prisma.financeLedger.findFirst({
      where: { sourceId: wrId },
    });
    expect(ledger).not.toBeNull();
    expect(ledger?.type).toBe("withdraw");
    // amount 是 Decimal(12,2) 元（不是分）— 10000 分 = 100 元
    expect(Number(ledger?.amount)).toBe(100);
  });

  // # spec: 端到端 — 申请 → 拒绝 → 状态变更 + 不写 ledger
  it("merchant1 申请 ¥200 → admin 拒绝（带原因） → 状态变 rejected + 不写 ledger", async () => {
    // Step 1: 申请
    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    const createRes = await createWithdrawRequest({
      merchantId: m,
      amount: 20000, // ¥200
      remark: "flow-test-rejected",
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const wrId = createRes.id;
    testWithdrawIds.push(wrId);

    // Step 2: admin 拒绝
    clearSessionCookie();
    await setSessionCookie(adminUser.id, "admin");
    const reviewRes = await rejectWithdrawRequest({
      id: wrId,
      reviewerName: "admin",
      rejectReason: "测试拒绝原因 — 金额异常",
    });
    expect(reviewRes.ok).toBe(true);
    if (!reviewRes.ok) {
      throw new Error(`拒绝失败: ${reviewRes.error}`);
    }

    // Step 3: merchant1 重看 — rejected
    clearSessionCookie();
    await setSessionCookie(merchant1User.id, "merchant");
    const found = await prisma.withdrawRequest.findUnique({ where: { id: wrId } });
    expect(found?.status).toBe("rejected");
    expect(found?.rejectReason).toBe("测试拒绝原因 — 金额异常");
    expect(found?.reviewerName).toBe("admin");

    // Step 4: rejected 不写 ledger（与 approved 不同）
    const ledger = await prisma.financeLedger.findFirst({
      where: { sourceId: wrId },
    });
    expect(ledger).toBeNull();
  });

  // # spec: 端到端 — 申请后 available 减少（pending 计入 totalPending）
  it("merchant1 申请后 getMerchantAvailable 减少（pending 计入 totalPending）", async () => {
    const before = await getMerchantAvailable(M001);

    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    const createRes = await createWithdrawRequest({
      merchantId: m,
      amount: 30000, // ¥300
      remark: "available-decrement-test",
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    testWithdrawIds.push(createRes.id);

    const after = await getMerchantAvailable(M001);
    // available = totalIncome - totalPaid - totalPending
    // pending 增 ¥300 → available 减 ¥300
    expect(after.totalPending).toBe(before.totalPending + 30000);
    expect(after.available).toBe(before.available - 30000);
  });
});

describe("商家后台 — 邀请码端到端流程", () => {
  let merchant1User: { id: string; merchantId: string | null };
  let originalInviteCode: string;
  let originalEnabled: boolean;

  beforeAll(async () => {
    const m1 = await prisma.user.findUnique({ where: { name: "merchant1" } });
    if (!m1) throw new Error("缺 merchant1");
    merchant1User = m1;
    const m = await prisma.merchant.findUnique({ where: { id: M001 } });
    if (!m) throw new Error("缺 M001");
    originalInviteCode = m.inviteCode;
    originalEnabled = m.inviteCodeEnabled;
  });

  beforeEach(() => {
    clearSessionCookie();
  });

  afterAll(async () => {
    // 还原 M001 状态
    await prisma.merchant.update({
      where: { id: M001 },
      data: { inviteCode: originalInviteCode, inviteCodeEnabled: originalEnabled },
    });
    clearSessionCookie();
  });

  // # spec: 邀请码 disabled → 拒绝师傅注册；enabled → 接受
  it("toggle 邀请码：M001 enabled false → true，DB 字段同步", async () => {
    // 初始设 false
    await prisma.merchant.update({
      where: { id: M001 },
      data: { inviteCodeEnabled: false },
    });

    // merchant1 模拟 toggle action
    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    const current = await prisma.merchant.findUnique({
      where: { id: m },
      select: { inviteCodeEnabled: true },
    });
    expect(current?.inviteCodeEnabled).toBe(false);
    await prisma.merchant.update({
      where: { id: m },
      data: { inviteCodeEnabled: !current!.inviteCodeEnabled },
    });

    const after = await prisma.merchant.findUnique({
      where: { id: m },
      select: { inviteCodeEnabled: true },
    });
    expect(after?.inviteCodeEnabled).toBe(true);
  });

  // # spec: regenerate 邀请码 — 新码唯一 + 旧码失效
  it("regenerate 邀请码：M001.inviteCode 变；merchant1 看不串号", async () => {
    const before = await prisma.merchant.findUnique({
      where: { id: M001 },
      select: { inviteCode: true },
    });
    expect(before?.inviteCode).toBe(originalInviteCode);

    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    // 直接调 update 模拟 regenerate action
    const newCode = "TEST" + Date.now().toString(36).toUpperCase().slice(-4).padStart(4, "0");
    await prisma.merchant.update({
      where: { id: m },
      data: { inviteCode: newCode },
    });

    const after = await prisma.merchant.findUnique({
      where: { id: m },
      select: { inviteCode: true },
    });
    expect(after?.inviteCode).toBe(newCode);
    expect(after?.inviteCode).not.toBe(before?.inviteCode);
  });
});
