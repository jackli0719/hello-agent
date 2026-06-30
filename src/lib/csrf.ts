// CSRF Token — [v0.6.0] 修 ADR-013 B6 P1 风险
//
// 模式：double submit cookie
// - 服务端生成 token → 写 httpOnly cookie + 返给 client
// - client 提交 form 时，token 放 form hidden input
// - server action 校验：form token === cookie token → 放行
//
// 优点：无状态（O(1) DB）、简单、符合 SameSite=lax 防御
// 缺点：每次打开页面都返 token（演示可接受）
//
// # MVP: 仅校验 server action POST；GET 不校验
// 不做（按需求 / 演示期）：
// - Origin 头校验（同源策略已隐式覆盖）
// - per-session token（演示期不必要）
//
// ⚠️ 此文件 import next/headers — 只能 server action / RSC 用
//    常量（CSRF_COOKIE / CSRF_FORM_FIELD）在 csrf-constants.ts，client 也可 import

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { CSRF_COOKIE, CSRF_FORM_FIELD } from "./csrf-constants";

export { CSRF_COOKIE, CSRF_FORM_FIELD };

/** 生成新 token（写 cookie + 返回 token 给 client） */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** 校验 form token === cookie token */
export async function verifyCsrfToken(
  formToken: string | null,
): Promise<boolean> {
  if (!formToken) return false;
  let c;
  try {
    c = await cookies();
  } catch {
    return false;
  }
  const cookieToken = c.get(CSRF_COOKIE)?.value;
  if (!cookieToken) return false;
  if (cookieToken.length !== formToken.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(formToken),
  );
}

/** 确保 client 有 CSRF token cookie（页面渲染前调） */
export async function ensureCsrfCookie(): Promise<string> {
  let c;
  try {
    c = await cookies();
  } catch {
    return "";
  }
  const existing = c.get(CSRF_COOKIE)?.value;
  if (existing) return existing;
  const token = generateCsrfToken();
  c.set(CSRF_COOKIE, token, {
    httpOnly: false, // 客户端 JS 要读
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return token;
}
