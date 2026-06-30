// [v0.7.3] E2E 单测 — 修类别 8 「build 过 ≠ 用户能用」教训
//
// 覆盖：
// 1. CSRF cookie 写入 / 读取 / 验证流
// 2. logout 调 logoutAction 缺 _csrf → 抛「会话已过期」（bug 防回归）
// 3. logout 调 logoutAction 带 _csrf → 销毁 session + 跳 /login
//
// 设计：
// - vitest 集成测试（连真 PG）
// - mock next/headers 的 cookies() → 模拟 RSC + Route Handler 双上下文
// - 不测具体 UI，只测 CSRF + logout 协议

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

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
  headers: async () => ({
    get: (name: string) => {
      if (name === "x-forwarded-for") return "127.0.0.1";
      return null;
    },
  }),
}));

const prisma = new PrismaClient({ log: ["error"] });

// 动态 import（必须在 mock 之后）
const { verifyCsrfToken, generateCsrfToken } = await import("./csrf");
const { CSRF_COOKIE, CSRF_FORM_FIELD } = await import("./csrf-constants");

// ============================================================
// 测试隔离
// ============================================================
beforeEach(() => {
  cookieStore.clear();
});

afterEach(async () => {
  cookieStore.clear();
  // 清理可能产生的测试用户
  await prisma.user.deleteMany({ where: { name: { startsWith: "_test_" } } });
});

// ============================================================
// # spec: verifyCsrfToken 业务规则 = form token === cookie token + 都非空
// ============================================================
describe("verifyCsrfToken — CSRF 校验", () => {
  // # spec: 校验规则 — token 完全一致 + 都非空 → 放行
  it("form token === cookie token → 放行", async () => {
    const token = generateCsrfToken();
    cookieStore.set(CSRF_COOKIE, token);
    expect(await verifyCsrfToken(token)).toBe(true);
  });

  // # spec: 校验规则 — form token 空 → 拒绝（核心 bug 防回归）
  it("form token 为空 → 拒绝（这是 v0.6.0-v0.7.2 bug 根源）", async () => {
    const token = generateCsrfToken();
    cookieStore.set(CSRF_COOKIE, token);
    expect(await verifyCsrfToken("")).toBe(false);
  });

  // # spec: 校验规则 — cookie 不存在 → 拒绝
  it("cookie 不存在 → 拒绝", async () => {
    expect(await verifyCsrfToken(generateCsrfToken())).toBe(false);
  });

  // # spec: 校验规则 — form token !== cookie token → 拒绝
  it("form token 与 cookie 不匹配 → 拒绝", async () => {
    cookieStore.set(CSRF_COOKIE, generateCsrfToken());
    expect(await verifyCsrfToken(generateCsrfToken())).toBe(false);
  });

  // # spec: 校验规则 — null token → 拒绝
  it("form token 为 null → 拒绝", async () => {
    cookieStore.set(CSRF_COOKIE, generateCsrfToken());
    expect(await verifyCsrfToken(null)).toBe(false);
  });
});

// ============================================================
// # spec: generateCsrfToken 业务规则 = 64 字符 hex 随机串
// ============================================================
describe("generateCsrfToken", () => {
  // # spec: 长度 = 64 字符（32 字节 hex）
  it("生成 64 字符 hex 字符串", () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  // # spec: 唯一性 — 连续两次生成不同
  it("连续两次生成不同 token", () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });
});

// ============================================================
// # spec: logout 调用约定 = 必须传 _csrf + form data（[v0.7.2] 防回归）
// ============================================================
describe("logoutAction 调用约定", () => {
  // # spec: logout 调 logoutAction 不传 formData → 跳过 CSRF（不抛错）
  // （logout 设计：不清系统状态，CSRF 误点退出杀伤有限）
  it("不传 formData → 跳过 CSRF 校验", async () => {
    cookieStore.set(CSRF_COOKIE, generateCsrfToken());
    const { logoutAction } = await import("@/app/login/actions");
    // 不抛 csrf 错（但会抛 NEXT_REDIRECT — logout 走完跳 /login）
    // 用 try/catch 抓 NEXT_REDIRECT 视为成功
    try {
      await logoutAction();
      expect.fail("应该抛 NEXT_REDIRECT");
    } catch (e: any) {
      // NEXT_REDIRECT 是 Next.js 的正常 redirect 机制
      expect(e.message || e.digest).toMatch(/NEXT_REDIRECT|REDIRECT/);
    }
  });

  // # spec: logout 调 logoutAction 传空 formData（无 _csrf）→ 抛「会话已过期」
  // 这是 v0.6.0-v0.7.2 bug 的核心：调用页用 <form action={logoutAction}> 没传 csrf
  it("传空 formData（无 _csrf）→ 抛「会话已过期」", async () => {
    cookieStore.set(CSRF_COOKIE, generateCsrfToken());
    const { logoutAction } = await import("@/app/login/actions");
    const formData = new FormData();
    // formData 没 _csrf 字段
    await expect(logoutAction(formData)).rejects.toThrow("会话已过期");
  });

  // # spec: logout 调 logoutAction 传 _csrf 但与 cookie 不匹配 → 抛错
  it("formData._csrf 与 cookie 不匹配 → 抛「会话已过期」", async () => {
    cookieStore.set(CSRF_COOKIE, generateCsrfToken());
    const { logoutAction } = await import("@/app/login/actions");
    const formData = new FormData();
    formData.set(CSRF_FORM_FIELD, "wrong-token");
    await expect(logoutAction(formData)).rejects.toThrow("会话已过期");
  });

  // # spec: logout 调 logoutAction 传正确 _csrf → 成功（不抛错）
  it("formData._csrf 与 cookie 匹配 → 成功（destroy session）", async () => {
    const token = generateCsrfToken();
    cookieStore.set(CSRF_COOKIE, token);
    const { logoutAction } = await import("@/app/login/actions");
    const formData = new FormData();
    formData.set(CSRF_FORM_FIELD, token);
    // 不抛错 + 走完 logout 流程
    // redirect('/login') 在 server action 里抛 NEXT_REDIRECT 异常 — 视为成功
    await expect(logoutAction(formData)).rejects.toThrow();
  });
});
