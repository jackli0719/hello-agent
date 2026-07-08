// /admin/metrics — 业务指标快照（演示版）。
//
// 设计：
// - 后台管理页，受 middleware 保护（需登录）
// - 显示内存计数器（订单创建/派单/状态流转的成功失败数）
// - 显示 uptime + 当前时间
// - 不实时刷新（演示版手动 reload 即可）
// - 进程重启会清零（dev HMR 也是预期行为）

import { getMetricsSnapshot } from "@/src/lib/metrics";

export const dynamic = "force-dynamic"; // 不缓存，每次拿实时数据

export default function AdminMetricsPage() {
  const snapshot = getMetricsSnapshot();
  const counters = snapshot.counters;

  // 分组：按业务事件分组
  const groups: {
    title: string;
    items: { name: string; value: number; tone?: "success" | "failed" }[];
  }[] = [
    {
      title: "订单创建",
      items: [
        {
          name: "成功",
          value: counters["order.create.success"] ?? 0,
          tone: "success",
        },
        {
          name: "失败",
          value: counters["order.create.failed"] ?? 0,
          tone: "failed",
        },
      ],
    },
    {
      title: "派单",
      items: [
        {
          name: "成功",
          value: counters["order.assign.success"] ?? 0,
          tone: "success",
        },
        {
          name: "失败",
          value: counters["order.assign.failed"] ?? 0,
          tone: "failed",
        },
      ],
    },
    {
      title: "状态流转 — 开始服务",
      items: [
        {
          name: "成功",
          value: counters["order.transition.success.in_service"] ?? 0,
          tone: "success",
        },
        {
          name: "失败",
          value: counters["order.transition.failed.in_service"] ?? 0,
          tone: "failed",
        },
      ],
    },
    {
      title: "状态流转 — 完成订单",
      items: [
        {
          name: "成功",
          value: counters["order.transition.success.completed"] ?? 0,
          tone: "success",
        },
        {
          name: "失败",
          value: counters["order.transition.failed.completed"] ?? 0,
          tone: "failed",
        },
      ],
    },
    {
      title: "状态流转 — 取消订单",
      items: [
        {
          name: "成功",
          value: counters["order.transition.success.cancelled"] ?? 0,
          tone: "success",
        },
        {
          name: "失败",
          value: counters["order.transition.failed.cancelled"] ?? 0,
          tone: "failed",
        },
      ],
    },
  ];

  // 成功率 = success / (success + failed)（分母为 0 → -）
  const rate = (success: number, failed: number): string => {
    const total = success + failed;
    if (total === 0) return "—";
    return `${((success / total) * 100).toFixed(1)}%`;
  };

  return (
    <main
      style={{
        padding: "32px 48px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>业务指标</h1>
      <p style={{ color: "#6b7280", margin: "0 0 8px 0", fontSize: 13 }}>
        演示版用内存计数器（dev HMR / 进程重启会清零） · 生产前应替换为
        Prometheus / OpenTelemetry
      </p>
      <p style={{ color: "#9ca3af", margin: "0 0 24px 0", fontSize: 12 }}>
        快照时间 {snapshot.ts} · 进程 uptime {snapshot.uptimeSec}s
      </p>

      {/* 指标卡片 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {groups.map((g) => {
          const success = g.items.find((i) => i.tone === "success")?.value ?? 0;
          const failed = g.items.find((i) => i.tone === "failed")?.value ?? 0;
          return (
            <section
              key={g.title}
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 16,
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                {g.title}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{ fontSize: 24, fontWeight: 600, color: "#15803d" }}
                >
                  {success}
                </span>
                <span style={{ fontSize: 13, color: "#9ca3af" }}>成功</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{ fontSize: 14, fontWeight: 500, color: "#b91c1c" }}
                >
                  {failed}
                </span>
                <span style={{ fontSize: 13, color: "#9ca3af" }}>失败</span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                成功率 {rate(success, failed)}
              </div>
            </section>
          );
        })}
      </div>

      {/* 完整 counters 列表（调试用） */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 20,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0" }}>
          完整计数器（{Object.keys(counters).length} 项）
        </h2>
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
