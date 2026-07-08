// [v0.7.7] E2E 单测 — 修 R5: InternalRemarkForm 缺单测
// 修同类 v0.7.2 logout 漏 CSRF bug（防回归）
//
// 覆盖：
// 1. CSRF 校验（formData 缺 _csrf / _csrf 不匹配 → 拒绝）
// 2. admin 角色校验（customer/worker 调 → 拒绝）
// 3. 合法调用 → 成功 + ActivityLog 记录

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// ---- mock next/headers cookies() ----
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string, _options?: unknown) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

// ---- mock currentUser 路径 ----
// 不能直接 mock src/lib/auth（动态 import 会绕过）—— 用全局 flag 控制
let mockUser: {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  workerId: string | null;
} | null = null;
vi.mock("@/src/lib/auth", () => ({
  getCurrentUser: async () => mockUser,
  getSession: async () =>
    mockUser ? { userId: mockUser.id, role: mockUser.role } : {},
  readCsrfCookie: async () => "",
  ensureCsrfCookie: async () => "",
  verifyCsrfToken: async (token: string | null) => {
    if (!token) return false;
    const cookie = cookieStore.get("o2o_csrf");
    if (!cookie) return false;
    if (cookie.length !== token.length) return false;
    // 时序安全比较（与 csrf.ts 行为一致）
    let result = 0;
    for (let i = 0; i < cookie.length; i++) {
      result |= cookie.charCodeAt(i) ^ token.charCodeAt(i);
    }
    return result === 0;
  },
  CSRF_COOKIE: "o2o_csrf",
  CSRF_FORM_FIELD: "_csrf",
  COOKIE_OPTIONS: {},
  SESSION_COOKIE: "o2o_session",
  ROLE_COOKIE: "o2o_role",
  DEFAULT_LANDING: {
    admin: "/dashboard",
    worker: "/worker",
    customer: "/customer/orders",
  },
  ROLE_ALLOWED: { admin: [], worker: [], customer: [] },
  PROTECTED_PATHS: [],
  PUBLIC_PATHS: [],
  isProtectedPath: () => false,
  canAccess: () => false,
  authenticate: async () => null,
  isAuthenticated: async () => false,
}));

const prisma = new PrismaClient({ log: ["error"] });

// 动态 import（必须在 mock 之后）
const { updateInternalRemarkAction } = await import("@/app/orders/actions");

// ============================================================
// 测试隔离
// ============================================================
beforeEach(() => {
  cookieStore.clear();
  cookieStore.set("o2o_csrf", "test-csrf-token"); // 预存合法 csrf
  mockUser = null;
});

afterEach(async () => {
  cookieStore.clear();
  mockUser = null;
  await prisma.order.updateMany({
    where: { id: { startsWith: "_test_remark_" } },
    data: { internalRemark: null },
  });
  await prisma.activityLog.deleteMany({
    where: { targetId: { startsWith: "_test_remark_" } },
  });
});

// ============================================================
// # spec: CSRF 校验 — 修 v0.7.6 漏 CSRF 的同类 bug
// ============================================================
describe("updateInternalRemarkAction — CSRF 校验", () => {
  // # spec: 缺 _csrf → 拒绝（v0.7.2 logout 漏 CSRF 同类 bug）
  it("formData 缺 _csrf → 拒绝", async () => {
    mockUser = {
      id: "test-admin",
      name: "test-admin",
      role: "admin",
      phone: null,
      workerId: null,
    };
    const fd = new FormData();
    fd.set("orderId", "_test_remark_O001");
    fd.set("internalRemark", "test");
    // 没设 _csrf
    const result = await updateInternalRemarkAction(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/会话已过期|CSRF/);
    }
  });

  // # spec: _csrf 与 cookie 不匹配 → 拒绝
  it("_csrf 与 cookie 不匹配 → 拒绝", async () => {
    mockUser = {
      id: "test-admin",
      name: "test-admin",
      role: "admin",
      phone: null,
      workerId: null,
    };
    const fd = new FormData();
    fd.set("orderId", "_test_remark_O001");
    fd.set("internalRemark", "test");
    fd.set("_csrf", "wrong-token");
    const result = await updateInternalRemarkAction(fd);
    expect(result.ok).toBe(false);
  });

  // # spec: _csrf 匹配 + admin → 成功
  it("_csrf 匹配 + admin → 成功（写 DB + ActivityLog）", async () => {
    mockUser = {
      id: "test-admin",
      name: "test-admin",
      role: "admin",
      phone: null,
      workerId: null,
    };
    // 准备一个测试订单
    const sku = await prisma.serviceSku.findFirst({ where: { enabled: true } });
    if (!sku) {
      // seed 没跑 — skip
      return;
    }
    const order = await prisma.order.create({
      data: {
        id: "_test_remark_O001",
        customerName: "Test",
        customerPhone: "13900000000",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        address: "Test",
        scheduledAt: new Date(),
        amount: 1000,
        status: "pending",
      },
    });

    const fd = new FormData();
    fd.set("orderId", order.id);
    fd.set("internalRemark", "test internal remark");
    fd.set("_csrf", "test-csrf-token");
    const result = await updateInternalRemarkAction(fd);
    expect(result.ok).toBe(true);

    // 验证 DB 写入
    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.internalRemark).toBe("test internal remark");

    // 验证 ActivityLog
    const log = await prisma.activityLog.findFirst({
      where: { targetId: order.id, action: "order_internal_remark_updated" },
    });
    expect(log).not.toBeNull();
  });
});

// ============================================================
// # spec: 权限校验 — 非 admin 调 → 拒绝
// ============================================================
describe("updateInternalRemarkAction — 权限校验", () => {
  // # spec: customer 角色调 → 拒绝
  it("customer 角色 → 拒绝", async () => {
    mockUser = {
      id: "test-customer",
      name: "test-customer",
      role: "customer",
      phone: "13900000000",
      workerId: null,
    };
    const fd = new FormData();
    fd.set("orderId", "_test_remark_O002");
    fd.set("internalRemark", "test");
    fd.set("_csrf", "test-csrf-token");
    const result = await updateInternalRemarkAction(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/仅管理员|admin/);
    }
  });

  // # spec: worker 角色调 → 拒绝
  it("worker 角色 → 拒绝", async () => {
    mockUser = {
      id: "test-worker",
      name: "test-worker",
      role: "worker",
      phone: "13900000001",
      workerId: "T001",
    };
    const fd = new FormData();
    fd.set("orderId", "_test_remark_O003");
    fd.set("internalRemark", "test");
    fd.set("_csrf", "test-csrf-token");
    const result = await updateInternalRemarkAction(fd);
    expect(result.ok).toBe(false);
  });

  // # spec: 未登录（无 user）→ 拒绝
  it("未登录（mockUser=null）→ 拒绝", async () => {
    mockUser = null;
    const fd = new FormData();
    fd.set("orderId", "_test_remark_O004");
    fd.set("internalRemark", "test");
    fd.set("_csrf", "test-csrf-token");
    const result = await updateInternalRemarkAction(fd);
    expect(result.ok).toBe(false);
  });
});
