// auth.ts 业务逻辑层测试 — 不连 DB，不依赖 Next runtime。
// 覆盖 checkCredentials + isProtectedPath 两个纯函数。

import { describe, expect, it } from "vitest";
import { checkCredentials, isProtectedPath } from "./auth";

// # spec: checkCredentials 业务规则 = 管理员登录账号密码比对（演示版硬编码 admin/admin123），不能放宽
describe("checkCredentials", () => {
  it("正确账号密码 → true", () => {
    expect(checkCredentials("admin", "admin123")).toBe(true);
  });

  it("错误密码 → false", () => {
    expect(checkCredentials("admin", "wrong")).toBe(false);
  });

  it("错误用户名 → false", () => {
    expect(checkCredentials("root", "admin123")).toBe(false);
  });

  it("空字符串 → false", () => {
    expect(checkCredentials("", "")).toBe(false);
  });
});

// # spec: 路由保护 = PROTECTED_PATHS 前缀命中、PUBLIC_PATHS 不命中；middleware 用此判断需登录
describe("isProtectedPath", () => {
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

  it("公开路径 → false（即使前缀匹配也排除）", () => {
    expect(isProtectedPath("/login")).toBe(false);
  });

  it("未列入的路径 → false（放行）", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/random")).toBe(false);
  });

  it("/login/ 子路径也放行（PUBLIC_PATHS 包含 /login）", () => {
    expect(isProtectedPath("/login/oauth")).toBe(false);
  });
});
