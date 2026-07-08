import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import { AdminShell } from "@/components/AdminShell";
import { isAuthenticated, getCurrentUser } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { countUnreadForUser } from "@/src/lib/notifications";

export const metadata: Metadata = {
  title: "O2O 管理后台 MVP",
  description: "O2O 上门服务管理后台最小可运行版本",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loggedIn, csrfToken, currentUser] = await Promise.all([
    isAuthenticated(),
    ensureCsrfCookie(),
    getCurrentUser(),
  ]);
  // [任务 19] 通知未读数（仅登录用户查；未登录=0；admin 看 ActivityLog 不发通知 → 也是 0）
  // 演示期：admin 通知按用户决策不在站内发（看 ActivityLog），所以 admin 始终 0
  const unreadCount =
    currentUser && currentUser.role !== "admin"
      ? await countUnreadForUser(currentUser.id)
      : 0;
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          background: "#f7f8fa",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* AppNav 放 layout 里 — 所有页面自动有顶部导航。
            传 isLoggedIn 让导航栏决定是否显示「退出」按钮；
            传 csrfToken 让 logout 表单能通过 CSRF 校验（[v0.7.3]）；
            传 unreadCount 让 NotificationBell 显示红点 + 未读数（[任务 19]）。 */}
        <AppNav
          isLoggedIn={loggedIn}
          csrfToken={csrfToken}
          unreadCount={unreadCount}
        />
        {/* AdminShell：根据 pathname 自动加 sidebar（仅 admin 路径） */}
        <AdminShell>{children}</AdminShell>
        {/* 全站演示版标识 — 演示者 / 观众一眼看到这是 demo 不是生产 */}
        <footer
          style={{
            textAlign: "center",
            padding: "12px 16px",
            color: "#94a3b8",
            fontSize: 11,
            borderTop: "1px solid #dee2e6",
            background: "#fff",
            letterSpacing: "0.02em",
          }}
        >
          🎬 第一版 MVP 演示版 · 本地 SQLite · 生产需迁移 PostgreSQL
        </footer>
      </body>
    </html>
  );
}
