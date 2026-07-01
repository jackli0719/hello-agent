// [v0.9.4] 组 1：鉴权 / CSRF helper 底座 — 测试
//
// 覆盖：
// 1. requireAdmin: 未登录 / customer / worker / admin 都走一遍
// 2. requireWorker: 未登录 / customer / admin / 无 workerId worker / 有 workerId worker
// 3. requireRole: 角色不在列表 / 在列表
// 4. requireCsrf: 缺 token / 错 token / 正 token

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// ---- mock currentUser + CSRF ----
type MockUser = {
  id: string;
  name: string;
  role: "admin" | "worker" | "customer";
  phone: string | null;
  workerId: string | null;
} | null;
let mockUser: MockUser = null;

vi.mock("@/src/lib/auth", () => ({
  getCurrentUser: async () => mockUser,
}));

vi.mock("@/src/lib/csrf", () => ({
  CSRF_FORM_FIELD: "_csrf",
  verifyCsrfToken: async (token: string | null) => {
    if (!token) return false;
    const cookie = cookieStore.get("o2o_csrf");
    if (!cookie) return false;
    if (cookie.length !== token.length) return false;
    let result = 0;
    for (let i = 0; i < cookie.length; i++) {
      result |= cookie.charCodeAt(i) ^ token.charCodeAt(i);
    }
    return result === 0;
  },
}));

// 动态 import
const { requireAdmin, requireWorker, requireRole, requireCsrf } =
  await import("./auth-helpers");

beforeEach(() => {
  cookieStore.clear();
  mockUser = null;
});

afterEach(() => {
  cookieStore.clear();
  mockUser = null;
});

// ============================================================
// requireAdmin
// ============================================================
describe("requireAdmin", () => {
  // # spec: 守卫正确性 = 未登录返回失败 + 错误信息
  it("未登录 → 守卫失败", async () => {
    mockUser = null;
    const r = await requireAdmin();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/登录|重新/);
  });

  // # spec: 角色不匹配返回失败（customer 拒）
  it("customer 角色 → 守卫失败", async () => {
    mockUser = {
      id: "c1",
      name: "customer1",
      role: "customer",
      phone: "13900000001",
      workerId: null,
    };
    const r = await requireAdmin();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/管理员/);
  });

  // # spec: worker 角色拒
  it("worker 角色 → 守卫失败", async () => {
    mockUser = {
      id: "w1",
      name: "worker1",
      role: "worker",
      phone: "13900000002",
      workerId: "T001",
    };
    const r = await requireAdmin();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/管理员/);
  });

  // # spec: admin 通过
  it("admin 角色 → 守卫成功并返回 user", async () => {
    mockUser = {
      id: "a1",
      name: "admin",
      role: "admin",
      phone: null,
      workerId: null,
    };
    const r = await requireAdmin();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.user.role).toBe("admin");
    expect(r.user.id).toBe("a1");
  });
});

// ============================================================
// requireWorker
// ============================================================
describe("requireWorker", () => {
  // # spec: 守卫未登录 = worker 守卫复用 auth 守卫逻辑
  it("未登录 → 守卫失败", async () => {
    mockUser = null;
    const r = await requireWorker();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/登录|重新/);
  });

  // # spec: worker 守卫拒 admin
  it("admin 角色 → 守卫失败", async () => {
    mockUser = {
      id: "a1",
      name: "admin",
      role: "admin",
      phone: null,
      workerId: null,
    };
    const r = await requireWorker();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/师傅/);
  });

  // # spec: customer 拒
  it("customer 角色 → 守卫失败", async () => {
    mockUser = {
      id: "c1",
      name: "customer1",
      role: "customer",
      phone: "13900000003",
      workerId: null,
    };
    const r = await requireWorker();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
  });

  // # spec: worker 但未绑 masterId → 拒
  it("worker 角色但 workerId=null → 守卫失败", async () => {
    mockUser = {
      id: "w1",
      name: "worker1",
      role: "worker",
      phone: "13900000004",
      workerId: null,
    };
    const r = await requireWorker();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/绑定师傅/);
  });

  // # spec: 完整 worker 通过
  it("worker 角色 + workerId → 守卫成功", async () => {
    mockUser = {
      id: "w1",
      name: "worker1",
      role: "worker",
      phone: "13900000005",
      workerId: "T001",
    };
    const r = await requireWorker();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.user.workerId).toBe("T001");
  });
});

// ============================================================
// requireRole
// ============================================================
describe("requireRole", () => {
  // # spec: 角色白名单不在列表 → 拒
  it("角色不在列表 → 守卫失败", async () => {
    mockUser = {
      id: "c1",
      name: "customer1",
      role: "customer",
      phone: "13900000006",
      workerId: null,
    };
    const r = await requireRole(["admin"]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/admin/);
  });

  // # spec: 角色白名单在列表 → 放行
  it("角色在列表 → 守卫成功", async () => {
    mockUser = {
      id: "c1",
      name: "customer1",
      role: "customer",
      phone: "13900000007",
      workerId: null,
    };
    const r = await requireRole(["admin", "customer"]);
    expect(r.ok).toBe(true);
  });
});

// ============================================================
// requireCsrf
// ============================================================
describe("requireCsrf", () => {
  // # spec: 缺 csrf → 拒（防止 CSRF 攻击）
  it("缺 _csrf token → 守卫失败", async () => {
    cookieStore.set("o2o_csrf", "valid-token");
    const fd = new FormData();
    // 不设 _csrf
    const r = await requireCsrf(fd);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error).toMatch(/会话|过期|刷新/);
  });

  // # spec: 错 csrf → 拒
  it("_csrf token 错误 → 守卫失败", async () => {
    cookieStore.set("o2o_csrf", "valid-token");
    const fd = new FormData();
    fd.set("_csrf", "wrong-token");
    const r = await requireCsrf(fd);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
  });

  // # spec: 正确 csrf → 放行
  it("_csrf token 匹配 → 守卫成功", async () => {
    cookieStore.set("o2o_csrf", "valid-token");
    const fd = new FormData();
    fd.set("_csrf", "valid-token");
    const r = await requireCsrf(fd);
    expect(r.ok).toBe(true);
  });
});
