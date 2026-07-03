// auth.ts 业务逻辑层测试 — 不连 DB 用 isProtectedPath / canAccess；authenticate 走真 DB（vitest 跑真 PG）。
// [账号阶段] 2026-06-29 升级：checkCredentials → authenticate（async + 查 User 表）。

import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, canAccess, isProtectedPath, type Role } from "./auth";
import { prisma } from "./db";

// # spec: 路由保护 = PROTECTED_PATHS 前缀命中、PUBLIC_PATHS 不命中；middleware 用此判断需登录
describe("isProtectedPath", () => {
  // # spec: 路由保护 — dashboard/orders/services/masters/dispatch-rules 前缀命中需登录
  it("受保护路径前缀 → true", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/orders")).toBe(true);
    expect(isProtectedPath("/orders/new")).toBe(true);
    expect(isProtectedPath("/orders/123/edit")).toBe(true);
    expect(isProtectedPath("/services")).toBe(true);
    expect(isProtectedPath("/services/skus/new")).toBe(true);
    expect(isProtectedPath("/masters")).toBe(true);
    expect(isProtectedPath("/masters/new")).toBe(true);
    expect(isProtectedPath("/platform-areas")).toBe(true);
    expect(isProtectedPath("/platform-areas/new")).toBe(true);
    expect(isProtectedPath("/merchants")).toBe(true);
    expect(isProtectedPath("/merchants/new")).toBe(true);
    expect(isProtectedPath("/commission-strategies")).toBe(true);
    expect(isProtectedPath("/commission-strategies/new")).toBe(true);
    expect(isProtectedPath("/settlements")).toBe(true);
    expect(isProtectedPath("/merchant-settlements")).toBe(true);
    expect(isProtectedPath("/payout-records")).toBe(true); // [任务 12] 打款记录
    expect(isProtectedPath("/withdraw-requests")).toBe(true); // [任务 13] 提现申请
    expect(isProtectedPath("/master-withdraw-requests")).toBe(true); // [任务 T2-1] 师傅提现申请
    expect(isProtectedPath("/finance-ledgers")).toBe(true); // [任务 14] 财务流水
    expect(isProtectedPath("/dispatch-rules")).toBe(true);
    expect(isProtectedPath("/dispatch-rules/new")).toBe(true);
    expect(isProtectedPath("/activity-logs")).toBe(true);
    // [账号阶段] 新增的受保护路径
    expect(isProtectedPath("/worker")).toBe(true);
    expect(isProtectedPath("/customer/orders")).toBe(true);
    // [任务 18] 商家端后台
    expect(isProtectedPath("/merchant-admin")).toBe(true);
    expect(isProtectedPath("/merchant-admin/orders")).toBe(true);
  });

  // # spec: 路由保护 — /login 即使满足前缀也排除（公开白名单）
  it("公开路径 → false（即使前缀匹配也排除）", () => {
    expect(isProtectedPath("/login")).toBe(false);
  });

  // # documents current behavior: 未列入的路径放行（白名单未覆盖 = 公开）
  it("未列入的路径 → false（放行）", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/random")).toBe(false);
  });

  // # spec: 路由保护 — /login 子路径（/login/oauth 等）也放行（公共路径前缀）
  it("/login/ 子路径也放行（PUBLIC_PATHS 包含 /login）", () => {
    expect(isProtectedPath("/login/oauth")).toBe(false);
  });
});

