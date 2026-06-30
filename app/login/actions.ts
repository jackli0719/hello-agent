"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEFAULT_LANDING,
  authenticate,
  canAccess,
  getSession,
  type Role,
} from "@/src/lib/auth";
import {
  clearAttempts,
  getClientIp,
  isLocked,
  recordFailure,
} from "@/src/lib/login-rate-limit";
import { CSRF_COOKIE, CSRF_FORM_FIELD, verifyCsrfToken } from "@/src/lib/csrf";

export type LoginActionResult =
  { ok: true; next: string } | { ok: false; error: string };

/**
 * 登录 server action — 校验账号密码 + 设 cookie + 跳目标页。
 *
 * 接收 form data: { account, password, next?, _csrf }
 *  - account: 用户名或手机号
 *  - password: 明文（按需求 — MVP）
 *  - next: 可选 — 客户端传回的「原本想访问的页面」
 *  - _csrf: CSRF token（v0.6.0）
 *
 * 成功 → 设 cookie + redirect
 * 失败 → 返回 error 给 UI 内联展示
 *
 * [v0.5.0] 登录限流（修 ADR-013 A3 P0）
 * [v0.6.0] CSRF 校验（修 ADR-013 B6）
 * [v0.6.0] iron-session 签名 cookie（修 ADR-013 A2 P0）
 */
export async function loginAction(
  formData: FormData,
): Promise<LoginActionResult> {
  // [v0.6.0] CSRF 校验
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return { ok: false, error: "会话已过期，请刷新页面后重试" };
  }

  const account = String(formData.get("account") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "");

  if (!account || !password) {
    return { ok: false, error: "请输入账号和密码" };
  }

  // [v0.5.0] 登录限流
  const h = await headers();
  const ip = getClientIp(h);
  const lockState = isLocked(ip);
  if (lockState.locked) {
    const sec = Math.ceil(lockState.remainingMs / 1000);
    return {
      ok: false,
      error: `登录失败次数过多，请 ${sec} 秒后再试`,
    };
  }

  const user = await authenticate(account, password);
  if (!user) {
    const fail = recordFailure(ip);
    if (fail.locked) {
      return {
        ok: false,
        error: `登录失败次数过多，已锁定 60 秒`,
      };
    }
    return {
      ok: false,
      error:
        fail.attemptsLeft > 0
          ? `账号或密码错误（还剩 ${fail.attemptsLeft} 次）`
          : "账号或密码错误",
    };
  }

  // 成功 → 清零
  clearAttempts(ip);

  // 决定跳哪
  const role = user.role as Role;
  let target = nextParam || DEFAULT_LANDING[role];
  // [v0.6.0] B4 next 白名单
  if (nextParam) {
    if (!nextParam.startsWith("/") || nextParam.startsWith("//")) {
      target = DEFAULT_LANDING[role];
    } else if (!canAccess(role, nextParam)) {
      target = DEFAULT_LANDING[role];
    }
  }

  // [v0.6.0] iron-session 签名保存 userId + role
  const session = await getSession();
  session.userId = user.id;
  session.role = role;
  await session.save();

  return { ok: true, next: target };
}

/**
 * 登出 server action — 清 cookie + 跳 /login。
 * [v0.6.0] CSRF 校验（修 ADR-013 B6）
 * [v0.6.0] iron-session destroy（修 ADR-013 A2 P0）
 */
export async function logoutAction(formData?: FormData): Promise<void> {
  if (formData) {
    const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
    if (!(await verifyCsrfToken(csrfToken))) {
      throw new Error("会话已过期");
    }
  }
  const session = await getSession();
  session.destroy();
  // 也清 CSRF cookie
  const c = await cookies();
  c.delete(CSRF_COOKIE);
  redirect("/login");
}
