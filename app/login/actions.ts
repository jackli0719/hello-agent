"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_OPTIONS, SESSION_COOKIE, checkCredentials } from "@/src/lib/auth";

export type LoginActionResult =
  | { ok: true; next: string }
  | { ok: false; error: string };

/**
 * 登录 server action — 校验账号密码 + 设 cookie + 跳目标页。
 *
 * 接收 form data: { username, password, next? }（client 传 next）
 * 成功 → 设 cookie + redirect 到 next（默认 /dashboard）
 * 失败 → 返回 error 给 UI 内联展示
 */
export async function loginAction(formData: FormData): Promise<LoginActionResult> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!checkCredentials(username, password)) {
    return { ok: false, error: "账号或密码错误" };
  }

  // 设登录态 cookie — httpOnly 防 XSS 读
  const c = await cookies();
  c.set(SESSION_COOKIE, "1", COOKIE_OPTIONS);

  // server action redirect 跳目标页
  redirect(next);
}

/**
 * 登出 server action — 清 cookie + 跳 /login。
 */
export async function logoutAction(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  redirect("/login");
}