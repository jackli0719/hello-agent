// 登录保护 — MVP 阶段固定账号 + cookie session。
//
// 设计：
// - 固定账号：用户名 admin / 密码 admin123（需求里写明）
// - cookie 名：o2o_session = "1" 即登录态；不存在 = 未登录
// - httpOnly: 防 XSS 偷 cookie（不是 P0 但最小成本就加上）
// - secure: 注释里默认关（dev 跑 http），生产部署时按需打开
// - 30 天过期
//
// 不做（按需求）：
// - 不签名（无 cookie 篡改保护）— MVP 接受
// - 不做密码哈希（明文比对）— MVP 接受
// - 不做用户管理 / 注册 / 忘记密码 / 多角色

import { cookies } from "next/headers";

export const SESSION_COOKIE = "o2o_session";

// 固定管理员账号（按需求）
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

/** 校验账号密码 — 简单 string 比对 */
export function checkCredentials(username: string, password: string): boolean {
  return username === ADMIN_USER && password === ADMIN_PASS;
}

/** 服务端读 cookie 判断是否登录（用于 server component / middleware） */
export async function isAuthenticated(): Promise<boolean> {
  const c = await cookies();
  return c.get(SESSION_COOKIE)?.value === "1";
}

/** 登录态 cookie 配置（写 / 删） */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // dev 跑 http 不会自动加 secure；生产部署再加
  maxAge: 60 * 60 * 24 * 30, // 30 天
};

/** 受保护的路径前缀（middleware 用来判断哪些路径需要登录） */
export const PROTECTED_PATHS = [
  "/dashboard",
  "/orders",
  "/services",
  "/masters",
  "/dispatch-rules",
  "/admin",
];

/** 静态资源 / 内部路径 — middleware 必须放行（不重定向） */
export const PUBLIC_PATHS = ["/login"];

/** 是否受保护：路径是 PROTECTED_PATHS 任一前缀（但不是 PUBLIC） */
export function isProtectedPath(pathname: string): boolean {
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return false;
  }
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
