"use client";

// [任务 19] 通知铃铛 — header 右上角铃铛 + 未读红点
//
// 设计：
// - RSC 阶段由 layout 读 unreadCount 注入 prop（避免额外 API 路由）
// - 点开 → 跳 /notifications 列表页（不做弹出层；MVP 简单）
// - 红点：unreadCount > 0 时显示数字（>99 显示 "99+"）

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname() ?? "";
  const isActive = pathname === "/notifications";
  const displayCount = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <Link
      href="/notifications"
      data-testid="notification-bell"
      data-unread={unreadCount}
      title={unreadCount > 0 ? `${unreadCount} 条未读通知` : "通知"}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 6,
        fontSize: 16,
        color: isActive ? "#fff" : "#475569",
        background: isActive ? "#2563eb" : "transparent",
        textDecoration: "none",
        marginLeft: 4,
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {/* 铃铛 emoji — 演示期替代图标字体（避免引入 lucide / heroicons 依赖）*/}
      🔔
      {unreadCount > 0 && (
        <span
          data-testid="notification-badge"
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            background: "#ef4444",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            lineHeight: "16px",
            textAlign: "center",
            boxShadow: "0 0 0 2px #fff",
            letterSpacing: "0.01em",
          }}
        >
          {displayCount}
        </span>
      )}
    </Link>
  );
}
