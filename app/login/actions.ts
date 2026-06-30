"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_OPTIONS,
  DEFAULT_LANDING,
  ROLE_COOKIE,
  SESSION_COOKIE,
  authenticate,
  canAccess,
  type Role,
} from "@/src/lib/auth";
import {
  clearAttempts,
  getClientIp,
  isLocked,
  recordFailure,
} from "@/src/lib/login-rate-limit";

export type LoginActionResult =
  { ok: true; next: string } | { ok: false; error: string };

/**
 * 登录 server action — 校验账号密码 + 设 cookie + 跳目标页。
 *
 * 接收 form data: { account, password, next? }
 *  - account: 用户名或手机号
 *  - password: 明文（按需求 — MVP）
 *  - next: 可选 — 客户端传回的「原本想访问的页面」
 *
 * 成功 → 设 cookie + redirect
 * 失败 → 返回 error 给 UI 内联展示
 *
 * [v0.5.0] 加登录限流（修 ADR-013 A3 P0 风险）：
 * - 同 IP 5 次/分钟失败 → 锁定 60 秒
 * - 成功登录 → 清零
 */
export async function loginAction(
  formData: FormData,
): Promise<LoginActionResult> {
  const account = String(formData.get("account") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "");

  if (!account || !password) {
    return { ok: false, error: "请输入账号和密码" };
  }

  // [v0.5.0] 登录限流 — 先检查是否锁
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
    // 记录失败
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
  // 安全校验：next 不能跨角色
  if (nextParam && !canAccess(role, nextParam)) {
    target = DEFAULT_LANDING[role];
  }

  // 设登录态 cookie
  const c = await cookies();
  c.set(SESSION_COOKIE, user.id, COOKIE_OPTIONS);
  c.set(ROLE_COOKIE, role, COOKIE_OPTIONS);

  // 返回 next（让 client router 跳转 — server action redirect 在 form action 里更稳，
  // 但返回 next 让 client 决定也行）
  return { ok: true, next: target };
}

/**
 * 登出 server action — 清 cookie + 跳 /login。
 */
export async function logoutAction(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  c.delete(ROLE_COOKIE);
  redirect("/login");
}
