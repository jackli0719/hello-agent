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
  | "platform-areas"
  | "merchants"
  | "commission-strategies"
  | "settlements"
  | "merchant-settlements"
  | "dispatch-rules"
  | "metrics"
  | "activity-logs";

const ITEMS: { key: AppPage; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "orders", label: "订单管理", href: "/orders" },
  { key: "services", label: "服务管理", href: "/services" },
  { key: "masters", label: "师傅管理", href: "/masters" },
  { key: "platform-areas", label: "平台合作区域", href: "/platform-areas" },
  { key: "merchants", label: "商家管理", href: "/merchants" },
  {
    key: "commission-strategies",
    label: "分成策略",
    href: "/commission-strategies",
  }, // [任务 5]
  { key: "settlements", label: "结算预览", href: "/settlements" }, // [任务 6]
  {
    key: "merchant-settlements",
    label: "商家结算汇总",
    href: "/merchant-settlements",
  }, // [任务 7]
  { key: "dispatch-rules", label: "派单规则", href: "/dispatch-rules" },
  { key: "activity-logs", label: "操作日志", href: "/activity-logs" }, // [v0.8.0]
  { key: "metrics", label: "业务指标", href: "/admin/metrics" },
];

function detectCurrent(pathname: string): AppPage | undefined {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/orders")) return "orders";
  if (pathname.startsWith("/services")) return "services";
  if (pathname.startsWith("/masters")) return "masters";
  if (pathname.startsWith("/platform-areas")) return "platform-areas";
  if (pathname.startsWith("/merchants")) return "merchants";
  if (pathname.startsWith("/commission-strategies"))
    return "commission-strategies";
  if (pathname.startsWith("/settlements")) return "settlements";
  if (pathname.startsWith("/merchant-settlements"))
    return "merchant-settlements";
  if (pathname.startsWith("/dispatch-rules")) return "dispatch-rules";
  if (pathname.startsWith("/activity-logs")) return "activity-logs";
  if (pathname.startsWith("/admin")) return "metrics";
  return undefined;
}

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
          {/* [v0.7.3] CSRF token — layout RSC 阶段已写 cookie */}
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
