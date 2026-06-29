// Middleware — [账号阶段] 2026-06-29 升级为按角色权限
// 1. 未登录访问受保护路径 → 302 redirect /login（带 next 跳回原页）
// 2. 已登录访问 /login → 302 redirect 到该角色默认页
// 3. 已登录访问无权路径 → 302 redirect 到该角色默认页
// 4. 静态资源 / API 路由放行（_next, favicon 等）
//
// 注意：P0-4 警示 — 必须放根目录 middleware.ts，不放 src/。

import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LANDING,
  PUBLIC_PATHS,
  ROLE_COOKIE,
  SESSION_COOKIE,
  canAccess,
  isProtectedPath,
  type Role,
} from "@/src/lib/auth";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const userId = request.cookies.get(SESSION_COOKIE)?.value;
  const role = request.cookies.get(ROLE_COOKIE)?.value as Role | undefined;
  const isLoggedIn = !!userId && !!role;

  // 0. 公开路径 — 放行
  if (PUBLIC_PATHS.includes(pathname)) {
    // 已登录访问 /login → 跳默认页
    if (pathname === "/login" && isLoggedIn && role) {
      return NextResponse.redirect(new URL(DEFAULT_LANDING[role], request.url));
    }
    return NextResponse.next();
  }

  // 1. 受保护路径 + 未登录 → 跳 /login
  if (isProtectedPath(pathname) && !isLoggedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. 受保护路径 + 已登录 + 角色越权 → 跳该角色默认页
  if (isLoggedIn && role && !canAccess(role, pathname)) {
    return NextResponse.redirect(new URL(DEFAULT_LANDING[role], request.url));
  }

  return NextResponse.next();
}

export const config = {
  // middleware 跑的范围：排除 _next/static/api/favicon
  matcher: ["/((?!_next/|api/|favicon\\.ico).*)"],
};
