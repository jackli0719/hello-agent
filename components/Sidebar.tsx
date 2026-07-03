"use client";

// [任务 15] 侧边栏导航 — 4 大领域分组 + 折叠 + 子项 ✓ 高亮
//
// 设计：
// - 4 组：业务运营 / 商家 / 财务 / 系统
// - 顶部 header 仍保留总览 Dashboard 独立入口（与 sidebar 并列）
// - 折叠态：230px ↔ 56px（图标条）
// - 状态持久化：localStorage `sidebar-collapsed`（SSR 不读，避免 hydration mismatch）
// - 当前页匹配：使用 usePathname startsWith，子项前缀 ✓
// - 1024px 以下：未做断点隐藏；AdminShell 对所有 admin 路径总是渲染 sidebar（已知遗留）
//
// 视觉层级：
// - 父级（组标题）：左侧 3px 蓝条 + 文字 13px 600，hover #f1f3f5，active 浅蓝填充
// - 子项：文字 13px 500 + paddingLeft 32px，hover #f1f3f5，active 实色 #2563eb 填充 + 白字 + 圆角 6px
// - 折叠态：只显示图标（emoji 占位），active 实色填充图标
// - 整体：背景 #f8f9fb（与主体 #f7f8fa 一致），边框 #dee2e6（Notion / Lark 风）
// - 圆角：父级 0 / 子项 6px / 折叠按钮 6px
//
// 决策回报（P2-3）：
// - 我决定不做什么：
//   - 不做权限分组（admin 全可见）
//   - 不做暗黑模式
//   - 不做 mobile sidebar drawer
//   - 不做 1024px 以下断点隐藏 / 折叠：当前 AdminShell 对所有 admin 路径总是渲染 sidebar，
//     1024px 以下页面会出现横向滚动条（已知遗留，记入 docs/KNOWN_ISSUES.md）
// - 风险：1024px 以下未优化（与上一条对齐）；视觉抽查未跑（dev server 未起），逻辑靠 Sidebar.test 覆盖
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
        background: "#f8f9fb",
        borderRight: "1px solid #dee2e6",
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
          padding: collapsed ? "12px 0" : "10px 12px",
          margin: collapsed ? 0 : "8px 8px",
          width: collapsed ? "100%" : "calc(100% - 16px)",
          background: "transparent",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          color: "#6b7280",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 6,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "#eef0f3";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
        }}
      >
        <span style={{ fontSize: 14 }}>{collapsed ? "»" : "«"}</span>
        {!collapsed && <span>折叠</span>}
      </button>

      {/* 4 组 */}
      <nav style={{ padding: "4px 8px" }}>
        {SIDEBAR_GROUPS.map((g) => {
          const isOpen = openGroups.has(g.key) || collapsed; // 折叠态强制展开（否则看不到）
          const isActiveGroup = activeGroup === g.key;
          return (
            <div key={g.key} style={{ marginBottom: 4 }}>
              {/* 父级 */}
              <button
                type="button"
                onClick={() => !collapsed && toggleGroup(g.key)}
                onMouseEnter={(e) => {
                  if (!isActiveGroup)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "#f1f3f5";
                }}
                onMouseLeave={(e) => {
                  if (!isActiveGroup)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                }}
                data-testid={`group-${g.key}`}
                data-active={isActiveGroup ? "1" : "0"}
                title={collapsed ? g.label : undefined}
                style={{
                  width: "100%",
                  padding: collapsed ? "8px 0" : "9px 12px",
                  margin: collapsed ? 0 : "2px 0",
                  background: isActiveGroup ? "#e7f1ff" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: collapsed ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: 10,
                  fontSize: 13,
                  fontWeight: isActiveGroup ? 600 : 500,
                  color: isActiveGroup ? "#1e40af" : "#1f2937",
                  letterSpacing: "0.01em",
                  transition: "background 0.15s",
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1 }}>{g.icon}</span>
                {!collapsed && <span>{g.label}</span>}
                {!collapsed && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 9,
                      color: isActiveGroup ? "#1e40af" : "#9ca3af",
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
                      <li key={it.key} style={{ padding: "1px 0" }}>
                        <Link
                          href={it.href}
                          data-testid={`item-${it.key}`}
                          data-active={active ? "1" : "0"}
                          title={collapsed ? it.label : undefined}
                          onMouseEnter={(e) => {
                            if (!active)
                              (
                                e.currentTarget as HTMLAnchorElement
                              ).style.background = "#f1f3f5";
                          }}
                          onMouseLeave={(e) => {
                            if (!active)
                              (
                                e.currentTarget as HTMLAnchorElement
                              ).style.background = "transparent";
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: collapsed ? "8px 0" : "7px 12px 7px 36px",
                            justifyContent: collapsed ? "center" : "flex-start",
                            margin: collapsed ? 0 : "1px 0",
                            background: active ? "#2563eb" : "transparent",
                            color: active ? "#fff" : "#4b5563",
                            fontSize: 13,
                            fontWeight: active ? 600 : 500,
                            textDecoration: "none",
                            borderRadius: 6,
                            letterSpacing: "0.01em",
                            transition: "background 0.15s, color 0.15s",
                          }}
                        >
                          {collapsed ? (
                            <span style={{ fontSize: 15, lineHeight: 1 }}>
                              {it.icon}
                            </span>
                          ) : (
                            <>
                              <span style={{ fontSize: 15, lineHeight: 1 }}>
                                {it.icon}
                              </span>
                              <span style={{ flex: 1 }}>{it.label}</span>
                              {active && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    opacity: 0.9,
                                  }}
                                >
                                  ✓
                                </span>
                              )}
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
