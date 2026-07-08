import Link from "next/link";
import { card, th, td, StatusBadge } from "@/components/ui";
import { listSettlementPreviews } from "@/src/lib/settlement";
import { generateSettlementsAction } from "./actions";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{
    generated?: string;
    skipped?: string;
    failed?: string;
    error?: string;
  }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function SettlementsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const { generated, skipped, failed, error } = await searchParams;
  const [csrfToken, settlements] = await Promise.all([
    ensureCsrfCookie(),
    listSettlementPreviews(),
  ]);

  // 统计：按 status 分组
  const stats = settlements.reduce(
    (acc, s) => {
      acc.total++;
      acc.platformTotal += s.platformAmount;
      acc.merchantTotal += s.merchantAmount;
      acc.workerTotal += s.workerAmount;
      return acc;
    },
    { total: 0, platformTotal: 0, merchantTotal: 0, workerTotal: 0 },
  );

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>结算预览</h1>
        <form action={generateSettlementsAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            生成预览（扫所有 completed 订单）
          </button>
        </form>
      </div>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        共 {stats.total} 条预览
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          （仅做预览，不做提现/打款）
        </span>
      </p>

      {/* 生成结果反馈 */}
      {(generated !== undefined || error) && (
        <div
          style={{
            padding: "10px 14px",
            background: failed && Number(failed) > 0 ? "#fee2e2" : "#dcfce7",
            color: failed && Number(failed) > 0 ? "#b91c1c" : "#15803d",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error
            ? error
            : `生成完成：新建 ${generated} 条 / 跳过 ${skipped} 条${
                Number(failed ?? 0) > 0 ? ` / 失败 ${failed} 条` : ""
              }`}
        </div>
      )}

      {/* 三方分成汇总 */}
      {settlements.length > 0 && (
        <section
          style={{
            ...card,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <StatCard
            label="平台累计"
            value={formatYuan(stats.platformTotal)}
            color="#15803d"
          />
          <StatCard
            label="商家累计"
            value={formatYuan(stats.merchantTotal)}
            color="#1d4ed8"
          />
          <StatCard
            label="师傅累计"
            value={formatYuan(stats.workerTotal)}
            color="#7c3aed"
          />
        </section>
      )}

      <section style={card}>
        {settlements.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无结算预览
            <div style={{ fontSize: 12, marginTop: 8, color: "#9ca3af" }}>
              点击右上「生成预览」扫描 completed 订单
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>订单</th>
                <th style={th}>商家 / 师傅</th>
                <th style={th}>使用策略</th>
                <th style={th}>订单金额</th>
                <th style={th}>平台</th>
                <th style={th}>商家</th>
                <th style={th}>师傅</th>
                <th style={th}>状态</th>
                <th style={th}>生成时间</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id}>
                  <td style={td}>
                    <Link
                      href={`/orders/${s.order.id}`}
                      style={{
                        color: "#2563eb",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {s.order.id}
                    </Link>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {s.order.customerName} · {s.order.serviceName}
                    </div>
                  </td>
                  <td style={td}>
                    <div>{s.merchant.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {s.master.name}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {s.strategy ? (
                      <>
                        {s.strategy.name}
                        <div style={{ color: "#9ca3af", fontSize: 11 }}>
                          {s.strategy.strategyType === "percentage"
                            ? "按比例"
                            : "固定金额"}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>无（fallback）</span>
                    )}
                  </td>
                  <td style={td}>{formatYuan(s.orderAmount)}</td>
                  <td style={td}>{formatYuan(s.platformAmount)}</td>
                  <td style={td}>{formatYuan(s.merchantAmount)}</td>
                  <td style={td}>{formatYuan(s.workerAmount)}</td>
                  <td style={td}>
                    <StatusBadge
                      label={
                        s.status === "generated"
                          ? "已生成"
                          : s.status === "archived"
                            ? "已归档"
                            : "失败"
                      }
                      tone={
                        s.status === "generated"
                          ? "green"
                          : s.status === "archived"
                            ? "gray"
                            : "red"
                      }
                    />
                  </td>
                  <td style={td}>{s.createdAt.toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
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
