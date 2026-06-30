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

/** 仅读 csrf cookie（RSC 可用，middleware 已写） — [v0.7.3] 修 RSC 写 cookie 报错 */
export async function readCsrfCookie(): Promise<string> {
  try {
    const c = await cookies();
    return c.get(CSRF_COOKIE)?.value ?? "";
  } catch {
    return "";
  }
}

/** 确保 client 有 CSRF token cookie（Route Handler / server action 可写；RSC 仅读）
 *
 * RSC 写 cookie 在 Next.js 15 报「Cookies can only be modified in a Server Action or Route Handler」。
 * 但 middleware 已经在 /login 路径写了 csrf cookie（v0.7.1 fix），所以 RSC 只需读。
 * 如果读不到（middleware 没跑过的路径），不写 — 下次 server action 触发时再由中间件写。
 */
export async function ensureCsrfCookie(): Promise<string> {
  return readCsrfCookie();
}
