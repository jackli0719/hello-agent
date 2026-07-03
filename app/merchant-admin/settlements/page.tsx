// [任务 18] 商家端结算汇总列表 — 只读
// 复用 src/lib/merchant-settlement.ts 的 listMerchantSettlementsByMerchant

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId, listMerchantSettlements } from "@/src/lib/merchant-admin";
import { card, th, td } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  confirmed: "已确认",
  archived: "已归档",
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#fef9c3", fg: "#854d0e" },
  confirmed: { bg: "#dcfce7", fg: "#15803d" },
  archived: { bg: "#f3f4f6", fg: "#6b7280" },
};

function fmt(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function MerchantSettlementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return <div style={{ ...card, color: "#b91c1c" }}>{msg}。</div>;
  }
  const settlements = await listMerchantSettlements(merchantId);

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>本商家结算</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px 0" }}>
        共 {settlements.length} 个月度结算汇总
      </p>
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={th}>周期</th>
              <th style={th}>订单数</th>
              <th style={th}>订单总金额</th>
              <th style={th}>平台抽成</th>
              <th style={th}>师傅收入</th>
              <th style={th}>商家应得</th>
              <th style={th}>状态</th>
            </tr>
          </thead>
          <tbody>
            {settlements.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, color: "#6b7280", textAlign: "center", padding: 32 }}>
                  暂未生成结算（需 admin 触发月度生成）
                </td>
              </tr>
            ) : (
              settlements.map((s) => {
                const c = STATUS_COLOR[s.status] ?? STATUS_COLOR.pending;
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}><code style={{ fontSize: 12 }}>{s.period}</code></td>
                    <td style={td}>{s.totalOrderCount}</td>
                    <td style={td}>{fmt(s.totalAmount)}</td>
                    <td style={td}>{fmt(s.platformFee)}</td>
                    <td style={td}>{fmt(s.workerIncome)}</td>
                    <td style={td}><strong>{fmt(s.merchantIncome)}</strong></td>
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
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 12 }}>
        说明：结算由 admin 后台按月生成，确认/归档由平台处理。如有疑问请联系平台。
      </p>
    </div>
  );
}
