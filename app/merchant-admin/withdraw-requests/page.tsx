// [任务 18] 商家端提现申请记录 — 只读
// 复用 src/lib/withdraw-request.ts 的 listWithdrawRequestsByMerchant
// 注意：本任务范围内商家不可创建/审核提现（按用户决策）

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import {
  getEffectiveMerchantId,
  listMerchantWithdrawRequests,
} from "@/src/lib/merchant-admin";
import { card, th, td } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  pending: "待审核",
  approved: "已批准",
  rejected: "已拒绝",
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#fef9c3", fg: "#854d0e" },
  approved: { bg: "#dcfce7", fg: "#15803d" },
  rejected: { bg: "#fee2e2", fg: "#b91c1c" },
};

function fmt(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

interface PageProps {
  searchParams: Promise<{ created?: string; error?: string }>;
}

export default async function MerchantWithdrawRequestsPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return <div style={{ ...card, color: "#b91c1c" }}>{msg}。</div>;
  }
  const { created, error } = await searchParams;
  const requests = await listMerchantWithdrawRequests(merchantId);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>本商家提现记录</h1>
        <Link
          href="/merchant-admin/withdraw-requests/new"
          style={{
            padding: "8px 16px",
            background: "#2563eb",
            color: "#fff",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          ＋ 申请新提现
        </Link>
      </div>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px 0" }}>
        共 {requests.length} 条 — 仅展示本商家账号提现申请历史
      </p>

      {created === "1" && (
        <div
          data-testid="withdraw-created-toast"
          style={{
            padding: "12px 16px",
            background: "#dcfce7",
            borderRadius: 6,
            color: "#15803d",
            fontSize: 13,
            marginBottom: 16,
            border: "1px solid #86efac",
          }}
        >
          ✓ 申请已提交，待平台审核。
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "#fee2e2",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 13,
            marginBottom: 16,
            border: "1px solid #fecaca",
          }}
        >
          ✗ 申请失败：{decodeURIComponent(error)}
        </div>
      )}

      <div
        style={{
          overflowX: "auto",
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <th style={th}>申请编号</th>
              <th style={th}>金额</th>
              <th style={th}>状态</th>
              <th style={th}>用途说明</th>
              <th style={th}>审核人</th>
              <th style={th}>审核时间</th>
              <th style={th}>拒绝原因</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...td,
                    color: "#6b7280",
                    textAlign: "center",
                    padding: 32,
                  }}
                >
                  暂无提现记录
                </td>
              </tr>
            ) : (
              requests.map((r) => {
                const c = STATUS_COLOR[r.status] ?? STATUS_COLOR.pending;
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}>
                      <code style={{ fontSize: 11 }}>{r.id.slice(0, 10)}</code>
                    </td>
                    <td style={td}>
                      <strong>{fmt(r.amount)}</strong>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: c.bg,
                          color: c.fg,
                        }}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>
                        {r.remark ?? "(无)"}
                      </span>
                    </td>
                    <td style={td}>{r.reviewerName ?? "—"}</td>
                    <td style={td}>
                      {r.reviewedAt
                        ? new Date(r.reviewedAt).toISOString().slice(0, 16)
                        : "—"}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 12, color: "#b91c1c" }}>
                        {r.rejectReason ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
