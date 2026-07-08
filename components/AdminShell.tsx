"use client";

// [任务 15] 管理后台外壳 — 把 sidebar + 主内容做水平 flex 布局
//
// 作用：让 sidebar 出现在主内容「左侧」而不是「上方」。
// 用法：layout 把 children 包到 <AdminShell>{children}</AdminShell>。
//
// 边界处理：worker / customer / root 路径不渲染 sidebar（与 AppNav 同步）。

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isAdminPath =
    pathname !== "/" &&
    !pathname.startsWith("/worker") &&
    !pathname.startsWith("/customer");

  if (!isAdminPath) {
    return <>{children}</>;
  }

  return (
    <div
      data-testid="admin-shell"
      style={{
        display: "flex",
        alignItems: "flex-start",
        minHeight: "calc(100vh - 56px)",
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
