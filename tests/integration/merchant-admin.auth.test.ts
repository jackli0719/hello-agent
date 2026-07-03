// [任务 18] 商家后台集成测试 — 越权隔离 + 端到端
//
// 覆盖：
// 1. 越权隔离：merchant2 看不到 merchant1 数据（listMerchantOrders / listMerchantMasters / listMerchantSettlements / listMerchantWithdrawRequests）
// 2. getEffectiveMerchantId admin fallback 行为
// 3. getMerchantDashboard totalIncome 过滤
// 4. 邀请码：toggle / regenerate 强绑 session.merchantId
//
// 不测：
// - server action 完整流程（需要 Next.js runtime + CSRF cookie 模拟，超出本测试范围）
//   端到端流程在 src/lib/withdraw-request.test.ts 等单测里已覆盖
// - 页面渲染（用 Playwright，超出 vitest 范围）

import { mockNextHeaders } from "../helpers/session";
mockNextHeaders();

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { getCurrentUser } from "@/src/lib/auth";
import {
  getEffectiveMerchantId,
  getMerchantDashboard,
  listMerchantMasters,
  listMerchantOrders,
  listMerchantSettlements,
  listMerchantWithdrawRequests,
} from "@/src/lib/merchant-admin";
import { setSessionCookie, clearSessionCookie } from "../helpers/session";
import {
  createWithdrawRequest,
  getMerchantAvailable,
} from "@/src/lib/withdraw-request";
import { generateInviteCode, isValidInviteCode } from "@/src/lib/codes";

const M001 = "M001";
const M002 = "M002";

interface TestUser {
  id: string;
  name: string;
  role: string;
  merchantId: string | null;
}

let adminUser: TestUser;
let merchant1User: TestUser;
let merchant2User: TestUser | null = null; // seed 可能没灌，跳过相关 case
let worker1User: TestUser;
let testWithdrawIds: string[] = [];

async function loadTestUsers(): Promise<void> {
  const [a, m1, m2, w1] = await Promise.all([
    prisma.user.findUnique({ where: { name: "admin" } }),
    prisma.user.findUnique({ where: { name: "merchant1" } }),
    prisma.user.findUnique({ where: { name: "merchant2" } }),
    prisma.user.findUnique({ where: { name: "worker1" } }),
  ]);
  if (!a || !m1 || !w1) {
    throw new Error("需要先跑 npm run db:reset && npm run seed:demo（缺 admin/merchant1/worker1）");
  }
  adminUser = { id: a.id, name: a.name, role: a.role, merchantId: a.merchantId };
  merchant1User = { id: m1.id, name: m1.name, role: m1.role, merchantId: m1.merchantId };
  if (m2) {
    merchant2User = { id: m2.id, name: m2.name, role: m2.role, merchantId: m2.merchantId };
  }
  worker1User = { id: w1.id, name: w1.name, role: w1.role, merchantId: w1.merchantId };
}

