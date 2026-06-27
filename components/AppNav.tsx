"use client";

// 统一导航：所有核心页面共用。
// 自动用 usePathname 判断 current — 调用方不用传 current。
// 已登录时显示「退出」按钮（form action 调 logoutAction）。

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";

type AppPage =
  | "dashboard"
  | "orders"
  | "services"
  | "masters"
  | "dispatch-rules"
  | "metrics";

const ITEMS: { key: AppPage; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "orders", label: "订单管理", href: "/orders" },
  { key: "services", label: "服务管理", href: "/services" },
  { key: "masters", label: "师傅管理", href: "/masters" },
  { key: "dispatch-rules", label: "派单规则", href: "/dispatch-rules" },
  { key: "metrics", label: "业务指标", href: "/admin/metrics" },
];

function detectCurrent(pathname: string): AppPage | undefined {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/orders")) return "orders";
  if (pathname.startsWith("/services")) return "services";
  if (pathname.startsWith("/masters")) return "masters";
  if (pathname.startsWith("/dispatch-rules")) return "dispatch-rules";
  if (pathname.startsWith("/admin")) return "metrics";
  return undefined;
}

export function AppNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  const pathname = usePathname() ?? "";

  // /worker 是师傅端 H5，/customer 是用户端 H5，/ 是三端入口 landing —
  // 都不该继承后台导航（这些路径没有「后台管理」概念，看到「订单管理 / 服务管理 / 师傅管理」会乱套）
  // 让这些路径自己渲染极简导航
  if (
    pathname === "/" ||
    pathname.startsWith("/worker") ||
    pathname.startsWith("/customer")
  ) {
    return null;
  }

  const current = detectCurrent(pathname);
  return (
    <nav
      style={{
        height: 56,
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        padding: "0 32px",
        gap: 8,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      <Link
        href="/dashboard"
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "#111827",
          textDecoration: "none",
          marginRight: 24,
        }}
      >
        O2O 管理后台
      </Link>
      {ITEMS.map((item) => {
        const active = current === item.key;
        return (
          <Link
            key={item.key}
            href={item.href}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 14,
              color: active ? "#2563eb" : "#374151",
              background: active ? "#eff6ff" : "transparent",
              textDecoration: "none",
              fontWeight: active ? 600 : 400,
            }}
          >
            {item.label}
          </Link>
        );
      })}
      {/* 退出按钮 — 已登录时显示，form action 调 logoutAction */}
      {isLoggedIn && (
        <form action={logoutAction} style={{ marginLeft: "auto" }}>
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
