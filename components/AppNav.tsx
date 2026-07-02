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
        borderBottom: "1px solid #dee2e6",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 16,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        position: "sticky",
        top: 0,
        zIndex: 50,
        boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)",
      }}
    >
      <Link
        href="/dashboard"
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "#0f172a",
          textDecoration: "none",
          marginRight: 8,
          letterSpacing: "0.02em",
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
          fontSize: 13,
          color: isDashboard ? "#fff" : "#475569",
          background: isDashboard ? "#2563eb" : "transparent",
          textDecoration: "none",
          fontWeight: isDashboard ? 600 : 500,
          letterSpacing: "0.01em",
          transition: "background 0.15s, color 0.15s",
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
              color: "#64748b",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              letterSpacing: "0.01em",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "#fef2f2";
              el.style.color = "#b91c1c";
              el.style.borderColor = "#fca5a5";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "transparent";
              el.style.color = "#64748b";
              el.style.borderColor = "#cbd5e1";
            }}
          >
            退出
          </button>
        </form>
      )}
    </nav>
  );
}
