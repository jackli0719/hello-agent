// [任务 18] 商家端师傅列表 — 只读

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId, listMerchantMasters } from "@/src/lib/merchant-admin";
import { card, th, td } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  available: "可接单",
  busy: "服务中",
  offline: "离线",
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  available: { bg: "#dcfce7", fg: "#15803d" },
  busy: { bg: "#dbeafe", fg: "#1d4ed8" },
  offline: { bg: "#f3f4f6", fg: "#6b7280" },
};

export default async function MerchantMastersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return <div style={{ ...card, color: "#b91c1c" }}>{msg}。</div>;
  }
  const masters = await listMerchantMasters(merchantId);

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>本商家师傅</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px 0" }}>
        共 {masters.length} 位
      </p>
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={th}>编码</th>
              <th style={th}>姓名</th>
              <th style={th}>电话</th>
              <th style={th}>技能</th>
              <th style={th}>状态</th>
              <th style={th}>入驻来源</th>
            </tr>
          </thead>
          <tbody>
            {masters.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...td, color: "#6b7280", textAlign: "center", padding: 32 }}>
                  暂无师傅
                </td>
              </tr>
            ) : (
              masters.map((m) => {
                const statusColor = STATUS_COLOR[m.status] ?? STATUS_COLOR.offline;
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}>
                      <code style={{ fontSize: 12 }}>{m.id.slice(0, 10)}</code>
                    </td>
                    <td style={td}>{m.name}</td>
                    <td style={td}>{m.phone}</td>
                    <td style={td}>
                      <code style={{ fontSize: 11, color: "#6b7280" }}>
                        {m.skills || "(空)"}
                      </code>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: statusColor.bg,
                          color: statusColor.fg,
                        }}
                      >
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </td>
                    <td style={td}>
                      <code style={{ fontSize: 11, color: "#6b7280" }}>{m.joinSource}</code>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 12 }}>
        说明：师傅入驻、技能变更由 admin 后台或邀请码入驻页面处理。
      </p>
    </div>
  );
}
