"use client";

// [任务 15] 侧边栏导航 — 4 大领域分组 + 折叠 + 子项 ✓ 高亮
//
// 设计：
// - 4 组：业务运营 / 商家 / 财务 / 系统
// - 顶部 header 仍保留总览 Dashboard 独立入口（与 sidebar 并列）
// - 折叠态：230px ↔ 56px（图标条）
// - 状态持久化：localStorage `sidebar-collapsed`（SSR 不读，避免 hydration mismatch）
// - 当前页匹配：使用 usePathname startsWith，子项前缀 ✓
// - 小屏（< 1024px）：自动隐藏，回退到顶部横排由 AppNav 处理
//
// 视觉层级：
// - 父级（组标题）：左侧 8px 蓝条 + 文字 13px 600
// - 子项：文字 13px 400 + paddingLeft 32px，✓ 时蓝字
// - 折叠态：只显示图标（emoji 占位）
//
// 决策回报（P2-3）：
// - 我决定不做什么：不做权限分组（admin 全可见）/ 不做暗黑模式 / 不做 mobile sidebar drawer
// - 风险：1024px 以下未优化；视觉抽查未跑（dev server 未起），逻辑靠 Sidebar.test 覆盖
// - 路径匹配改用 `pathname === href || pathname.startsWith(href + "/")`：修复老 startsWith 把
//   /merchant-settlements 误命中 /merchants 的潜在 bug

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type SidebarGroup = {
  key: string;
  label: string;
  /** 折叠态图标（emoji 即可，避免引图标库） */
  icon: string;
  items: { key: string; label: string; href: string; icon: string }[];
};

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    key: "operations",
    label: "业务运营",
    icon: "⚙️",
    items: [
      { key: "orders", label: "订单管理", href: "/orders", icon: "📋" },
      { key: "services", label: "服务管理", href: "/services", icon: "🛠" },
      { key: "masters", label: "师傅管理", href: "/masters", icon: "👷" },
      {
        key: "dispatch-rules",
        label: "派单规则",
        href: "/dispatch-rules",
        icon: "🎯",
      },
      {
        key: "platform-areas",
        label: "平台合作区域",
        href: "/platform-areas",
        icon: "🗺",
      },
    ],
  },
  {
    key: "merchant",
    label: "商家",
    icon: "🏪",
    items: [
      {
        key: "merchants",
        label: "商家管理",
        href: "/merchants",
        icon: "🏬",
      },
      {
        key: "commission-strategies",
        label: "分成策略",
        href: "/commission-strategies",
        icon: "💰",
      },
    ],
  },
  {
    key: "finance",
    label: "财务",
    icon: "💳",
    items: [
      {
        key: "settlements",
        label: "结算预览",
        href: "/settlements",
        icon: "🧮",
      },
      {
        key: "merchant-settlements",
        label: "商家结算汇总",
        href: "/merchant-settlements",
        icon: "📊",
      },
      {
        key: "payout-records",
        label: "打款记录",
        href: "/payout-records",
        icon: "💵",
      },
      {
        key: "withdraw-requests",
        label: "提现申请",
        href: "/withdraw-requests",
        icon: "🏧",
      },
      {
        key: "finance-ledgers",
        label: "财务流水",
        href: "/finance-ledgers",
        icon: "📜",
      },
    ],
  },
  {
    key: "system",
    label: "系统",
    icon: "🔧",
    items: [
      { key: "metrics", label: "业务指标", href: "/admin/metrics", icon: "📈" },
      {
        key: "activity-logs",
        label: "操作日志",
        href: "/activity-logs",
        icon: "📝",
      },
    ],
  },
];

export function detectActiveGroup(pathname: string): string | undefined {
  for (const g of SIDEBAR_GROUPS) {
    if (
      g.items.some((it) =>
        it.href === "/admin/metrics"
          ? pathname.startsWith("/admin")
          : pathname.startsWith(it.href + "/") || pathname === it.href,
      )
    ) {
      return g.key;
    }
  }
  return undefined;
}

