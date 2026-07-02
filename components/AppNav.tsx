"use client";

// 统一导航：[任务 15] 顶部 header（Logo + Dashboard 总览 + 退出）
//
// 视觉层级：
// - 顶部 56px：Logo + Dashboard 总览 + 退出
// - 左侧 sidebar：在 AdminShell 里渲染（与本组件解耦，layout 决定布局）
// - 已登录时显示「退出」按钮（form action 调 logoutAction）

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";

export function AppNav({
  isLoggedIn,
  csrfToken,
}: {
  isLoggedIn: boolean;
  /** RSC 阶段通过 ensureCsrfCookie 写入 cookie 的 token — [v0.7.3] 修 logout CSRF */
  csrfToken: string;
}) {
  const pathname = usePathname() ?? "";

  // /worker 是师傅端 H5，/customer 是用户端 H5，/ 是三端入口 landing —
  // 都不该继承后台导航（这些路径没有「后台管理」概念）
  if (
    pathname === "/" ||
    pathname.startsWith("/worker") ||
    pathname.startsWith("/customer")
  ) {
    return null;
  }

  const isDashboard = pathname.startsWith("/dashboard");

  return (
    <nav
      data-testid="appnav-header"
      style={{
        height: 56,
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        padding: "0 32px",
        gap: 16,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <Link
        href="/dashboard"
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "#111827",
          textDecoration: "none",
          marginRight: 8,
        }}
      >
        O2O 管理后台
      </Link>

      {/* Dashboard 总览独立入口 */}
      <Link
        href="/dashboard"
        data-testid="appnav-dashboard"
        data-active={isDashboard ? "1" : "0"}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          fontSize: 14,
          color: isDashboard ? "#2563eb" : "#374151",
          background: isDashboard ? "#eff6ff" : "transparent",
          textDecoration: "none",
          fontWeight: isDashboard ? 600 : 400,
        }}
      >
        总览
      </Link>

      {/* 退出按钮 — 已登录时显示 */}
      {isLoggedIn && (
        <form action={logoutAction} style={{ marginLeft: "auto" }}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            style={{
              padding: "6px 14px",
              background: "transparent",
              color: "#b91c1c",
              border: "1px solid #fca5a5",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            退出
          </button>
        </form>
      )}
    </nav>
  );
}
