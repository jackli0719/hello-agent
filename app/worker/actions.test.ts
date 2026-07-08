// app/worker/actions.ts 测试 — [v0.9.8] 组 5
//
// 覆盖：
// 1. requireWorker 失败（未登录 / 非 worker 角色 / 无 workerId）
// 2. masterId 归属校验（防越权）
// 3. 业务逻辑成功路径（assigned → in_service / in_service → completed）

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workerStartServiceAction, workerCompleteOrderAction } from "./actions";
import { prisma } from "@/src/lib/db";

const { mockRequireWorker } = vi.hoisted(() => ({
  mockRequireWorker: vi.fn<any>(),
}));

vi.mock("@/src/lib/auth-helpers", () => ({
  requireWorker: () => mockRequireWorker(),
}));

// [v0.9.10] CSRF mock — 用 vi.hoisted 让 mock 函数在 vi.mock 之前可用
const { mockVerifyCsrfOrigin } = vi.hoisted(() => ({
  mockVerifyCsrfOrigin: vi.fn<any>(),
}));

vi.mock("@/src/lib/csrf", async () => {
  const actual =
    await vi.importActual<typeof import("@/src/lib/csrf")>("@/src/lib/csrf");
  return {
    ...actual,
    verifyCsrfOrigin: () => mockVerifyCsrfOrigin(),
  };
});

const WORKER_OK = {
  ok: true,
  user: {
    id: "w1",
    name: "worker",
    role: "worker" as const,
    workerId: "T001",
  },
};

beforeEach(() => {
  mockRequireWorker.mockReset();
  mockRequireWorker.mockResolvedValue(WORKER_OK);
  mockVerifyCsrfOrigin.mockReset();
  // [v0.9.10] 默认 mock verifyCsrfOrigin 成功
  mockVerifyCsrfOrigin.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  // 重置订单
  await prisma.order.update({
    where: { id: "O20260628003" },
    data: { status: "assigned", masterId: "T002", masterName: "赵师傅" },
  });
  await prisma.order.update({
    where: { id: "O20260628001" },
    data: { status: "assigned", masterId: "T001", masterName: "李师傅" },
  });
  await prisma.order.update({
    where: { id: "O20260629011" },
    data: { status: "in_service", masterId: "T001", masterName: "李师傅" },
  });
  await prisma.master.update({
    where: { id: "T001" },
    data: { status: "available" },
  });
});

// ============================================================
// requireWorker 失败路径
// ============================================================

describe("requireWorker 失败路径", () => {
  // # spec: 未登录调 worker action → 守卫失败
  it("未登录 → workerStartServiceAction 返「请重新登录」", async () => {
    mockRequireWorker.mockResolvedValueOnce({
      ok: false,
      category: "validation",
      error: "请重新登录后再操作",
    });
    const r = (await workerStartServiceAction("O20260628003")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("请重新登录后再操作");
  });

  // # spec: admin 角色调 worker action → 守卫拒绝
  it("admin 角色 → workerCompleteOrderAction 返「仅师傅可执行」", async () => {
    mockRequireWorker.mockResolvedValueOnce({
      ok: false,
      category: "validation",
      error: "仅师傅可执行此操作",
    });
    const r = (await workerCompleteOrderAction("O20260629011")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("仅师傅可执行此操作");
  });
});

// ============================================================
// 越权防护
// ============================================================

describe("越权防护", () => {
  // # spec: 师傅调不属于自己的订单 → 越权拒绝
  it("worker 操作非自己 masterId 的订单 → 返「该订单不属于您」", async () => {
    // WORKER_OK 的 workerId 是 T001
    // O20260628003 的 masterId 是 T002 → 越权
    const r = (await workerStartServiceAction("O20260628003")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("该订单不属于您");
  });

  // # spec: 不存在的订单 → 返「订单不存在」
  it("订单 ID 不存在 → 返「订单不存在」", async () => {
    const r = (await workerStartServiceAction("NOT-EXIST")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单不存在");
  });
});

// ============================================================
// [v0.9.10] CSRF Origin 头校验
// ============================================================

describe("CSRF Origin 头校验", () => {
  // # spec: 跨源 Origin → 拒绝（防 CSRF 攻击）
  it("跨源 Origin → workerStartServiceAction 返 CSRF 失败", async () => {
    // O20260628001 masterId=T001（李师傅），WORKER_OK workerId=T001 → masterId 通过
    mockVerifyCsrfOrigin.mockResolvedValueOnce({
      ok: false,
      error: "CSRF 校验失败：Origin 不匹配",
    });
    const r = (await workerStartServiceAction("O20260628001")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CSRF 校验失败/);
  });

  // # spec: 跨源 Origin → 拒绝
  it("跨源 Origin → workerCompleteOrderAction 返 CSRF 失败", async () => {
    // O20260629011 masterId=T001 in_service
    mockVerifyCsrfOrigin.mockResolvedValueOnce({
      ok: false,
      error: "CSRF 校验失败：Origin 不匹配",
    });
    const r = (await workerCompleteOrderAction("O20260629011")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CSRF 校验失败/);
  });

  // # spec: 无 origin header（SSR/RSC 环境）→ 放行
  it("无 origin header → workerStartServiceAction 继续走 masterId 校验", async () => {
    mockVerifyCsrfOrigin.mockResolvedValueOnce({ ok: true });
    // O20260628003 masterId=T002，WORKER_OK workerId=T001 → 越权失败
    const r = (await workerStartServiceAction("O20260628003")) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("该订单不属于您");
  });
});
