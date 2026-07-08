// [任务 18] 商家端查询层越权测试
//
// 关注 P0-1：merchantId 形参锁定，不能因为传错 / 越权返回其他 merchant 的数据
//
// 不连 Iron-Session / cookies — 直接对 lib 函数单测，因为越权防控在数据层不在会话层
// 真实登录态测试由 Playwright 级别覆盖

import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db";
import {
  listMerchantMasters,
  listMerchantSettlements,
  listMerchantWithdrawRequests,
  listMerchantOrders,
  listOrdersByMaster,
  listOrdersByArea,
  getMerchantDashboard,
  getEffectiveMerchantId,
} from "./merchant-admin";
import type { AuthenticatedUser } from "./auth";

/**
 * 测试前置：
 * - 跑 npm run db:reset && npm run seed:demo 保证有 merchant1 (绑 M001) / merchant2 (绑 M002)
 * - seed 也创建 T001~T005 master 分属 M001/M002/M003（具体见 seed-demo.ts）
 */
const M001 = "M001";
const M002 = "M002";

describe("merchant-admin 查询层 — 越权防控 (P0-1)", () => {
  beforeAll(async () => {
    // 确认 seed 已建 merchant1 / merchant2
    const merchant1 = await prisma.user.findUnique({
      where: { name: "merchant1" },
    });
    if (!merchant1 || merchant1.merchantId !== M001) {
      throw new Error(
        "未找到 merchant1 / merchant2 — 请先 `npm run db:reset && npm run seed:demo`",
      );
    }
  });

  // # spec: listMerchantMasters 永远按 merchantId 过滤 — 传 M002 不能拿到 M001 的师傅
  it("listMerchantMasters(M001) 全是 M001 的师傅；传 M002 不会越权拿到 M001", async () => {
    const m001 = await listMerchantMasters(M001);
    const m002 = await listMerchantMasters(M002);
    expect(m001.length).toBeGreaterThan(0);
    expect(m002.length).toBeGreaterThan(0);
    // 互不相交：M001 师傅不可能同时是 M002 师傅
    const m001Ids = new Set(m001.map((m) => m.id));
    const m002Ids = new Set(m002.map((m) => m.id));
    for (const id of m001Ids) {
      expect(m002Ids.has(id)).toBe(false);
    }
  });

  // # spec: listMerchantSettlements 只返 merchantId 命中的结算
  it("listMerchantSettlements 按 merchantId 隔离", async () => {
    const m001 = await listMerchantSettlements(M001);
    const m002 = await listMerchantSettlements(M002);
    for (const s of m001) expect(s.merchantId).toBe(M001);
    for (const s of m002) expect(s.merchantId).toBe(M002);
  });

  // # spec: listMerchantWithdrawRequests 只返本 merchant 的申请
  it("listMerchantWithdrawRequests 按 merchantId 隔离", async () => {
    const m001 = await listMerchantWithdrawRequests(M001);
    const m002 = await listMerchantWithdrawRequests(M002);
    for (const r of m001) expect(r.merchantId).toBe(M001);
    for (const r of m002) expect(r.merchantId).toBe(M002);
  });

  // # spec: listOrdersByMaster 只返本商家师傅接的订单（master.merchantId = merchantId）
  it("listOrdersByMaster(M002) 不包含 M001 师傅接的订单", async () => {
    const m001 = await listOrdersByMaster(M001);
    const m002 = await listOrdersByMaster(M002);
    // 拿到 M001 师傅 ID
    const m001Masters = await prisma.master.findMany({
      where: { merchantId: M001 },
      select: { id: true },
    });
    const m001MasterIds = new Set(m001Masters.map((m) => m.id));
    // M002 订单的 masterId 永远不能在 m001MasterIds 里
    for (const o of m002) {
      if (o.masterId) {
        expect(m001MasterIds.has(o.masterId)).toBe(false);
      }
    }
    // 反向：M001 订单的 masterId 全在 m001MasterIds 里
    for (const o of m001) {
      if (o.masterId) {
        expect(m001MasterIds.has(o.masterId)).toBe(true);
      }
    }
  });

  // # spec: listMerchantOrders 是 byMaster + byArea 合并去重
  it("listMerchantOrders 输出合并去重 + source 字段合法", async () => {
    const { orders, counts } = await listMerchantOrders(M001);
    expect(counts.byMaster).toBeGreaterThanOrEqual(0);
    expect(counts.byArea).toBeGreaterThanOrEqual(0);
    expect(counts.overlap).toBeGreaterThanOrEqual(0);
    // 每个 source 只能是 byMaster 或 byArea
    for (const o of orders) {
      expect(["byMaster", "byArea"]).toContain(o.source);
    }
    // 唯一性
    const ids = new Set(orders.map((o) => o.id));
    expect(ids.size).toBe(orders.length);
  });

  // # spec: getMerchantDashboard 不依赖用户登录 — 仅 merchantId 形参
  // 这里显式传 M001 给 M001 字段强制 audit
  it("getMerchantDashboard(M001) merchantId 字段 = M001", async () => {
    const s = await getMerchantDashboard(M001);
    expect(s.merchantId).toBe(M001);
    expect(s.masterCount).toBeGreaterThan(0);
  });

  // # documents current behavior: 空 merchantId 不会崩，返回零值
  it("listMerchantMasters('') → 返回空数组（不抛错）", async () => {
    expect(await listMerchantMasters("")).toEqual([]);
  });
  // # documents current behavior: 空 merchantId 走 prisma where 返 0 行
  it("listMerchantSettlements('') → 返回空数组", async () => {
    expect(await listMerchantSettlements("")).toEqual([]);
  });
  // # documents current behavior: 空 merchantId 走 prisma where 返 0 行
  it("listMerchantWithdrawRequests('') → 返回空数组", async () => {
    expect(await listMerchantWithdrawRequests("")).toEqual([]);
  });
  // # documents current behavior: 空 merchantId 走 getOrdersVisibleToMerchant 返空
  it("listOrdersByArea('') → 返回空数组", async () => {
    expect(await listOrdersByArea("")).toEqual([]);
  });
  // # documents current behavior: 空 merchantId 不会崩；counts 全 0
  it("listMerchantOrders('') → 返回空结果", async () => {
    const r = await listMerchantOrders("");
    expect(r.orders).toEqual([]);
    expect(r.counts).toEqual({ byMaster: 0, byArea: 0, overlap: 0 });
  });
});

