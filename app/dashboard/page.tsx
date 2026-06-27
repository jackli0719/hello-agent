// /dashboard — 第一版 MVP 收口页。
//
// 8 个核心统计卡 + 引导操作清单。
// 全部从 DB 读，DB 一变 dashboard 自动反映。

import Link from "next/link";
import { countOrdersByStatus } from "@/src/lib/repos/orders";
import { listMasters } from "@/src/lib/repos/masters";
import { listEnabledServices } from "@/src/lib/repos/services";
import { listRules } from "@/src/lib/dispatch-rules";

export default async function DashboardPage() {
  const [counts, masters, services, rules] = await Promise.all([
    countOrdersByStatus(),
    listMasters(),
    listEnabledServices(),
    listRules(),
  ]);

  const availableTechs = masters.filter((m) => m.status === "available").length;
  const enabledRules = rules.filter((r) => r.enabled).length;

  const stats: { label: string; value: number; href: string; hint?: string }[] = [
    { label: "订单总数", value: counts.all, href: "/orders" },
    { label: "待派单", value: counts.pending, href: "/orders?status=pending" },
    { label: "已派单", value: counts.assigned, href: "/orders?status=assigned" },
    { label: "服务中", value: counts.in_service, href: "/orders?status=in_service" },
    { label: "已完成", value: counts.completed, href: "/orders?status=completed" },
    { label: "可接单师傅", value: availableTechs, href: "/masters" },
    { label: "服务 SKU", value: services.length, href: "/services" },
    { label: "派单规则", value: rules.length, href: "/dispatch-rules", hint: `${enabledRules} 启用` },
  ];

  return (
    <main
      style={{
        padding: "32px 48px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: 28, margin: "0 0 4px 0" }}>Dashboard</h1>
      <p style={{ color: "#6b7280", margin: "0 0 24px 0", fontSize: 14 }}>
        第一版 MVP 收口页 — 所有数据来自 SQLite 实时统计
      </p>

      {/* 8 个统计卡（点击跳到对应列表页） */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            style={{
              display: "block",
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 20,
              textDecoration: "none",
              color: "inherit",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 600, color: "#111827" }}>{s.value}</div>
            {s.hint && <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>{s.hint}</div>}
          </Link>
        ))}
      </section>

      {/* 演示链路指引 — 让用户知道下一步能做什么 */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 20,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0" }}>演示链路</h2>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 12px 0" }}>
          完整的「服务配置 → 师傅配置 → 规则配置 → 订单创建 → 派单 → 状态流转」链路：
        </p>
        <ol style={{ paddingLeft: 20, margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.8 }}>
          <li>
            <Link href="/services/skus/new" style={{ color: "#2563eb" }}>新增服务 SKU</Link>（如「空调维修」）
          </li>
          <li>
            <Link href="/masters/new" style={{ color: "#2563eb" }}>新增师傅</Link>（技能包含「空调维修」）
          </li>
          <li>
            <Link href="/dispatch-rules/new" style={{ color: "#2563eb" }}>新增派单规则</Link>（SKU 精确匹配 + 技能要求「空调维修」）
          </li>
          <li>
            <Link href="/orders/new" style={{ color: "#2563eb" }}>创建订单</Link>（选刚才的 SKU）
          </li>
          <li>回 <Link href="/orders" style={{ color: "#2563eb" }}>订单列表</Link>，pending 行点击「派给他」</li>
          <li>订单变「已派单」→ 点击「开始服务」</li>
          <li>订单变「服务中」→ 点击「完成订单」</li>
        </ol>
      </section>

      {/* 订单状态机 */}
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
          订单状态机
        </h2>
        <pre
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: 14,
            fontSize: 12,
            lineHeight: 1.6,
            color: "#374151",
            overflowX: "auto",
            margin: 0,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >{`  ┌─────────┐  派单   ┌──────────┐ 开始服务 ┌───────────┐ 完成 ┌──────────┐
  │ 待派单  │ ──────→ │ 已派单   │ ──────→ │ 服务中    │ ───→ │ 已完成   │
  │ pending │         │ assigned │         │ in_service│      │ completed│
  └─────────┘         └──────────┘         └───────────┘      └──────────┘
       │                    │                     │
       │ 取消                │ 取消                 │ 取消
       ↓                    ↓                     ↓
  ┌─────────────────────────────────────────────────────┐
  │ 已取消  cancelled（终态，不可再变）                    │
  └─────────────────────────────────────────────────────┘

派单/开始服务/完成 都在订单行操作；状态变更用乐观锁防并发。
completed / cancelled 是终态 — UI 上不再有按钮。`}</pre>
      </section>
    </main>
  );
}