// [v0.9.8] csrf.ts 单测 — 补 verifyCsrfOrigin
//
// 覆盖：
// 1. 同源 Origin → 放行
// 2. 跨源 Origin → 拒
// 3. 无 origin header（fallback 到 referer）→ 放行（SSR/RSC）
// 4. 无 origin / 无 referer → 放行（requireAdmin 已挡未登录）

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();
const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
  headers: async () => {
    const m = new Map<string, string>();
    for (const [k, v] of headerStore) m.set(k.toLowerCase(), v);
    return {
      get: (name: string) => m.get(name.toLowerCase()) ?? null,
    };
  },
}));

const { verifyCsrfOrigin } = await import("./csrf");

beforeEach(() => {
  cookieStore.clear();
  headerStore.clear();
});

afterEach(() => {
  cookieStore.clear();
  headerStore.clear();
});

describe("verifyCsrfOrigin", () => {
  // # spec: 同源 Origin → 放行
  it("同源 Origin（localhost:3000）→ 放行", async () => {
    headerStore.set("origin", "http://localhost:3000");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const r = await verifyCsrfOrigin();
    expect(r.ok).toBe(true);
  });

  // # spec: 跨源 Origin → 拒绝（防 CSRF 攻击）
  it("跨源 Origin（attacker.com）→ 拒绝", async () => {
    headerStore.set("origin", "https://attacker.com");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const r = await verifyCsrfOrigin();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/CSRF 校验失败/);
  });

  // # spec: 无 origin 但有 referer → 走 referer 校验
  it("无 origin + 同源 referer → 放行", async () => {
    headerStore.set("referer", "http://localhost:3000/admin/orders");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const r = await verifyCsrfOrigin();
    expect(r.ok).toBe(true);
  });

  // # spec: 无 origin + 跨域 referer → 拒绝
  it("无 origin + 跨域 referer → 拒绝", async () => {
    headerStore.set("referer", "https://attacker.com/fake");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const r = await verifyCsrfOrigin();
    expect(r.ok).toBe(false);
  });

  // # spec: 无 origin + 无 referer → 放行（SSR / RSC 环境，requireAdmin 已挡）
  it("无 origin + 无 referer → 放行", async () => {
    const r = await verifyCsrfOrigin();
    expect(r.ok).toBe(true);
  });
});
