// Middleware — 路由保护
// 1. 未登录访问 /dashboard 等受保护路径 → 302 redirect /login
// 2. 已登录访问 /login → 302 redirect /dashboard（避免看到登录页）
// 3. 静态资源 / API 路由放行（_next, favicon 等）
//
// 注意：P0-4 警示 — 之前踩过「写到 src/app/ 路径错」的坑，必须放根目录。

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isProtectedPath } from "@/src/lib/auth";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoggedIn = request.cookies.get(SESSION_COOKIE)?.value === "1";

  // 1. 受保护路径 + 未登录 → 跳 /login（带 next 跳回原页）
  if (isProtectedPath(pathname) && !isLoggedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. 已登录访问 /login → 跳 /dashboard
  if (pathname === "/login" && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // middleware 跑的范围：排除 _next/static/api/favicon
  matcher: ["/((?!_next/|api/|favicon\\.ico).*)"],
};