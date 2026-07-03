// [任务 18] 商家端总览 — 4 张汇总卡
//
// 只读：master 数 / 订单数(本商家师傅接的) / 订单数(本商家可见区域) / 累计收入(元) / 待审核提现数

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId, getMerchantDashboard } from "@/src/lib/merchant-admin";
import { card } from "@/components/ui";

function formatYuan(yuan: number) {
  return `¥${yuan.toFixed(2)}`;
}

export default async function MerchantAdminDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return (
      <div style={{ ...card, color: "#b91c1c" }}>
        {msg}。请联系平台管理员。
      </div>
    );
  }
  const summary = await getMerchantDashboard(merchantId);

  const tiles = [
    { label: "本商家师傅", value: summary.masterCount, suffix: "位" },
    {
      label: "本商家师傅接单",
      value: summary.orderCountByMaster,
      suffix: "单",
    },
    {
      label: "本商家可见区域订单",
      value: summary.orderCountByArea,
      suffix: "单",
    },
    {
      label: "累计结算收入",
      value: formatYuan(summary.totalIncomeYuan),
      suffix: "",
    },
    {
      label: "待审核提现",
      value: summary.pendingWithdrawCount,
      suffix: "笔",
    },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 16px 0" }}>本商家总览</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 24px 0" }}>
        只展示商家编码 <code>{summary.merchantId}</code> 的数据。
        {user.role === "admin" && (
          <span style={{ color: "#b45309", marginLeft: 8 }}>
            （admin 排障视图 — fallback 到第一个 active 商家）
          </span>
        )}
        如需调整商家绑定，请联系平台管理员。
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        {tiles.map((t) => (
          <div key={t.label} style={card}>
            <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 8 }}>
              {t.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 600, color: "#111827" }}>
              {t.value}
              <span style={{ fontSize: 14, color: "#6b7280", marginLeft: 6 }}>
                {t.suffix}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
