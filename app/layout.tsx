import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import { isAuthenticated } from "@/src/lib/auth";

export const metadata: Metadata = {
  title: "O2O 管理后台 MVP",
  description: "O2O 上门服务管理后台最小可运行版本",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const loggedIn = await isAuthenticated();
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f7f8fa", minHeight: "100vh" }}>
        {/* AppNav 放 layout 里 — 所有页面自动有导航。
            传 isLoggedIn 让导航栏决定是否显示「退出」按钮。 */}
        <AppNav isLoggedIn={loggedIn} />
        {children}
      </body>
    </html>
  );
}