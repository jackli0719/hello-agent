// auth.ts 业务逻辑层测试 — 不连 DB，不依赖 Next runtime。
// 覆盖 checkCredentials + isProtectedPath 两个纯函数。

import { describe, expect, it } from "vitest";
import { checkCredentials, isProtectedPath } from "./auth";

// # spec: checkCredentials 业务规则 = 管理员登录账号密码比对（演示版硬编码 admin/admin123），不能放宽
describe("checkCredentials", () => {
  // # spec: 管理员登录 — 正确账号密码比对通过（演示版硬编码 admin/admin123）
  it("正确账号密码 → true", () => {
    expect(checkCredentials("admin", "admin123")).toBe(true);
  });

  // # spec: 管理员登录 — 密码错拒绝（不区分大小写，不放宽）
  it("错误密码 → false", () => {
    expect(checkCredentials("admin", "wrong")).toBe(false);
  });

  // # spec: 管理员登录 — 用户名错拒绝（区分大小写，不接受 root 等）
  it("错误用户名 → false", () => {
    expect(checkCredentials("root", "admin123")).toBe(false);
  });

  // # documents current behavior: 空账号空密码拒绝（防御性判空，不抛错）
  it("空字符串 → false", () => {
    expect(checkCredentials("", "")).toBe(false);
  });
});

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
    expect(isProtectedPath("/dispatch-rules")).toBe(true);
    expect(isProtectedPath("/dispatch-rules/new")).toBe(true);
  });

  // # spec: 路由保护 — /login 即使满足前缀也排除（公开白名单）
  it("公开路径 → false（即使前缀匹配也排除）", async () => {
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
