import Link from "next/link";
import { card, th, td, StatusBadge } from "@/components/ui";
import { listMerchantSettlements } from "@/src/lib/merchant-settlement";
import { generateMerchantSettlementsAction } from "./actions";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    error?: string;
    period?: string;
  }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function MerchantSettlementsPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const { created, updated, error, period: filterPeriod } = await searchParams;
  const [csrfToken, allSettlements] = await Promise.all([
    ensureCsrfCookie(),
    listMerchantSettlements(),
  ]);
  // [任务 10] 月份筛选 — 列出所有可选 period（去重降序）
  const periodOptions = Array.from(new Set(allSettlements.map((s) => s.period)))
    .sort()
    .reverse();
  // 应用筛选
  const settlements = filterPeriod
    ? allSettlements.filter((s) => s.period === filterPeriod)
    : allSettlements;

  // 汇总：按 period 分组 + 全局汇总
  const periodTotals = new Map<
    string,
    {
      count: number;
      amount: number;
      platform: number;
      merchant: number;
      worker: number;
    }
  >();
  let grandTotal = 0;
  let grandPlatform = 0;
  let grandMerchant = 0;
  let grandWorker = 0;
  let grandOrderCount = 0;
  for (const s of settlements) {
    const cur = periodTotals.get(s.period) ?? {
      count: 0,
      amount: 0,
      platform: 0,
      merchant: 0,
      worker: 0,
    };
    cur.count += 1;
    cur.amount += s.totalAmount;
    cur.platform += s.platformFee;
    cur.merchant += s.merchantIncome;
    cur.worker += s.workerIncome;
    periodTotals.set(s.period, cur);
    grandOrderCount += s.totalOrderCount;
    grandTotal += s.totalAmount;
    grandPlatform += s.platformFee;
    grandMerchant += s.merchantIncome;
    grandWorker += s.workerIncome;
  }

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
        <h1 style={{ fontSize: 24, margin: 0 }}>商家结算汇总</h1>
        <form action={generateMerchantSettlementsAction}>
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
            生成汇总（从 SettlementPreview 聚合）
          </button>
        </form>
        {/* [任务 11] 导出全部已确认/已归档结算 CSV — GET 触发下载 */}
        <a
          href="/api/merchant-settlements/export?scope=all"
          style={{
            padding: "8px 18px",
            background: "#7c3aed",
            color: "#fff",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          导出 CSV（已确认 + 已归档）
        </a>
      </div>
      <p style={{ color: "#6b7280", margin: "0 0 12px 0", fontSize: 14 }}>
        共 {settlements.length} 条记录 · {periodTotals.size} 个期间
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          （仅展示，不做打款/提现）
        </span>
      </p>

      {/* [任务 10] 月份筛选器 */}
      {periodOptions.length > 0 && (
        <form
          method="get"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <label style={{ fontSize: 13, color: "#6b7280" }}>按月份筛选：</label>
          <select
            name="period"
            defaultValue={filterPeriod ?? ""}
            style={{
              padding: "6px 10px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 13,
              background: "#fff",
              outline: "none",
              minWidth: 120,
            }}
          >
            <option value="">全部</option>
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              padding: "6px 14px",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 6,
              fontSize: 13,
              border: "none",
              cursor: "pointer",
            }}
          >
            过滤
          </button>
          {filterPeriod && (
            <Link
              href="/merchant-settlements"
              style={{
                padding: "6px 12px",
                background: "#fff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              重置
            </Link>
          )}
          {filterPeriod && (
            <span
              style={{
                fontSize: 12,
                color: "#9ca3af",
              }}
            >
              当前显示：{filterPeriod}
            </span>
          )}
        </form>
      )}

      {(created !== undefined || error) && (
        <div
          style={{
            padding: "10px 14px",
            background: error ? "#fee2e2" : "#dcfce7",
            color: error ? "#b91c1c" : "#15803d",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error ? error : `汇总完成：新建 ${created} 条 / 更新 ${updated} 条`}
        </div>
      )}

      {/* 全局汇总卡片 */}
      {settlements.length > 0 && (
        <section
          style={{
            ...card,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <StatCard
            label="总订单数"
            value={String(grandOrderCount)}
            color="#111827"
          />
          <StatCard
            label="订单总金额"
            value={formatYuan(grandTotal)}
            color="#15803d"
          />
          <StatCard
            label="平台累计"
            value={formatYuan(grandPlatform)}
            color="#1d4ed8"
          />
          <StatCard
            label="商家+师傅累计"
            value={formatYuan(grandMerchant + grandWorker)}
            color="#7c3aed"
          />
        </section>
      )}

      <section style={card}>
        {settlements.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无商家结算汇总
            <div style={{ fontSize: 12, marginTop: 8, color: "#9ca3af" }}>
              1. 先在{" "}
              <Link href="/settlements" style={{ color: "#2563eb" }}>
                /settlements
              </Link>{" "}
              生成 preview
              <br />
              2. 然后点击右上「生成汇总」
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>期间</th>
                <th style={th}>商家</th>
                <th style={th}>状态</th>
                <th style={th}>订单数</th>
                <th style={th}>总金额</th>
                <th style={th}>平台费</th>
                <th style={th}>商家收</th>
                <th style={th}>师傅收</th>
                <th style={th}>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id}>
                  <td style={td}>
                    <Link
                      href={`/merchant-settlements/${s.id}`}
                      style={{
                        fontFamily: "monospace",
                        background: "#f3f4f6",
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontSize: 12,
                        color: "#1f2937",
                        textDecoration: "none",
                      }}
                    >
                      {s.period}
                    </Link>
                  </td>
                  <td style={td}>
                    <Link
                      href={`/merchant-settlements/${s.id}`}
                      style={{
                        color: "#2563eb",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {s.merchant.name}
                    </Link>
                  </td>
                  <td style={td}>
                    <StatusBadge
                      label={
                        s.status === "pending"
                          ? "待确认"
                          : s.status === "confirmed"
                            ? "已确认"
                            : "已归档"
                      }
                      tone={
                        s.status === "pending"
                          ? "gray"
                          : s.status === "confirmed"
                            ? "green"
                            : "red"
                      }
                    />
                  </td>
                  <td style={td}>{s.totalOrderCount}</td>
                  <td style={td}>{formatYuan(s.totalAmount)}</td>
                  <td style={{ ...td, color: "#1d4ed8" }}>
                    {formatYuan(s.platformFee)}
                  </td>
                  <td style={{ ...td, color: "#7c3aed" }}>
                    {formatYuan(s.merchantIncome)}
                  </td>
                  <td style={{ ...td, color: "#15803d" }}>
                    {formatYuan(s.workerIncome)}
                  </td>
                  <td style={td}>{s.updatedAt.toLocaleString("zh-CN")}</td>
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
      <div style={{ fontSize: 18, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
