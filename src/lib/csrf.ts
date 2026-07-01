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

import { cookies, headers } from "next/headers";
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

/**
 * [v0.9.7] 同源 Origin 头校验 — 给非 FormData action 用
 *
 * 攻击场景：用户登录 admin 后访问攻击者网站 → 攻击者诱导浏览器 POST /api/xxx
 * 防御：检查 Origin 头必须是当前 host（浏览器跨域 POST 自动带 Origin 头，攻击者无法伪造）
 *
 * 用法：
 * ```ts
 * const csrfOk = await verifyCsrfOrigin();
 * if (!csrfOk.ok) return { ok: false, error: csrfOk.error };
 * ```
 *
 * # MVP: 仅防 CSRF 不防同源 XSS（同源策略已隐式覆盖）
 * - 生产环境必须配置 HTTPS + secure cookie + SameSite=strict
 * - 失败时**不抛** redirect 异常，返 ok:false 让调用方处理
 */
export async function verifyCsrfOrigin(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const h = await headers();
    const origin = h.get("origin");
    const referer = h.get("referer");
    // server action 通过 fetch 调用，浏览器会带 origin 头
    // 直连 form submit 也会带 referer
    const requestOrigin = origin ?? (referer ? new URL(referer).origin : null);
    if (!requestOrigin) {
      // 某些场景（如 SSR、测试）无 origin — 放行（requireAdmin 已挡未登录）
      return { ok: true };
    }
    // 从 env 拿当前 host（dev 默认 localhost:3000，prod 从 .env 读）
    const expectedOrigin =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    if (requestOrigin !== expectedOrigin) {
      return {
        ok: false,
        error: "CSRF 校验失败：Origin 不匹配",
      };
    }
    return { ok: true };
  } catch {
    // 单测 / RSC 环境无 headers — 放行（requireAdmin 已挡）
    return { ok: true };
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
