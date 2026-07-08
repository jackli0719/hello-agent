// [任务 18] 商家端订单列表 — 只读
//
// 来源：
// 1. 本商家师傅接了的订单（master.merchantId = user.merchantId）
// 2. 本商家 enabled 服务区域内的可见订单（reuse getOrdersVisibleToMerchant）
// 合并去重 — byMaster 优先（同订单两套都落只算"已派单"）
//
// [任务 19] byMaster 订单行可点进详情页（/merchant-admin/orders/[id]）执行「取消订单」

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import {
  getEffectiveMerchantId,
  listMerchantOrders,
} from "@/src/lib/merchant-admin";
import { card, th, td, StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";

const SOURCE_LABEL = {
  byMaster: "已派单",
  byArea: "可派单",
};

export default async function MerchantOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return <div style={{ ...card, color: "#b91c1c" }}>{msg}。</div>;
  }
  const { orders, counts } = await listMerchantOrders(merchantId);

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>订单</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px 0" }}>
        共 {orders.length} 单 — 已派单 {counts.byMaster} / 可派单区域{" "}
        {counts.byArea}（重叠 {counts.overlap}）
      </p>

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
              <th style={th}>订单号</th>
              <th style={th}>来源</th>
              <th style={th}>服务</th>
              <th style={th}>客户</th>
              <th style={th}>师傅</th>
              <th style={th}>金额</th>
              <th style={th}>状态</th>
              <th style={th}>预约时间</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    ...td,
                    color: "#6b7280",
                    textAlign: "center",
                    padding: 32,
                  }}
                >
                  暂无订单
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={td}>
                    <code style={{ fontSize: 12 }}>{o.id.slice(0, 12)}</code>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background:
                          o.source === "byMaster" ? "#dcfce7" : "#dbeafe",
                        color: o.source === "byMaster" ? "#15803d" : "#1d4ed8",
                      }}
                    >
                      {SOURCE_LABEL[o.source]}
                    </span>
                  </td>
                  <td style={td}>{o.serviceName}</td>
                  <td style={td}>{o.customerName}</td>
                  <td style={td}>{o.masterName ?? "—"}</td>
                  <td style={td}>¥{o.amountYuan.toFixed(2)}</td>
                  <td style={td}>
                    <StatusBadge
                      label={
                        ORDER_STATUS_LABEL[
                          o.status as keyof typeof ORDER_STATUS_LABEL
                        ] ?? o.status
                      }
                      tone={ORDER_TONE[o.status] ?? "neutral"}
                    />
                  </td>
                  <td style={td}>{o.scheduledAt.slice(0, 16)}</td>
                  <td style={td}>
                    {o.source === "byMaster" ? (
                      <Link
                        href={`/merchant-admin/orders/${o.id}`}
                        style={{
                          fontSize: 12,
                          color: "#2563eb",
                          textDecoration: "none",
                          padding: "2px 8px",
                          border: "1px solid #bfdbfe",
                          borderRadius: 4,
                        }}
                      >
                        详情
                      </Link>
                    ) : (
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 12 }}>
        说明：仅「已派单（byMaster）」订单可点详情；「可派单区域（byArea）」订单未派单，无详情入口。
      </p>
    </div>
  );
}
