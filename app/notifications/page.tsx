// [任务 19] 通知中心 — 列表页（RSC）
//
// 设计：
// - RSC 直接读 listNotificationsForUser（按 userId 硬过滤，防越权）
// - 未读数 header 红点已由 root layout 注入
// - "全部已读"按钮 + "标为已读"按钮 → server action
// - 通知按 createdAt desc 分页
//
// 权限：仅登录且非 admin 可见（admin 看 ActivityLog）
// - middleware 已保护 /notifications 路径（PROTECTED_PATHS 不需要包含 /notifications，
//   layout 内 getCurrentUser 兜底 redirect）

import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/src/lib/auth";
import { listNotificationsForUser, type NotificationType } from "@/src/lib/notifications";
import { CSRF_COOKIE } from "@/src/lib/csrf-constants";
import { markReadAction, markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";

// 通知类型 → 中文标签 + 配色
const TYPE_LABEL: Record<NotificationType, { label: string; color: string }> = {
  order_paid: { label: "支付", color: "#0ea5e9" },
  order_assigned: { label: "派单", color: "#2563eb" },
  order_completed: { label: "完成", color: "#16a34a" },
  order_canceled: { label: "取消", color: "#dc2626" },
  order_refunded: { label: "退款", color: "#f59e0b" },
};

export default async function NotificationsPage({
  searchParams,
}: {
  // [Next.js 15] searchParams 是 Promise
  searchParams: Promise<{ unread?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/notifications");
  }
  // admin 不在站内通知范围（按用户决策：admin 看 ActivityLog）
  if (user.role === "admin") {
    redirect("/activity-logs");
  }

  const page = Number(sp.page ?? "1") || 1;
  const unreadOnly = sp.unread === "1";
  const { notifications, totalCount, unreadCount } = await listNotificationsForUser(
    user.id,
    { page, pageSize: 20, unreadOnly },
  );
  // [v0.7.3] 修 CSRF：markRead 表单需要 _csrf hidden input（值 = cookie token）
  const csrfToken = (await cookies()).get(CSRF_COOKIE)?.value ?? "";

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "24px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              color: "#0f172a",
              letterSpacing: "0.01em",
            }}
          >
            通知中心
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "#64748b",
              margin: "4px 0 0",
            }}
          >
            {unreadCount > 0
              ? `${unreadCount} 条未读 / 共 ${totalCount} 条`
              : `共 ${totalCount} 条`}
          </p>
        </div>

        {/* 全部已读按钮 — 仅未读 > 0 时显示 */}
        {unreadCount > 0 && (
          <form action={markAllReadAction}>
            <button
              type="submit"
              data-testid="mark-all-read"
              style={{
                padding: "6px 14px",
                background: "#fff",
                color: "#0f172a",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              全部已读
            </button>
          </form>
        )}
      </header>

      {/* 过滤器：全部 / 仅未读 */}
      <nav
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <Link
          href="/notifications"
          data-testid="filter-all"
          style={{
            padding: "4px 12px",
            borderRadius: 4,
            textDecoration: "none",
            background: !unreadOnly ? "#e0e7ff" : "transparent",
            color: !unreadOnly ? "#3730a3" : "#475569",
            fontWeight: !unreadOnly ? 600 : 500,
          }}
        >
          全部
        </Link>
        <Link
          href="/notifications?unread=1"
          data-testid="filter-unread"
          style={{
            padding: "4px 12px",
            borderRadius: 4,
            textDecoration: "none",
            background: unreadOnly ? "#e0e7ff" : "transparent",
            color: unreadOnly ? "#3730a3" : "#475569",
            fontWeight: unreadOnly ? 600 : 500,
          }}
        >
          仅未读 {unreadCount > 0 ? `(${unreadCount})` : ""}
        </Link>
      </nav>

      {/* 列表 */}
      {notifications.length === 0 ? (
        <div
          style={{
            padding: "60px 16px",
            textAlign: "center",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            color: "#94a3b8",
            fontSize: 14,
          }}
        >
          {unreadOnly ? "没有未读通知" : "暂无通知"}
        </div>
      ) : (
        <ul
          data-testid="notification-list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {notifications.map((n, idx) => {
            const meta = TYPE_LABEL[n.type as NotificationType] ?? {
              label: n.type,
              color: "#64748b",
            };
            const isUnread = !n.readAt;
            return (
              <li
                key={n.id}
                data-testid="notification-item"
                data-unread={isUnread ? "1" : "0"}
                style={{
                  padding: "14px 16px",
                  borderBottom:
                    idx === notifications.length - 1
                      ? "none"
                      : "1px solid #e2e8f0",
                  background: isUnread ? "#f0f9ff" : "transparent",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    background: meta.color,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 4,
                    marginTop: 2,
                    flexShrink: 0,
                    letterSpacing: "0.01em",
                  }}
                >
                  {meta.label}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: isUnread ? 600 : 500,
                      color: "#0f172a",
                      marginBottom: 2,
                    }}
                  >
                    {n.title}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#475569",
                      lineHeight: 1.5,
                    }}
                  >
                    {n.content}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      marginTop: 4,
                    }}
                  >
                    {formatTime(n.createdAt)}
                    {n.orderId && (
                      <>
                        {" · "}
                        <Link
                          href={
                            user.role === "customer"
                              ? `/customer/orders/${n.orderId}`
                              : user.role === "worker"
                                ? `/worker/orders/${n.orderId}`
                                : `/orders/${n.orderId}`
                          }
                          style={{ color: "#2563eb", textDecoration: "none" }}
                        >
                          查看订单
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                {isUnread && (
                  <form action={markReadAction}>
                    <input
                      type="hidden"
                      name="notificationId"
                      value={n.id}
                    />
                    <input
                      type="hidden"
                      name="_csrf"
                      value={csrfToken}
                    />
                    <button
                      type="submit"
                      data-testid="mark-read"
                      style={{
                        padding: "4px 10px",
                        background: "transparent",
                        color: "#2563eb",
                        border: "1px solid #bfdbfe",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      标为已读
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatTime(d: Date): string {
  const now = Date.now();
  const t = d.getTime();
  const diff = now - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}