// # spec: canAccess 业务规则 = 各角色可访问的路径前缀；admin 能进后台、worker 只能进 /worker、customer 只能进 /customer
describe("canAccess", () => {
  const cases: Array<[Role, string, boolean]> = [
    // admin
    ["admin", "/dashboard", true],
    ["admin", "/orders", true],
    ["admin", "/services", true],
    ["admin", "/masters", true],
    ["admin", "/platform-areas", true],
    ["admin", "/platform-areas/new", true],
    ["admin", "/merchants", true],
    ["admin", "/merchants/new", true],
    ["admin", "/commission-strategies", true],
    ["admin", "/commission-strategies/new", true],
    ["admin", "/settlements", true],
    ["admin", "/merchant-settlements", true],
    ["admin", "/payout-records", true], // [任务 12] 打款记录
    ["admin", "/withdraw-requests", true], // [任务 13] 提现申请
    ["admin", "/master-withdraw-requests", true], // [任务 T2-1] 师傅提现申请
    ["admin", "/finance-ledgers", true], // [任务 14] 财务流水
    ["admin", "/dispatch-rules", true],
    ["admin", "/activity-logs", true],
    ["admin", "/merchant-admin", true], // [任务 18] admin 也能看
    ["admin", "/worker", false], // 越权
    ["admin", "/customer/orders", false],
    // worker
    ["worker", "/worker", true],
    ["worker", "/worker/orders/abc", true],
    ["worker", "/dashboard", false], // 越权
    ["worker", "/payout-records", false], // [任务 12] 越权
    ["worker", "/withdraw-requests", false], // [任务 13] 越权
    ["worker", "/master-withdraw-requests", true], // [任务 T2-1] 师傅可看自己申请
    ["worker", "/finance-ledgers", false], // [任务 14] 越权
    ["worker", "/merchant-admin", false], // [任务 18] 越权
    ["worker", "/customer/orders", false],
    // customer
    ["customer", "/customer", true],
    ["customer", "/customer/orders", true],
    ["customer", "/dashboard", false],
    ["customer", "/worker", false],
    ["customer", "/merchant-admin", false], // [任务 18] 越权
    // [任务 18] merchant 角色 — 只允许 /merchant-admin
    ["merchant", "/merchant-admin", true],
    ["merchant", "/merchant-admin/orders", true],
    ["merchant", "/merchant-admin/masters", true],
    ["merchant", "/dashboard", false], // 越权
    ["merchant", "/orders", false],
    ["merchant", "/masters", false],
    ["merchant", "/withdraw-requests", false],
    ["merchant", "/worker", false],
    ["merchant", "/customer/orders", false],
  ];
  for (const [role, path, expected] of cases) {
    // # spec: 权限矩阵 — role 对 path 应等于 expected（上面表格定义）
    it(`${role} → ${path} → ${expected}`, () => {
      expect(canAccess(role, path)).toBe(expected);
    });
  }
});

// # spec: authenticate 业务规则 = 查 User 表，匹配 name 或 phone + 明文密码；返回用户对象或 null
describe("authenticate", () => {
  // 重置用户（测试隔离）
  beforeEach(async () => {
    // 保留 seed 创建的测试账号（admin + 4 worker + 2 customer + 2 merchant）
    await prisma.user.deleteMany({
      where: {
        name: { notIn: ["admin", "worker1", "customer1", "merchant1"] },
      },
    });
  });

  // # spec: 账号密码比对 — admin/admin123 通过（seed 创建）
  it("admin / admin123 → 返回用户对象", async () => {
    const u = await authenticate("admin", "admin123");
    expect(u).not.toBeNull();
    expect(u?.role).toBe("admin");
    expect(u?.name).toBe("admin");
  });

  // # spec: 账号密码比对 — 支持手机号登录（演示便利）
  it("用手机号登录 → 返回用户对象", async () => {
    const u = await authenticate("13900000099", "customer123");
    expect(u?.role).toBe("customer");
    expect(u?.name).toBe("customer1");
  });

  // # spec: 密码错误 → null（不抛错）
  it("密码错 → null", async () => {
    expect(await authenticate("admin", "wrong")).toBeNull();
  });

  // # documents current behavior: 不存在的账号 → null（不抛错）
  it("账号不存在 → null", async () => {
    expect(await authenticate("nobody", "x")).toBeNull();
  });

  // # spec: worker 账号登录 → workerId 绑定到 Master.id
  it("worker1 登录 → 返回 workerId", async () => {
    const u = await authenticate("worker1", "worker123");
    expect(u?.role).toBe("worker");
    expect(u?.workerId).toBeTruthy();
  });

  // # spec: merchant 账号登录 → merchantId 绑定到 Merchant.id
  it("merchant1 登录 → 返回 merchantId", async () => {
    const u = await authenticate("merchant1", "merchant123");
    expect(u?.role).toBe("merchant");
    expect(u?.merchantId).toBeTruthy();
    expect(u?.workerId).toBeNull();
  });
});
