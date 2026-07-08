import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import { isAuthenticated } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";

export const metadata: Metadata = {
  title: "O2O 管理后台 MVP",
  description: "O2O 上门服务管理后台最小可运行版本",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loggedIn, csrfToken] = await Promise.all([
    isAuthenticated(),
    ensureCsrfCookie(),
  ]);
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
        {/* AppNav 放 layout 里 — 所有页面自动有导航。
            传 isLoggedIn 让导航栏决定是否显示「退出」按钮；
            传 csrfToken 让 logout 表单能通过 CSRF 校验（[v0.7.3]）。 */}
        <AppNav isLoggedIn={loggedIn} csrfToken={csrfToken} />
        <div style={{ flex: 1 }}>{children}</div>
        {/* 全站演示版标识 — 演示者 / 观众一眼看到这是 demo 不是生产 */}
        <footer
          style={{
            textAlign: "center",
            padding: "12px 16px",
            color: "#9ca3af",
            fontSize: 11,
            borderTop: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          🎬 第一版 MVP 演示版 · 本地 SQLite · 生产需迁移 PostgreSQL
        </footer>
      </body>
    </html>
  );
}
