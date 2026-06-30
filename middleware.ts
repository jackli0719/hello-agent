// Middleware — [v0.6.0] iron-session 适配
// 1. 未登录访问受保护路径 → 302 redirect /login（带 next 跳回原页）
// 2. 已登录访问 /login → 302 redirect 到该角色默认页
// 3. 已登录访问无权路径 → 302 redirect 到该角色默认页
// 4. 静态资源 / API 路由放行（_next, favicon 等）
//
// [v0.6.0] iron-session 适配：
// - middleware 在 Edge runtime 跑，iron-session 8.x 支持但需要 secret
// - 简化：先看 cookie 存在性 + role（从 cookie 名知道是 iron-session）
// - 完整验证在 server action / RSC 里通过 getSession() 做
// - 这里不验签 = 仅做「粗粒度跳转」；详细校验靠 Next.js 页面层
//
// 注意：P0-4 警示 — 必须放根目录 middleware.ts，不放 src/。

import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LANDING,
  PUBLIC_PATHS,
  SESSION_COOKIE,
  canAccess,
  isProtectedPath,
  type Role,
} from "@/src/lib/auth";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // [v0.6.0] iron-session 模式下 cookie 是加密串 — 简单判断「存在 + 解析 role」
  // 真正解密验签在 server action / RSC 内 getSession() 做
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  // iron-session cookie 格式: "Fe26.2**base64**..." (Fe26 = v6+)
  const hasValidSessionCookie =
    !!sessionCookie && sessionCookie.startsWith("Fe26.");
  // 角色从 cookie 解析（演示简化：靠 getSession 在 RSC 里反查）
  // middleware 只做「有 cookie 就有登录态」的粗粒度判断
  const isLoggedIn = hasValidSessionCookie;
  // role 暂用 null — middleware 只判断登录态；越权跳页由 RSC 的 getCurrentUser 触发
  const role: Role | null = null;

  // 0. 公开路径 — 放行
  if (PUBLIC_PATHS.includes(pathname)) {
    if (pathname === "/login" && isLoggedIn) {
      // 已登录访问 /login — 跳默认页（role 不知，按 admin 兜底）
      return NextResponse.redirect(new URL(DEFAULT_LANDING.admin, request.url));
    }
    return NextResponse.next();
  }

  // 1. 受保护路径 + 未登录 → 跳 /login
  if (isProtectedPath(pathname) && !isLoggedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. 已登录但「越权」→ 中间件不判断（role 未知）；RSC 内 canAccess 校验
  //    这里只做兜底：如果有 role 且越权，跳默认页
  if (isLoggedIn && role && !canAccess(role, pathname)) {
    return NextResponse.redirect(new URL(DEFAULT_LANDING[role], request.url));
  }

  return NextResponse.next();
}

export const config = {
  // middleware 跑的范围：排除 _next/static/api/favicon
  matcher: ["/((?!_next/|api/|favicon\\.ico).*)"],
};