export function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin/metrics") return pathname.startsWith("/admin");
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname() ?? "";
  const activeGroup = detectActiveGroup(pathname);

  // 折叠状态：默认展开「业务运营」组 + 整体展开 sidebar
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(["operations"]),
  );

  // 首次 mount 后读 localStorage 恢复折叠状态（避免 hydration mismatch）
  useEffect(() => {
    const stored = window.localStorage.getItem("sidebar-collapsed");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe 模式：useState 默认 false = SSR 一致，mount 后再从 localStorage 校正
    if (stored === "1") setCollapsed(true);
  }, []);

  // 切换折叠时写 localStorage
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const width = collapsed ? 56 : 230;

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed ? "1" : "0"}
      style={{
        width,
        minWidth: width,
        height: "calc(100vh - 56px)",
        position: "sticky",
        top: 56,
        background: "#fff",
        borderRight: "1px solid #e5e7eb",
        overflowY: "auto",
        overflowX: "hidden",
        transition: "width 0.18s ease",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      {/* 折叠按钮 */}
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        data-testid="sidebar-toggle"
        style={{
          width: "100%",
          padding: "10px 0",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid #f3f4f6",
          cursor: "pointer",
          color: "#6b7280",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-end",
          paddingRight: collapsed ? 0 : 12,
        }}
      >
        {collapsed ? "»" : "« 折叠"}
      </button>

      {/* 4 组 */}
      <nav style={{ padding: "8px 0" }}>
        {SIDEBAR_GROUPS.map((g) => {
          const isOpen = openGroups.has(g.key) || collapsed; // 折叠态强制展开（否则看不到）
          const isActiveGroup = activeGroup === g.key;
          return (
            <div key={g.key} style={{ marginBottom: 4 }}>
              {/* 父级 */}
              <button
                type="button"
                onClick={() => !collapsed && toggleGroup(g.key)}
                data-testid={`group-${g.key}`}
                data-active={isActiveGroup ? "1" : "0"}
                title={collapsed ? g.label : undefined}
                style={{
                  width: "100%",
                  padding: collapsed ? "8px 0" : "8px 12px",
                  background: isActiveGroup ? "#eff6ff" : "transparent",
                  border: "none",
                  borderLeft: isActiveGroup
                    ? "3px solid #2563eb"
                    : "3px solid transparent",
                  cursor: collapsed ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: isActiveGroup ? 600 : 500,
                  color: isActiveGroup ? "#1e40af" : "#374151",
                }}
              >
                <span style={{ fontSize: 16 }}>{g.icon}</span>
                {!collapsed && <span>{g.label}</span>}
                {!collapsed && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "#9ca3af",
                      transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                    }}
                  >
                    ▶
                  </span>
                )}
              </button>

              {/* 子项 */}
              {isOpen && (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                  }}
                >
                  {g.items.map((it) => {
                    const active = isItemActive(pathname, it.href);
                    return (
                      <li key={it.key}>
                        <Link
                          href={it.href}
                          data-testid={`item-${it.key}`}
                          data-active={active ? "1" : "0"}
                          title={collapsed ? it.label : undefined}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: collapsed ? "8px 0" : "7px 12px 7px 32px",
                            justifyContent: collapsed ? "center" : "flex-start",
                            background: active ? "#eff6ff" : "transparent",
                            color: active ? "#2563eb" : "#4b5563",
                            fontSize: 13,
                            fontWeight: active ? 600 : 400,
                            textDecoration: "none",
                            borderLeft: active
                              ? "3px solid #2563eb"
                              : "3px solid transparent",
                          }}
                        >
                          {collapsed ? (
                            <span style={{ fontSize: 16 }}>{it.icon}</span>
                          ) : (
                            <>
                              {active && (
                                <span
                                  style={{
                                    color: "#2563eb",
                                    fontWeight: 700,
                                    fontSize: 11,
                                  }}
                                >
                                  ✓
                                </span>
                              )}
                              {!active && (
                                <span
                                  style={{
                                    color: "transparent",
                                    fontSize: 11,
                                  }}
                                >
                                  ·
                                </span>
                              )}
                              <span>{it.label}</span>
                            </>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