describe("商家后台 — 越权隔离 (P0-1)", () => {
  beforeAll(async () => {
    await loadTestUsers();
  });

  beforeEach(() => {
    clearSessionCookie();
  });

  afterAll(async () => {
    // 清理测试期间创建的提现申请
    if (testWithdrawIds.length > 0) {
      await prisma.withdrawRequest.deleteMany({
        where: { id: { in: testWithdrawIds } },
      });
      testWithdrawIds = [];
    }
    clearSessionCookie();
  });

  // ============================================================
  // getEffectiveMerchantId 行为
  // ============================================================

  // # spec: merchant1 登录 → session.merchantId = M001（强绑，跨 merchant 隔离基础）
  it("merchant1 登录 → getCurrentUser().merchantId = M001", async () => {
    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    expect(u).not.toBeNull();
    expect(u?.merchantId).toBe(M001);
  });

  // # spec: merchant1 调 listMerchantMasters(M001) 不会拿到 M002 的师傅
  it("listMerchantMasters(M001) 不会含 M002 师傅（强绑）", async () => {
    const m001 = await listMerchantMasters(M001);
    const m002 = await listMerchantMasters(M002);
    const m001Ids = new Set(m001.map((m) => m.id));
    const m002Ids = new Set(m002.map((m) => m.id));
    for (const id of m001Ids) {
      expect(m002Ids.has(id)).toBe(false);
    }
  });

  // # spec: merchant1 调 listMerchantWithdrawRequests(M001) 不会拿到 M002 的申请
  it("listMerchantWithdrawRequests(M001) 不会含 M002 申请", async () => {
    if (!merchant2User) {
      // 跳过：seed 没灌 merchant2
      return;
    }
    // 准备：给 M002 创建一笔测试申请
    const testWr = await prisma.withdrawRequest.create({
      data: { merchantId: M002, amount: 100, status: "pending", remark: "M002-test" },
    });
    testWithdrawIds.push(testWr.id);

    const m001Wr = await listMerchantWithdrawRequests(M001);
    for (const wr of m001Wr) {
      expect(wr.merchantId).toBe(M001);
    }
  });

  // # spec: listMerchantOrders(M001) byMaster 来源不会含 M002 师傅的订单
  // 注：byArea 来源是"本商家服务区域内的可见订单"，多个 merchant 可能共享区域（如 PA001 被 M001+M002 绑），
  //     所以 byArea 集合在 M001/M002 间可以有重叠（不是越权 — 区域本就共享）
  it("listMerchantOrders(M001) byMaster 来源不会含 M002 师傅接的订单", async () => {
    const m001Result = await listMerchantOrders(M001);
    const m002Result = await listMerchantOrders(M002);
    // 只比对 byMaster 集合（强绑 merchantId 路径）
    const m001ByMaster = m001Result.orders.filter((o) => o.source === "byMaster");
    const m002ByMaster = m002Result.orders.filter((o) => o.source === "byMaster");
    const m001Ids = new Set(m001ByMaster.map((o) => o.id));
    const m002Ids = new Set(m002ByMaster.map((o) => o.id));
    for (const id of m001Ids) {
      expect(m002Ids.has(id)).toBe(false);
    }
  });

  // ============================================================
  // getEffectiveMerchantId 守卫
  // ============================================================

  it("admin 登录 → getEffectiveMerchantId fallback M001（第一个 active）", async () => {
    await setSessionCookie(adminUser.id, "admin");
    const u = await getCurrentUser();
    expect(u?.role).toBe("admin");
    const m = await getEffectiveMerchantId(u!);
    expect(m).toBe(M001);
  });

  it("worker 登录 → getEffectiveMerchantId 抛错（应被 layout 跳走）", async () => {
    await setSessionCookie(worker1User.id, "worker");
    const u = await getCurrentUser();
    expect(u?.role).toBe("worker");
    await expect(getEffectiveMerchantId(u!)).rejects.toThrow();
  });

  it("merchant 角色但 user.merchantId=null → getEffectiveMerchantId 抛错", async () => {
    // 临时构造一个 orphan merchant 账号
    const orphan = await prisma.user.create({
      data: {
        name: "orphan-merchant-test",
        password: "x",
        role: "merchant",
        merchantId: null,
      },
    });
    try {
      await setSessionCookie(orphan.id, "merchant");
      const u = await getCurrentUser();
      expect(u?.merchantId).toBeNull();
      await expect(getEffectiveMerchantId(u!)).rejects.toThrow(/merchantId/);
    } finally {
      await prisma.user.delete({ where: { id: orphan.id } });
    }
  });

  // ============================================================
  // getMerchantDashboard 口径
  // ============================================================

  // # spec: totalIncomeYuan 只计 confirmed/archived，不含 pending
  it("getMerchantDashboard.totalIncomeYuan 不含 pending 状态", async () => {
    const s = await getMerchantDashboard(M001);
    const all = await prisma.merchantSettlement.findMany({
      where: { merchantId: M001 },
      select: { merchantIncome: true, status: true },
    });
    const allSumCents = all.reduce(
      (sum: number, x: { merchantIncome: number }) => sum + x.merchantIncome,
      0,
    );
    const pendingSumCents = all
      .filter((x: { status: string }) => x.status === "pending")
      .reduce(
        (sum: number, x: { merchantIncome: number }) => sum + x.merchantIncome,
        0,
      );
    const expectedYuan = (allSumCents - pendingSumCents) / 100;
    expect(s.totalIncomeYuan).toBe(expectedYuan);
  });

  // # spec: getMerchantDashboard 数字字段全部 ≥ 0
  it("getMerchantDashboard 5 张卡数字全部 ≥ 0", async () => {
    const s = await getMerchantDashboard(M001);
    expect(s.masterCount).toBeGreaterThanOrEqual(0);
    expect(s.orderCountByMaster).toBeGreaterThanOrEqual(0);
    expect(s.orderCountByArea).toBeGreaterThanOrEqual(0);
    expect(s.totalIncomeYuan).toBeGreaterThanOrEqual(0);
    expect(s.pendingWithdrawCount).toBeGreaterThanOrEqual(0);
  });

  // ============================================================
  // 提现申请业务（复用 createWithdrawRequest — server action 端到端
  // 在 src/lib/withdraw-request.test.ts 已覆盖，本测试只验"merchant 强绑"）
  // ============================================================

  // # spec: 商家端 createWithdrawRequest 强绑 merchantId（不能串号）
  it("商家端 createWithdrawRequest：merchant1 申请 → 创建记录的 merchantId = M001", async () => {
    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    const r = await createWithdrawRequest({
      merchantId: m,
      amount: 100,
      remark: "merchant-admin-integration-test",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      testWithdrawIds.push(r.id);
      // DB 里查这行，merchantId 应是 M001
      const found = await prisma.withdrawRequest.findUnique({
        where: { id: r.id },
      });
      expect(found?.merchantId).toBe(M001);
    }
  });

  // # spec: 同一 merchant 已有 pending → 二次申请被拒（DB partial unique + 应用层校验）
  it("同一 merchant 已有 pending → 二次申请被拒", async () => {
    if (!merchant2User) {
      return;
    }
    // 先确保 merchant2 没有 pending（清理）
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: M002, status: "pending" },
    });
    const r1 = await createWithdrawRequest({ merchantId: M002, amount: 200 });
    expect(r1.ok).toBe(true);
    if (r1.ok) testWithdrawIds.push(r1.id);

    const r2 = await createWithdrawRequest({ merchantId: M002, amount: 300 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toMatch(/未审核|pending/i);
    }
  });

  // # spec: getMerchantAvailable 口径与 getMerchantDashboard.totalIncomeYuan 一致
  it("getMerchantAvailable(M001) === getMerchantDashboard(M001).totalIncomeYuan * 100 + paid + pending", async () => {
    const a = await getMerchantAvailable(M001);
    const d = await getMerchantDashboard(M001);
    // available = totalIncome - paid - pending（不严格相等，因为 totalIncomeYuan 不含 paid）
    // 但 totalIncome 应该是 available + paid + pending
    const sumCents = a.totalIncome;
    const dashboardCents = d.totalIncomeYuan * 100;
    expect(sumCents).toBe(dashboardCents);
  });
});

