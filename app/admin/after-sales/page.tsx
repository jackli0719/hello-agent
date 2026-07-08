// [任务 21] 售后工单 — admin 后台列表 /admin/after-sales
//
// 设计：
// - RSC 直接查 listAfterSalesTickets
// - filter via URL query: ?status=pending|processing|resolved|rejected|all
// - 入口：顶部菜单放在 /admin/* （CLAUDE.md P0-6 新增后台页要权限矩阵 + 这里快速提示）
// - 跳过 admin → redirect 到 /admin（CLAUDE.md P0-1 防御）

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import {
  listAfterSalesTickets,
  type AfterSalesStatus,
} from "@/src/lib/after-sales";
import { ensureCsrfCookie } from "@/src/lib/csrf";

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

const STATUS_LABEL: Record<AfterSalesStatus | "all", string> = {
  all: "全部",
  pending: "待处理",
  processing: "处理中",
  resolved: "已解决",
  rejected: "已拒绝",
};

const STATUS_COLOR: Record<
  AfterSalesStatus,
  { bg: string; border: string; color: string }
> = {
  pending: { bg: "#fef3c7", border: "#fde68a", color: "#92400e" },
  processing: { bg: "#dbeafe", border: "#bfdbfe", color: "#1e40af" },
  resolved: { bg: "#dcfce7", border: "#bbf7d0", color: "#15803d" },
  rejected: { bg: "#fee2e2", border: "#fecaca", color: "#b91c1c" },
};

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatAmountFen(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

function parseStatus(raw: string | undefined): AfterSalesStatus | "all" {
  if (
    raw === "pending" ||
    raw === "processing" ||
    raw === "resolved" ||
    raw === "rejected"
  ) {
    return raw;
  }
  return "all";
}

export default async function AdminAfterSalesPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  // 1. 登录校验 + admin 角色
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/admin/after-sales");
  }
  if (user.role !== "admin") {
    redirect("/");
  }
  // [CSRF] cookie — admin 操作按钮可能用（非 FormData startProcessing 不需要）
  await ensureCsrfCookie();

  // 2. 解析 filter
  const status = parseStatus(sp.status);
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const pageSize = 20;

  // 3. 查
  const { tickets, totalCount } = await listAfterSalesTickets({
    status,
    page,
    pageSize,
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/admin"
            style={{
              fontSize: 13,
              color: "#2563eb",
              textDecoration: "none",
              padding: "6px 10px",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
            }}
          >
            ← 后台首页
          </Link>
          <h1 style={{ fontSize: 18, margin: 0, color: "#111827" }}>
            售后工单（{totalCount}）
          </h1>
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          登录：<code>{user.name}</code>
        </div>
      </header>

      {/* filter tabs */}
      <div style={tabsStyle}>
        {(
          ["all", "pending", "processing", "resolved", "rejected"] as const
        ).map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={
                s === "all"
                  ? "/admin/after-sales"
                  : `/admin/after-sales?status=${s}`
              }
              style={{
                padding: "6px 12px",
                fontSize: 13,
                color: active ? "#fff" : "#374151",
                background: active ? "#2563eb" : "transparent",
                border: active ? "none" : "1px solid #d1d5db",
                borderRadius: 6,
                textDecoration: "none",
              }}
            >
              {STATUS_LABEL[s]}
            </Link>
          );
        })}
      </div>

      {/* list */}
      <section style={cardStyle}>
        {tickets.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 14,
            }}
          >
            {status === "all"
              ? "暂无售后工单"
              : `暂无「${STATUS_LABEL[status]}」状态的售后工单`}
          </div>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid #e5e7eb",
                  color: "#6b7280",
                  fontSize: 12,
                }}
              >
                <th style={thStyle}>订单号</th>
                <th style={thStyle}>客户</th>
                <th style={thStyle}>服务</th>
                <th style={thStyle}>金额</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>发起时间</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const tone = STATUS_COLOR[t.afterSalesStatus];
                return (
                  <tr
                    key={t.orderId}
                    style={{ borderBottom: "1px solid #f0f0f0" }}
                  >
                    <td style={tdStyle}>
                      <Link
                        href={`/admin/after-sales/${encodeURIComponent(t.orderId)}`}
                        style={{ color: "#2563eb", textDecoration: "none" }}
                      >
                        {t.orderId}
                      </Link>
                    </td>
                    <td style={tdStyle}>{t.customerName}</td>
                    <td style={tdStyle}>{t.serviceName}</td>
                    <td style={tdStyle}>{formatAmountFen(t.amount)}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: "2px 8px",
                          fontSize: 11,
                          background: tone.bg,
                          border: `1px solid ${tone.border}`,
                          color: tone.color,
                          borderRadius: 4,
                        }}
                      >
                        {STATUS_LABEL[t.afterSalesStatus]}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatDateTime(t.createdAt)}</td>
                    <td style={tdStyle}>
                      <Link
                        href={`/admin/after-sales/${encodeURIComponent(t.orderId)}`}
                        style={{
                          padding: "3px 8px",
                          fontSize: 12,
                          color: "#fff",
                          background: "#2563eb",
                          borderRadius: 4,
                          textDecoration: "none",
                        }}
                      >
                        查看
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* pagination */}
        {totalPages > 1 ? (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "center",
              gap: 8,
              fontSize: 13,
            }}
          >
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={
                  status === "all"
                    ? `/admin/after-sales?page=${p}`
                    : `/admin/after-sales?status=${status}&page=${p}`
                }
                style={{
                  padding: "4px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  color: p === page ? "#fff" : "#374151",
                  background: p === page ? "#2563eb" : "transparent",
                  textDecoration: "none",
                }}
              >
                {p}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ============== styles ==============

const pageStyle: React.CSSProperties = {
  minHeight: "calc(100vh - 56px)",
  background: "#f7f8fa",
  padding: "16px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  color: "#111827",
  maxWidth: 1100,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "12px 16px",
  marginBottom: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginBottom: 12,
  flexWrap: "wrap",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 10px",
  verticalAlign: "middle",
};
