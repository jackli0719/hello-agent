// 师傅端 H5 — /worker
//
// [v0.7.0] 改造为按状态分组展示：
// 1. 待服务 (assigned)
// 2. 服务中 (in_service)
// 3. 已完成 (completed)
// 4. 已取消 (cancelled)
//
// 设计：
// - 4 分组卡片，每组显示数量
// - 不显示 pending（未派单）
// - 操作按钮按状态：
//   - assigned → 「开始服务」
//   - in_service → 「完成订单」
//   - completed / cancelled → 只展示，不允许操作
// - mobile 友好（卡片 + 大按钮）
// - 顶部展示当前登录师傅名 + 退出

import { redirect } from "next/navigation";
import Link from "next/link";
import { listOrdersForMaster, type WorkerOrder } from "@/src/lib/worker";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { getCurrentUser } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { WorkerOrderActions } from "./WorkerOrderActions";
import { logoutAction } from "@/app/login/actions";
import type { OrderStatus } from "@/src/types";

// 4 个分组的展示顺序 = 业务流转顺序
const GROUP_ORDER: { value: OrderStatus; label: string; empty: string }[] = [
  { value: "assigned", label: "待服务", empty: "暂无待服务订单" },
  { value: "in_service", label: "服务中", empty: "暂无服务中订单" },
  { value: "completed", label: "已完成", empty: "暂无已完成订单" },
  { value: "cancelled", label: "已取消", empty: "暂无已取消订单" },
];

// 分组头部颜色 — 跟 ORDER_TONE 区分（按业务重要性配色）
const GROUP_HEADER_TONE: Record<
  OrderStatus,
  { bg: string; border: string; text: string }
> = {
  assigned: { bg: "#fef3c7", border: "#fcd34d", text: "#92400e" },
  in_service: { bg: "#dbeafe", border: "#93c5fd", text: "#1e40af" },
  completed: { bg: "#dcfce7", border: "#86efac", text: "#166534" },
  cancelled: { bg: "#f3f4f6", border: "#d1d5db", text: "#6b7280" },
  pending: { bg: "#f3f4f6", border: "#d1d5db", text: "#6b7280" },
};

export default async function WorkerPage() {
  // 1. 当前登录 user（worker 角色）
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/worker");
  }
  if (user.role !== "worker") {
    redirect("/dashboard");
  }
  // [v0.7.2] RSC 阶段确保 csrf cookie 存在（logout 校验需要）
  const csrfToken = await ensureCsrfCookie();
  if (!user.workerId) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1>账号未绑定师傅</h1>
          <p style={{ color: "#6b7280" }}>
            当前账号 <code>{user.name}</code> 是 worker 角色，但未绑定 Master。
            <br />
            请联系管理员。
          </p>
        </div>
      </div>
    );
  }

  // 2. 拉当前师傅的订单（按 workerId 强过滤；排除 pending）
  const orders = await listOrdersForMaster(user.workerId);

  // 3. 按状态分组
  const grouped: Record<OrderStatus, WorkerOrder[]> = {
    pending: [],
    assigned: [],
    in_service: [],
    completed: [],
    cancelled: [],
  };
  for (const o of orders) {
    grouped[o.status].push(o);
  }

  return (
    <div style={pageStyle}>
      {/* 极简顶部 — 师傅名 + 退出 */}
      <header style={headerStyle}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>师傅端</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            登录：<code>{user.name}</code>
            {user.phone ? ` · ${user.phone.slice(-4)}` : ""}
          </div>
        </div>
        <form action={logoutAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" style={logoutBtnStyle}>
            退出
          </button>
        </form>
      </header>

      {/* 4 分组展示 */}
      {GROUP_ORDER.map((g) => {
        const list = grouped[g.value];
        const tone = GROUP_HEADER_TONE[g.value];
        return (
          <section key={g.value} style={groupSectionStyle}>
            {/* 分组标题 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                padding: "8px 12px",
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: tone.text,
                }}
              >
                {g.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: tone.text,
                  fontWeight: 500,
                }}
              >
                共 {list.length} 单
              </div>
            </div>

            {/* 分组内订单 */}
            {list.length === 0 ? (
              <div style={groupEmptyStyle}>{g.empty}</div>
            ) : (
              list.map((o) => <OrderCard key={o.id} order={o} />)
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- 单个订单卡片 ----------

function OrderCard({ order }: { order: WorkerOrder }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "#6b7280" }}>{order.id}</div>
        <StatusBadge
          label={ORDER_STATUS_LABEL[order.status]}
          tone={ORDER_TONE[order.status]}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <Field label="客户" value={order.customerName} />
        <Field label="手机" value={order.customerPhone} />
        <Field label="地址" value={order.address} />
        <Field label="服务" value={order.serviceName} />
        <Field label="金额" value={`¥${order.amountYuan.toFixed(2)}`} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* [v0.7.0] 操作按钮按状态：completed/cancelled 只展示不操作 */}
        {order.status === "assigned" || order.status === "in_service" ? (
          <WorkerOrderActions orderId={order.id} status={order.status} />
        ) : (
          <div style={readonlyHintStyle}>
            ✓ {ORDER_STATUS_LABEL[order.status]}（不可再操作）
          </div>
        )}
        <Link
          href={`/worker/orders/${encodeURIComponent(order.id)}`}
          style={{
            display: "block",
            textAlign: "center",
            padding: "12px 16px",
            background: "#fff",
            color: "#2563eb",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          查看详情 →
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: 14,
        lineHeight: 1.6,
        padding: "2px 0",
      }}
    >
      <div
        style={{
          color: "#6b7280",
          width: 56,
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        {label}
      </div>
      <div style={{ color: "#111827", flex: 1, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}

// ---------- 样式 ----------

const pageStyle: React.CSSProperties = {
  minHeight: "calc(100vh - 56px)",
  background: "#f7f8fa",
  padding: "16px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  color: "#111827",
  maxWidth: 640,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "12px 16px",
  marginBottom: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const groupSectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const groupEmptyStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "20px 16px",
  textAlign: "center",
  color: "#9ca3af",
  fontSize: 13,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 32,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const logoutBtnStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
};

const readonlyHintStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#f9fafb",
  color: "#6b7280",
  borderRadius: 6,
  fontSize: 13,
  textAlign: "center",
};
