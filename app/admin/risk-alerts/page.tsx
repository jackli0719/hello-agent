// [任务 23] 风控预警后台 — /admin/risk-alerts
//
// 设计（CLAUDE.md P0-6：新增后台页同步权限矩阵）：
// - RSC 直接调 getRiskAlertsSummary 聚合（实时查询，不存表）
// - 只读展示：风险条目按类分 2 个 section（派单失败 / 异常提现）
// - 权限：admin 专属；middleware 已挡未登录用户，这里再做 role 校验兜底
// - "只预警不拦截"：本页面无任何写操作按钮
//
// MVP 边界：
// - 阈值写死（src/lib/risk-alerts.ts 顶部常量）
// - 实时聚合：演示期数据量小够用；后续生产可加 cron 批
// - 频繁取消 / 异常退款 2 类下阶段再做（CLAUDE.md P0-3 范围控制）

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import {
  getRiskAlertsSummary,
  type DispatchFailureAlert,
  type WithdrawAnomalyAlert,
} from "@/src/lib/risk-alerts";

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatAmountFen(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

const WITHDRAW_KIND_LABEL: Record<WithdrawAnomalyAlert["kind"], string> = {
  large_amount: "大额提现",
  frequent_pending: "频繁申请",
  overdraw: "疑似超提",
};

const WITHDRAW_KIND_COLOR: Record<
  WithdrawAnomalyAlert["kind"],
  { bg: string; border: string; color: string }
> = {
  large_amount: { bg: "#fef3c7", border: "#fde68a", color: "#92400e" },
  frequent_pending: { bg: "#fee2e2", border: "#fecaca", color: "#b91c1c" },
  overdraw: { bg: "#fce7f3", border: "#fbcfe8", color: "#9d174d" },
};

export default async function AdminRiskAlertsPage() {
  // 1. 登录 + admin 角色（middleware 已挡未登录；这里兜底非 admin）
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/admin/risk-alerts");
  }
  if (user.role !== "admin") {
    redirect("/");
  }

  // 2. 实时聚合 2 类预警
  const summary = await getRiskAlertsSummary();

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
            风控预警（仅展示，不拦截）
          </h1>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          数据更新时间：{formatDateTime(summary.generatedAt)} · 登录：
          <code>{user.name}</code>
        </div>
      </header>

      {/* ============================ Section 1: 派单失败 ============================ */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>
          <span style={{ color: "#dc2626" }}>●</span> 派单失败（最近 24h）
          <span style={countBadgeStyle}>{summary.dispatchFailures.length}</span>
        </h2>
        <div style={cardStyle}>
          {summary.dispatchFailures.length === 0 ? (
            <div style={emptyStyle}>暂无派单失败记录 ✓</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>订单号</th>
                  <th style={thStyle}>客户</th>
                  <th style={thStyle}>失败原因</th>
                  <th style={thStyle}>说明</th>
                  <th style={thStyle}>时间</th>
                </tr>
              </thead>
              <tbody>
                {summary.dispatchFailures.map((a: DispatchFailureAlert) => (
                  <tr key={a.activityLogId} style={tbodyRowStyle}>
                    <td style={tdStyle}>
                      <Link
                        href={`/orders/${encodeURIComponent(a.orderId)}`}
                        style={{ color: "#2563eb", textDecoration: "none" }}
                      >
                        {a.orderId}
                      </Link>
                    </td>
                    <td style={tdStyle}>{a.customerName}</td>
                    <td style={tdStyle}>
                      <code style={{ fontSize: 12, color: "#7c2d12" }}>
                        {a.failureCode}
                      </code>
                    </td>
                    <td style={tdStyle}>{a.reason}</td>
                    <td style={tdStyle}>{formatDateTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ============================ Section 2: 异常提现 ============================ */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>
          <span style={{ color: "#dc2626" }}>●</span> 异常提现
          <span style={countBadgeStyle}>
            {summary.withdrawAnomalies.length}
          </span>
        </h2>
        <div style={hintStyle}>
          阈值：单笔 ≥ ¥5000 ｜ 同商家 7 天内 pending ≥ 3 笔 ｜ 单笔 &gt;
          商家已确认余额 × 80%
        </div>
        <div style={cardStyle}>
          {summary.withdrawAnomalies.length === 0 ? (
            <div style={emptyStyle}>暂无异常提现记录 ✓</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>类型</th>
                  <th style={thStyle}>商家</th>
                  <th style={thStyle}>金额</th>
                  <th style={thStyle}>阈值 / 已确认余额</th>
                  <th style={thStyle}>触发详情</th>
                  <th style={thStyle}>时间</th>
                </tr>
              </thead>
              <tbody>
                {summary.withdrawAnomalies.map(
                  (a: WithdrawAnomalyAlert, idx: number) => {
                    const tone = WITHDRAW_KIND_COLOR[a.kind];
                    return (
                      <tr
                        key={`${a.kind}-${a.merchantId}-${idx}`}
                        style={tbodyRowStyle}
                      >
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
                            {WITHDRAW_KIND_LABEL[a.kind]}
                          </span>
                        </td>
                        <td style={tdStyle}>{a.merchantName}</td>
                        <td style={tdStyle}>
                          {a.amountCents != null
                            ? formatAmountFen(a.amountCents)
                            : "—"}
                        </td>
                        <td style={tdStyle}>
                          {a.kind === "large_amount" &&
                            a.thresholdCents != null &&
                            `≥ ${formatAmountFen(a.thresholdCents)}`}
                          {a.kind === "frequent_pending" &&
                            a.pendingCount != null &&
                            `7d 内 ${a.pendingCount} 笔 pending`}
                          {a.kind === "overdraw" &&
                            a.confirmedIncomeCents != null &&
                            a.thresholdCents != null &&
                            `已确认 ${formatAmountFen(
                              a.confirmedIncomeCents,
                            )} / 阈值 ${formatAmountFen(a.thresholdCents)}`}
                        </td>
                        <td style={tdStyle}>
                          {a.kind === "large_amount" &&
                            "单笔金额超过 ¥5000 大额阈值"}
                          {a.kind === "frequent_pending" &&
                            "同商家 7 天内频繁提交申请"}
                          {a.kind === "overdraw" &&
                            "申请金额超过商家已确认余额 80%（疑似超提）"}
                        </td>
                        <td style={tdStyle}>{formatDateTime(a.createdAt)}</td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div style={footnoteStyle}>
        <strong>任务 23 (T23) MVP 范围</strong>：仅 2 类（派单失败 +
        异常提现）。 频繁取消 / 异常退款 后续再做。&ldquo;频繁 pending &ge; 3
        笔&rdquo; 在 partial unique (merchantId) WHERE
        status=&apos;pending&apos; 约束下演示期不可达，规则保留供生产启用。
      </div>
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
  maxWidth: 1200,
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

const sectionStyle: React.CSSProperties = {
  marginBottom: 20,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  margin: "0 0 8px 0",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const countBadgeStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: "2px 8px",
  fontSize: 11,
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 10,
  fontWeight: 500,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 6,
  padding: "6px 10px",
  background: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: 4,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const emptyStyle: React.CSSProperties = {
  padding: 24,
  textAlign: "center",
  color: "#16a34a",
  fontSize: 14,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const theadRowStyle: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: 12,
};

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: "1px solid #f0f0f0",
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

const footnoteStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "10px 12px",
  fontSize: 12,
  color: "#6b7280",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  lineHeight: 1.7,
};
