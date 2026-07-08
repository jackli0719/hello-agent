import Link from "next/link";
import { redirect } from "next/navigation";
import { card, th, td } from "@/components/ui";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import {
  listWorkerSettlements,
  listWorkerSettlementPeriods,
} from "@/src/lib/worker-settlement";
import { prisma } from "@/src/lib/db";
import { generateWorkerSettlementsAction } from "./actions";
import { FilterSelect } from "./_filters";

interface PageProps {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    upserted?: string;
    error?: string;
    period?: string;
    workerId?: string;
  }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function WorkerSettlementsPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const {
    created,
    updated,
    upserted,
    error,
    period: filterPeriod,
    workerId: filterWorkerId,
  } = await searchParams;

  // 4 个并行查询
  const [csrfToken, allRows, periodOptions, allWorkers] = await Promise.all([
    ensureCsrfCookie(),
    listWorkerSettlements(),
    listWorkerSettlementPeriods(),
    // 师傅下拉：所有有 SettlementPreview 的 worker（避免空 worker 占位）
    prisma.master.findMany({
      where: { workerSettlements: { some: {} } },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // 应用筛选
  const rows = allRows.filter((r) => {
    if (filterPeriod && r.period !== filterPeriod) return false;
    if (filterWorkerId && r.workerId !== filterWorkerId) return false;
    return true;
  });

  // 全局汇总（4 列 StatCard）
  const totalWorkers = new Set(allRows.map((r) => r.workerId)).size;
  const totalOrderCount = allRows.reduce((s, r) => s + r.orderCount, 0);
  const totalAmount = allRows.reduce((s, r) => s + r.totalAmount, 0);
  const totalWorkerIncome = allRows.reduce((s, r) => s + r.workerIncome, 0);

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
      {/* 头部：标题 + 生成按钮 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
            师傅结算汇总
          </h1>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
            按师傅 × 月份汇总收入（仅展示，不提现、不打款）
          </p>
        </div>
        <form action={generateWorkerSettlementsAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            data-testid="generate-worker-settlements"
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              letterSpacing: "0.01em",
            }}
          >
            生成汇总
          </button>
        </form>
      </div>

      {/* 提示信息 */}
      {created !== undefined && (
        <div
          data-testid="generate-result"
          style={{
            padding: "10px 16px",
            marginBottom: 16,
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: 6,
            color: "#065f46",
            fontSize: 13,
          }}
        >
          ✅ 已生成：新建 {created} 条 / 更新 {updated} 条 / 共 {upserted} 条
        </div>
      )}
      {error && (
        <div
          style={{
            padding: "10px 16px",
            marginBottom: 16,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* 4 列 StatCard 全局汇总 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard label="参与师傅数" value={`${totalWorkers}`} unit="人" />
        <StatCard label="订单总数" value={`${totalOrderCount}`} unit="单" />
        <StatCard label="订单总金额" value={formatYuan(totalAmount)} />
        <StatCard
          label="师傅总收入"
          value={formatYuan(totalWorkerIncome)}
          highlight
        />
      </div>

      {/* 过滤栏 */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          padding: 12,
          background: "#fff",
          border: "1px solid #dee2e6",
          borderRadius: 6,
        }}
      >
        <span style={{ fontSize: 13, color: "#6b7280" }}>筛选：</span>
        <FilterSelect
          paramKey="period"
          placeholder="全部月份"
          options={periodOptions.map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          paramKey="workerId"
          placeholder="全部师傅"
          minWidth={200}
          options={allWorkers.map((w) => ({
            value: w.id,
            label: `${w.name}（${w.phone}）`,
          }))}
        />

        {(filterPeriod || filterWorkerId) && (
          <Link
            href="/master-settlements"
            style={{
              fontSize: 13,
              color: "#2563eb",
              textDecoration: "none",
              marginLeft: "auto",
            }}
          >
            清除筛选
          </Link>
        )}
      </div>

      {/* 主表 */}
      <div
        style={{
          ...card,
          padding: 0,
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead style={{ background: "#f8f9fb" }}>
            <tr>
              <th style={th}>期间</th>
              <th style={th}>师傅</th>
              <th style={th}>师傅手机</th>
              <th style={{ ...th, textAlign: "right" }}>订单数</th>
              <th style={{ ...th, textAlign: "right" }}>订单总金额</th>
              <th style={{ ...th, textAlign: "right" }}>师傅收入</th>
              <th style={th}>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...td,
                    textAlign: "center",
                    padding: "32px 16px",
                    color: "#9ca3af",
                  }}
                >
                  {allRows.length === 0
                    ? "暂无数据 — 点击右上角「生成汇总」按钮开始"
                    : "当前筛选条件下无数据"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #f1f3f5" }}>
                  <td style={td}>
                    <span
                      style={{
                        padding: "2px 8px",
                        background: "#e7f1ff",
                        color: "#1e40af",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {r.period}
                    </span>
                  </td>
                  <td style={td}>{r.worker.name}</td>
                  <td style={{ ...td, color: "#6b7280" }}>{r.worker.phone}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.orderCount}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {formatYuan(r.totalAmount)}
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontWeight: 600,
                      color: "#1e40af",
                    }}
                  >
                    {formatYuan(r.workerIncome)}
                  </td>
                  <td style={{ ...td, color: "#6b7280", fontSize: 12 }}>
                    {new Date(r.updatedAt).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        ...card,
        background: highlight ? "#eff6ff" : "#fff",
        border: highlight ? "1px solid #bfdbfe" : "1px solid #dee2e6",
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: highlight ? "#1e40af" : "#111827",
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "#6b7280" }}>{unit}</span>}
      </div>
    </div>
  );
}