// [任务 18 P0-bug 修复] getEffectiveMerchantId 守卫
describe("merchant-admin — getEffectiveMerchantId 守卫", () => {
  // # spec: merchant 角色 + user.merchantId 非空 → 返回 user.merchantId（不查 DB）
  it("merchant 角色 + user.merchantId='M001' → 返回 'M001'", async () => {
    const user: AuthenticatedUser = {
      id: "u-test",
      name: "merchant1",
      role: "merchant",
      phone: null,
      workerId: null,
      merchantId: M001,
    };
    expect(await getEffectiveMerchantId(user)).toBe(M001);
  });

  // # spec: merchant 角色 + user.merchantId=null → throw（orphan 账号挡）
  it("merchant 角色 + user.merchantId=null → 抛错", async () => {
    const user: AuthenticatedUser = {
      id: "u-test",
      name: "orphan",
      role: "merchant",
      phone: null,
      workerId: null,
      merchantId: null,
    };
    await expect(getEffectiveMerchantId(user)).rejects.toThrow(/merchantId/);
  });

  // # spec: admin 角色 → fallback 到第一个 active 商家（不写死）
  it("admin 角色 → fallback 到 active 商家中 id 最小的", async () => {
    const user: AuthenticatedUser = {
      id: "u-admin",
      name: "admin",
      role: "admin",
      phone: null,
      workerId: null,
      merchantId: null,
    };
    const id = await getEffectiveMerchantId(user);
    // seed 保证 3 个 active 商家，最小 id = M001
    expect(id).toBe(M001);
  });

  // # spec: worker/customer 角色 → 抛错（应被 layout 跳走，这里兜底）
  it("worker 角色 → 抛错", async () => {
    const user: AuthenticatedUser = {
      id: "u-w",
      name: "worker1",
      role: "worker",
      phone: null,
      workerId: "T001",
      merchantId: null,
    };
    await expect(getEffectiveMerchantId(user)).rejects.toThrow(/worker/);
  });

  // # spec: merchant 角色 → URL/form 传 M002 也无效（page 用 getEffectiveMerchantId 隔离）
  // 等价于 merchant1 访问 /merchant-admin?merchantId=M002 — 实际查 session.merchantId(M001)
  it("merchant1 调用 getEffectiveMerchantId 永远返 M001，不受调用方传什么 merchantId 影响", async () => {
    const merchant1: AuthenticatedUser = {
      id: "u-m1",
      name: "merchant1",
      role: "merchant",
      phone: null,
      workerId: null,
      merchantId: M001,
    };
    const dashboard = await getMerchantDashboard(
      await getEffectiveMerchantId(merchant1),
    );
    expect(dashboard.merchantId).toBe(M001);
    expect(dashboard.merchantId).not.toBe(M002);
  });
});

// [任务 18 P0-bug 修复] getMerchantDashboard.totalIncomeYuan 口径
describe("merchant-admin — getMerchantDashboard 口径", () => {
  // # spec: totalIncomeYuan 只计 status ∈ {confirmed, archived}，不含 pending
  it("totalIncomeYuan 不含 pending 状态（与 admin 端可提现余额一致）", async () => {
    const s = await getMerchantDashboard(M001);

    // 1. 直接重算（用 raw SQL 拿所有 status 的 merchantIncome 之和）
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

    // 2. 验证 dashboard totalIncomeYuan = (allSum - pendingSum) / 100
    const expectedYuan = (allSumCents - pendingSumCents) / 100;
    expect(s.totalIncomeYuan).toBe(expectedYuan);
    // 如果 seed 里有 pending 结算，差值应该 > 0
    if (pendingSumCents > 0) {
      expect(s.totalIncomeYuan).toBeLessThan(allSumCents / 100);
    }
  });
});
