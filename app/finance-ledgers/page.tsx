// [任务 14] 财务流水列表 + 统计 + 多维过滤
//
// 设计：
// - RSC：顶部统计卡 + 过滤表单（GET） + 表格
// - 过滤维度：type / merchantId（direction MVP 全部 out，不展示）
// - 统计卡：总流水 / 本月流水 / 按 type 分桶
// - 不做 server action（只读）

import Link from "next/link";
import { redirect } from "next/navigation";
import { card, th, td } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import {
  getFinanceLedgerStats,
  listFinanceLedgers,
  type FinanceLedgerType,
} from "@/src/lib/finance-ledger";

interface PageProps {
  searchParams: Promise<{
    type?: string;
    merchantId?: string;
    error?: string;
  }>;
}

const TYPE_LABEL: Record<FinanceLedgerType, string> = {
  order_commission: "订单分成",
  withdraw: "提现",
  payout: "打款",
};

const TYPE_TONE: Record<FinanceLedgerType, { bg: string; color: string }> = {
  order_commission: { bg: "#dbeafe", color: "#1e40af" },
  withdraw: { bg: "#fef3c7", color: "#92400e" },
  payout: { bg: "#dcfce7", color: "#15803d" },
};

function formatYuan(yuan: string) {
  return `¥${Number(yuan).toFixed(2)}`;
}

function parseType(v: string | undefined): FinanceLedgerType | undefined {
  if (v === "order_commission" || v === "withdraw" || v === "payout") return v;
  return undefined;
}

export default async function FinanceLedgersPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const sp = await searchParams;
  const type = parseType(sp.type);
  const merchantId = sp.merchantId?.trim() || undefined;

  // 过滤条件（只读）
  const filter = {
    ...(type ? { type } : {}),
    ...(merchantId ? { merchantId } : {}),
  };

  // 1. 列表 + 统计 + 商家下拉（并行）
  const [ledgers, stats, merchants] = await Promise.all([
    listFinanceLedgers(filter),
    getFinanceLedgerStats(merchantId ? { merchantId } : {}),
    prisma.merchant.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

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
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>财务流水</h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        共 {ledgers.length} 笔 · 订单分成{" "}
        {ledgers.filter((l) => l.type === "order_commission").length} · 提现{" "}
        {ledgers.filter((l) => l.type === "withdraw").length} · 打款{" "}
        {ledgers.filter((l) => l.type === "payout").length}
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          （事件触发：settlement.confirm / withdraw.approve / payout.create ·
          不接银行）
        </span>
      </p>

      {sp.error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          ⚠️ {sp.error}
        </div>
      )}

      {/* 统计卡 */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="总流水（out）"
          value={formatYuan(stats.totalOut)}
          bg="#dbeafe"
          color="#1e40af"
        />
        <StatCard
          label="本月流水（out）"
          value={formatYuan(stats.thisMonthOut)}
          bg="#fef3c7"
          color="#92400e"
        />
        <StatCard
          label="订单分成 Σ"
          value={formatYuan(stats.byType.order_commission)}
          bg="#dcfce7"
          color="#15803d"
        />
        <StatCard
          label="提现 + 打款 Σ"
          value={formatYuan(
            (
              Number(stats.byType.withdraw) + Number(stats.byType.payout)
            ).toFixed(2),
          )}
          bg="#fee2e2"
          color="#b91c1c"
        />
      </section>

      {/* 过滤表单 */}
      <section style={card}>
        <form
          method="get"
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 160 }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                color: "#374151",
                marginBottom: 4,
              }}
            >
              流水类型
            </label>
            <select
              name="type"
              defaultValue={type ?? ""}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                background: "#fff",
              }}
            >
              <option value="">全部</option>
              <option value="order_commission">订单分成</option>
              <option value="withdraw">提现</option>
              <option value="payout">打款</option>
            </select>
          </div>

          <div style={{ flex: 2, minWidth: 200 }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                color: "#374151",
                marginBottom: 4,
              }}
            >
              商家
            </label>
            <select
              name="merchantId"
              defaultValue={merchantId ?? ""}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                background: "#fff",
              }}
            >
              <option value="">全部</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            过滤
          </button>
          <Link
            href="/finance-ledgers"
            style={{
              padding: "8px 18px",
              background: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            重置
          </Link>
        </form>
      </section>

      {/* 列表 */}
      <section style={card}>
        {ledgers.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            {type || merchantId
              ? "无匹配流水"
              : "暂无流水（确认结算/通过提现/录打款后自动生成）"}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>记账时间</th>
                <th style={th}>类型</th>
                <th style={th}>方向</th>
                <th style={th}>商家</th>
                <th style={th}>金额</th>
                <th style={th}>源单 ID</th>
                <th style={th}>备注</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.map((l) => {
                const tone = TYPE_TONE[l.type as FinanceLedgerType];
                return (
                  <tr key={l.id} id={l.id}>
                    <td style={td}>
                      <div style={{ fontSize: 13 }}>
                        {l.createdAt.toLocaleString("zh-CN")}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>
                        id: {l.id.slice(0, 12)}…
                      </div>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500,
                          background: tone?.bg ?? "#f3f4f6",
                          color: tone?.color ?? "#374151",
                        }}
                      >
                        {TYPE_LABEL[l.type as FinanceLedgerType] ?? l.type}
                      </span>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          fontFamily: "monospace",
                        }}
                      >
                        {l.direction}
                      </span>
                    </td>
                    <td style={td}>
                      <Link
                        href={`/merchants/${l.merchantId}/edit`}
                        style={{
                          color: "#2563eb",
                          fontSize: 13,
                          textDecoration: "none",
                        }}
                      >
                        {l.merchant.name}
                      </Link>
                    </td>
                    <td
                      style={{
                        ...td,
                        color: "#b91c1c",
                        fontWeight: 600,
                        fontFamily: "monospace",
                      }}
                    >
                      -{l.amount.toString()}
                    </td>
                    <td
                      style={{
                        ...td,
                        fontSize: 12,
                        color: "#6b7280",
                        fontFamily: "monospace",
                      }}
                    >
                      {l.sourceId.slice(0, 14)}…
                    </td>
                    <td style={{ ...td, fontSize: 12, color: "#6b7280" }}>
                      {l.remark ?? <span style={{ color: "#d1d5db" }}>—</span>}
                    </td>
                  </tr>
                );
              })}
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
  bg,
  color,
}: {
  label: string;
  value: string;
  bg: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "16px 18px",
        background: "#fff",
        borderRadius: 8,
        border: "1px solid #e5e7eb",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "#6b7280",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "inline-block",
          padding: "4px 10px",
          background: bg,
          color,
          borderRadius: 6,
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}
