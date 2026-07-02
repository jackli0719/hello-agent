// [任务 12] 线下打款记录列表页 — 财务对账用
//
// 设计：
// - RSC（无客户端交互）
// - 简单列表，无分页（演示期量小）
// - 按 paidAt desc 排序
// - 每行显示：打款时间 / 商家 / 期间 / 金额 / 凭证 / 操作人 / 结算状态
// - 仅 admin 可访问

import Link from "next/link";
import { redirect } from "next/navigation";
import { card, th, td } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { listAllPayouts } from "@/src/lib/payout";

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function PayoutRecordsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const payouts = await listAllPayouts();

  // 汇总
  const totalAmount = payouts.reduce((sum, p) => sum + p.amount, 0);

  return (
    <main
      style={{
        padding: "24px 48px 48px",
        background: "#f7f8fa",
        minHeight: "calc(100vh - 56px)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>线下打款记录</h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        共 {payouts.length} 笔 · 合计{" "}
        <span style={{ color: "#15803d", fontWeight: 600 }}>
          {formatYuan(totalAmount)}
        </span>
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          （只录入，不接支付通道）
        </span>
      </p>

      <section style={card}>
        {payouts.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无打款记录
            <div style={{ fontSize: 12, marginTop: 8, color: "#9ca3af" }}>
              在{" "}
              <Link href="/merchant-settlements" style={{ color: "#2563eb" }}>
                /merchant-settlements
              </Link>{" "}
              已确认/已归档的结算详情页录入
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>打款时间</th>
                <th style={th}>商家</th>
                <th style={th}>结算期间</th>
                <th style={th}>结算状态</th>
                <th style={th}>金额</th>
                <th style={th}>凭证</th>
                <th style={th}>操作人</th>
                <th style={th}>关联结算</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{p.paidAt.toLocaleString("zh-CN")}</td>
                  <td style={td}>
                    <Link
                      href={`/merchants/${p.merchant.id}`}
                      style={{
                        color: "#2563eb",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {p.merchant.name}
                    </Link>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        fontFamily: "monospace",
                        background: "#f3f4f6",
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontSize: 12,
                      }}
                    >
                      {p.settlement.period}
                    </span>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 3,
                        background:
                          p.settlement.status === "confirmed"
                            ? "#dcfce7"
                            : p.settlement.status === "archived"
                              ? "#fee2e2"
                              : "#f3f4f6",
                        color:
                          p.settlement.status === "confirmed"
                            ? "#15803d"
                            : p.settlement.status === "archived"
                              ? "#b91c1c"
                              : "#6b7280",
                      }}
                    >
                      {p.settlement.status === "pending"
                        ? "待确认"
                        : p.settlement.status === "confirmed"
                          ? "已确认"
                          : "已归档"}
                    </span>
                  </td>
                  <td style={{ ...td, color: "#15803d", fontWeight: 500 }}>
                    {formatYuan(p.amount)}
                  </td>
                  <td style={td}>
                    {p.proofUrl ? (
                      <a
                        href={p.proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "#2563eb",
                          fontSize: 12,
                          textDecoration: "none",
                        }}
                      >
                        查看 ↗
                      </a>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  <td style={td}>{p.operator}</td>
                  <td style={td}>
                    <Link
                      href={`/merchant-settlements/${p.settlement.id}`}
                      style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        color: "#1f2937",
                        textDecoration: "none",
                      }}
                    >
                      {p.settlement.id.slice(0, 12)}…
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
