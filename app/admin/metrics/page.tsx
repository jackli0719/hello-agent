// /admin/metrics — [任务 22] 数据看板 + 业务计数器调试表
//
// 设计：
// - 顶部：6 张业务指标卡（GMV / 订单量 / 完单率 / 退款率 / 商家收入 / 平台抽成）
// - 中部：2 chip 切换窗口（全部 / 本月）
// - 底部：原内存计数器调试表（Prometheus 替代品职责，保留）
// - server component + 动态渲染（每次重新聚合）
// - admin only（middleware 已保护）

import Link from "next/link";
import { getMetricsSnapshot } from "@/src/lib/metrics";
import { getDashboardMetrics, type DashboardWindow } from "@/src/lib/dashboard";

export const dynamic = "force-dynamic"; // 不缓存，每次拿实时数据

function formatYuan(yuan: number): string {
  return `¥${yuan.toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

interface PageProps {
  searchParams: Promise<{ window?: string }>;
}

export default async function AdminMetricsPage({ searchParams }: PageProps) {
  // 1. 取 window chip 参数（默认 all）
  const params = await searchParams;
  const window: DashboardWindow =
    params.window === "thisMonth" ? "thisMonth" : "all";

  // 2. 聚合 6 指标
  const metrics = await getDashboardMetrics(window);

  // 3. 计数器调试表
  const snapshot = getMetricsSnapshot();
  const counters = snapshot.counters;

  return (
    <main
      style={{
        padding: "32px 48px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>数据看板</h1>
      <p style={{ color: "#6b7280", margin: "0 0 8px 0", fontSize: 13 }}>
        全局 6 指标 · 直查 Prisma · 演示期数据量小（20 订单）一次聚合亚毫秒
      </p>

      {/* 窗口切换 chip */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          alignItems: "center",
        }}
      >
        <span style={{ color: "#6b7280", fontSize: 13 }}>时间窗口：</span>
        <ChipLink href="/admin/metrics?window=all" active={window === "all"}>
          全部
        </ChipLink>
        <ChipLink
          href="/admin/metrics?window=thisMonth"
          active={window === "thisMonth"}
        >
          本月
        </ChipLink>
      </div>

      {/* 6 张指标卡 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <MetricCard
          label="GMV"
          value={formatYuan(metrics.gmvYuan)}
          hint="已支付且已完成订单金额"
        />
        <MetricCard
          label="订单量"
          value={`${metrics.orderCount}`}
          hint="所有订单总数"
        />
        <MetricCard
          label="完单率"
          value={formatPercent(metrics.completionRate)}
          hint="已完成 / (已完成 + 已取消)"
        />
        <MetricCard
          label="退款率"
          value={formatPercent(metrics.refundRate)}
          hint="已退款 / (已支付 + 已退款)"
        />
        <MetricCard
          label="商家收入"
          value={formatYuan(metrics.merchantIncomeYuan)}
          hint="已完成订单的商家分成"
        />
        <MetricCard
          label="平台抽成"
          value={formatYuan(metrics.platformFeeYuan)}
          hint="已完成订单的平台分成"
        />
      </div>

      {/* 口径说明 */}
      <section
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 8,
          padding: 12,
          marginBottom: 32,
          fontSize: 12,
          color: "#78350f",
        }}
      >
        <strong>口径说明</strong>
        <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>
            GMV = status=completed 且 payStatus=paid 的 Order.amount 之和（按
            paidAt 时间窗）
          </li>
          <li>
            完单率分母 = 已完成 + 已取消（终态订单）；退款率分母 = 已支付 +
            已退款（订单进入支付才可能被退款）
          </li>
          <li>
            商家收入 + 平台抽成 = SettlementPreview
            三方分成快照（每张完成订单生成 1 条）
          </li>
          <li>
            演示期 seed 全在 2026-06，本月窗口（演示期 = 2026-07）通常 = 0 订单
          </li>
        </ul>
      </section>

      {/* 完整 counters 列表（调试用 — Prometheus 占位） */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 20,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px 0" }}>
          业务事件计数器（{Object.keys(counters).length} 项）
        </h2>
        <p style={{ color: "#9ca3af", fontSize: 12, margin: "0 0 12px 0" }}>
          演示版用内存计数器（dev HMR / 进程重启会清零） · 生产前应替换为
          Prometheus / OpenTelemetry · 快照时间 {snapshot.ts} · 进程 uptime{" "}
          {snapshot.uptimeSec}s
        </p>
        {Object.keys(counters).length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>
            还没有事件 — 跑一次完整 DEMO（用户下单 → 后台派单 → 师傅履约 →
            用户查询）就能看到计数累加
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>指标名</th>
                <th style={{ ...th, textAlign: "right" }}>值</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(counters)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, value]) => (
                  <tr key={name}>
                    <td style={td}>
                      <code style={{ fontSize: 12 }}>{name}</code>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>
                      {value}
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

// ============================================================
// 子组件
// ============================================================

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: "#111827" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>{hint}</div>
    </section>
  );
}

function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: 13,
        textDecoration: "none",
        background: active ? "#111827" : "#fff",
        color: active ? "#fff" : "#374151",
        border: active ? "1px solid #111827" : "1px solid #d1d5db",
      }}
    >
      {children}
    </Link>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#fafafa",
  fontSize: 12,
  color: "#374151",
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f0f0f0",
  fontSize: 13,
  color: "#111827",
};