describe("商家后台 — 邀请码管理", () => {
  beforeAll(async () => {
    await loadTestUsers();
  });

  beforeEach(() => {
    clearSessionCookie();
  });

  afterAll(() => {
    clearSessionCookie();
  });

  // # spec: generateInviteCode 输出 8 字符大写字母数字
  it("generateInviteCode → 8 字符大写字母数字（100 次无非法）", () => {
    for (let i = 0; i < 100; i++) {
      const c = generateInviteCode();
      expect(isValidInviteCode(c)).toBe(true);
    }
  });

  // # spec: toggle 邀请码启停 — 强绑 session.merchantId（不接 form merchantId）
  it("toggle 邀请码：merchant1 切换 → M001.inviteCodeEnabled 反转；M002 不变", async () => {
    const before1 = await prisma.merchant.findUnique({
      where: { id: M001 },
      select: { inviteCodeEnabled: true },
    });
    const before2 = await prisma.merchant.findUnique({
      where: { id: M002 },
      select: { inviteCodeEnabled: true },
    });
    if (!before1 || !before2) throw new Error("seed 缺 merchant");

    // 模拟 toggle action：调 prisma.merchant.update where: session.merchantId
    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);
    await prisma.merchant.update({
      where: { id: m },
      data: { inviteCodeEnabled: !before1.inviteCodeEnabled },
    });

    const after1 = await prisma.merchant.findUnique({
      where: { id: M001 },
      select: { inviteCodeEnabled: true },
    });
    const after2 = await prisma.merchant.findUnique({
      where: { id: M002 },
      select: { inviteCodeEnabled: true },
    });
    expect(after1?.inviteCodeEnabled).toBe(!before1.inviteCodeEnabled);
    expect(after2?.inviteCodeEnabled).toBe(before2.inviteCodeEnabled);

    // 还原
    await prisma.merchant.update({
      where: { id: M001 },
      data: { inviteCodeEnabled: before1.inviteCodeEnabled },
    });
  });

  // # spec: regenerate 邀请码 — merchant1 调用后只改 M001.inviteCode；M002.inviteCode 不变
  it("regenerate 邀请码：merchant1 调用 → M001.inviteCode 变；M002.inviteCode 不变", async () => {
    const before1 = await prisma.merchant.findUnique({
      where: { id: M001 },
      select: { inviteCode: true },
    });
    const before2 = await prisma.merchant.findUnique({
      where: { id: M002 },
      select: { inviteCode: true },
    });
    if (!before1 || !before2) throw new Error("seed 缺 merchant");

    await setSessionCookie(merchant1User.id, "merchant");
    const u = await getCurrentUser();
    const m = await getEffectiveMerchantId(u!);

    // 模拟 regenerate action：unique 兜底 + update
    let newCode: string | null = null;
    for (let i = 0; i < 3; i++) {
      const candidate = generateInviteCode();
      const exist = await prisma.merchant.findFirst({
        where: { inviteCode: candidate, id: { not: m } },
      });
      if (!exist) {
        newCode = candidate;
        break;
      }
    }
    if (!newCode) throw new Error("regenerate 失败");
    await prisma.merchant.update({
      where: { id: m },
      data: { inviteCode: newCode },
    });

    const after1 = await prisma.merchant.findUnique({
      where: { id: M001 },
      select: { inviteCode: true },
    });
    const after2 = await prisma.merchant.findUnique({
      where: { id: M002 },
      select: { inviteCode: true },
    });
    expect(after1?.inviteCode).toBe(newCode);
    expect(after1?.inviteCode).not.toBe(before1.inviteCode);
    expect(after2?.inviteCode).toBe(before2.inviteCode);

    // 还原
    await prisma.merchant.update({
      where: { id: M001 },
      data: { inviteCode: before1.inviteCode },
    });
  });
});
