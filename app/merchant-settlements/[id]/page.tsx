import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { card, th, td } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { getMerchantSettlementDetail } from "@/src/lib/merchant-settlement";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function MerchantSettlementDetailPage({
  params,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const { id } = await params;
  const data = await getMerchantSettlementDetail(id);
  if (!data) notFound();
  const { summary, previews } = data;

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
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/merchant-settlements"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          ← 返回汇总列表
        </Link>
      </div>
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>
        商家结算详情 — {summary.merchant.name}
      </h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        期间{" "}
        <span
          style={{
            fontFamily: "monospace",
            background: "#f3f4f6",
            padding: "2px 6px",
            borderRadius: 3,
            fontSize: 13,
          }}
        >
          {summary.period}
        </span>
      </p>

      {/* 1. 商家信息 */}
      <section style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>商家信息</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            fontSize: 13,
          }}
        >
          <Field label="商家 ID" value={summary.merchant.id} mono />
          <Field label="商家名称" value={summary.merchant.name} />
          <Field
            label="状态"
            value={summary.merchant.status === "active" ? "启用" : "停用"}
          />
          <Field label="联系人" value={summary.merchant.contactName} />
          <Field label="电话" value={summary.merchant.phone} />
          <Field label="邀请码" value={summary.merchant.inviteCode} mono />
          <Field
            label="邀请码状态"
            value={summary.merchant.inviteCodeEnabled ? "可用" : "禁用"}
          />
          <Field
            label="省 / 市"
            value={`${summary.merchant.province} / ${summary.merchant.city}`}
          />
          <Field
            label="区县 / 街道"
            value={`${summary.merchant.district} / ${summary.merchant.street}`}
          />
        </div>
      </section>

      {/* 2. 周期汇总 */}
      <section style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>
          周期汇总（{summary.period}）
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          <StatCard
            label="订单数"
            value={String(summary.totalOrderCount)}
            color="#111827"
          />
          <StatCard
            label="订单总金额"
            value={formatYuan(summary.totalAmount)}
            color="#15803d"
          />
          <StatCard
            label="平台费"
            value={formatYuan(summary.platformFee)}
            color="#1d4ed8"
          />
          <StatCard
            label="商家 + 师傅收"
            value={formatYuan(summary.merchantIncome + summary.workerIncome)}
            color="#7c3aed"
          />
        </div>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            padding: 12,
            background: "#f9fafb",
            borderRadius: 6,
          }}
        >
          <SplitCard
            label="平台费"
            value={summary.platformFee}
            total={summary.totalAmount}
            color="#1d4ed8"
          />
          <SplitCard
            label="商家收"
            value={summary.merchantIncome}
            total={summary.totalAmount}
            color="#7c3aed"
          />
          <SplitCard
            label="师傅收"
            value={summary.workerIncome}
            total={summary.totalAmount}
            color="#15803d"
          />
        </div>
      </section>

      {/* 3. 订单明细 */}
      <section style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>
          订单明细（{previews.length} 条）
        </h2>
        {previews.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 14, padding: "20px 0" }}>
            该期间暂无订单（可能 SettlementPreview 已被删除）
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>订单</th>
                <th style={th}>客户 / 服务</th>
                <th style={th}>师傅</th>
                <th style={th}>使用策略</th>
                <th style={th}>订单金额</th>
                <th style={th}>平台</th>
                <th style={th}>商家</th>
                <th style={th}>师傅</th>
              </tr>
            </thead>
            <tbody>
              {previews.map((p) => (
                <tr key={p.id}>
                  <td style={td}>
                    <Link
                      href={`/orders/${p.order.id}`}
                      style={{
                        color: "#2563eb",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {p.order.id}
                    </Link>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {p.order.status}
                    </div>
                  </td>
                  <td style={td}>
                    <div>{p.order.customerName}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {p.order.serviceName}
                    </div>
                  </td>
                  <td style={td}>
                    <div>{p.master.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {p.master.phone}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {p.strategy ? (
                      <>
                        {p.strategy.name}
                        <div style={{ color: "#9ca3af", fontSize: 11 }}>
                          {p.strategy.strategyType === "percentage"
                            ? "按比例"
                            : "固定金额"}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>无</span>
                    )}
                  </td>
                  <td style={td}>{formatYuan(p.orderAmount)}</td>
                  <td style={{ ...td, color: "#1d4ed8" }}>
                    {formatYuan(p.platformAmount)}
                  </td>
                  <td style={{ ...td, color: "#7c3aed" }}>
                    {formatYuan(p.merchantAmount)}
                  </td>
                  <td style={{ ...td, color: "#15803d" }}>
                    {formatYuan(p.workerAmount)}
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

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: "#111827",
          fontFamily: mono ? "monospace" : "inherit",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "12px 8px",
        background: "#f9fafb",
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function SplitCard({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color }}>
        {formatYuan(value)}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
        占 {pct}%
      </div>
    </div>
  );
}
