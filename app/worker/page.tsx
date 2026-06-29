// 师傅端 H5 — /worker
//
// [账号阶段] 2026-06-29 改造：
// - 不再通过下拉框选择师傅
// - 按当前登录 user.workerId 自动过滤该师傅的订单
// - 不登录 → middleware 跳 /login
//
// MVP 范围：
// 1. assigned → 「开始服务」按钮
// 2. in_service → 「完成订单」按钮
// 3. completed / cancelled 只展示
// 4. 无订单 → 「暂无分配订单」
// 5. mobile 友好（卡片 + 大按钮）
// 6. 顶部展示当前登录师傅名 + 退出按钮

import { redirect } from "next/navigation";
import Link from "next/link";
import { listOrdersForMaster } from "@/src/lib/worker";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { getCurrentUser } from "@/src/lib/auth";
import { WorkerOrderActions } from "./WorkerOrderActions";
import { logoutAction } from "@/app/login/actions";

export default async function WorkerPage() {
  // 1. 当前登录 user（worker 角色）
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/worker");
  }
  if (user.role !== "worker") {
    // 非 worker 角色不该到这（middleware 已挡，但兜底）
    redirect("/dashboard");
  }
  if (!user.workerId) {
    // worker 账号没绑 Master（数据异常）
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

  // 2. 拉当前师傅的订单（按 workerId 强过滤）
  const orders = await listOrdersForMaster(user.workerId);

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
          <button type="submit" style={logoutBtnStyle}>
            退出
          </button>
        </form>
      </header>

      {/* 订单列表 */}
      {orders.length === 0 ? (
        <div style={emptyStyle}>暂无分配订单</div>
      ) : (
        <div>
          <div
            style={{
              fontSize: 13,
              color: "#6b7280",
              marginBottom: 12,
              paddingLeft: 4,
            }}
          >
            我的订单 · 共 {orders.length} 单
          </div>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 单个订单卡片 ----------

function OrderCard({
  order,
}: {
  order: Awaited<ReturnType<typeof listOrdersForMaster>>[number];
}) {
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
        <WorkerOrderActions orderId={order.id} status={order.status} />
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

const emptyStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 40,
  textAlign: "center",
  color: "#9ca3af",
  fontSize: 14,
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
