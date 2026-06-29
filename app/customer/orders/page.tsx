// 用户端查询订单 — /customer/orders
//
// [账号阶段] 2026-06-29 改造：
// - 不再通过 ?phone= 查询
// - 登录后按 user.phone 自动展示该手机号的所有订单
// - 未登录 → middleware 跳 /login
//
// MVP 范围：
// 1. 展示订单号 / 服务 / 服务品类 / 状态 / 预约时间 / 金额 / 师傅名 / 备注
// 2. 状态用中文徽标（复用 /orders 的 ORDER_TONE + StatusBadge）
// 3. 空状态「暂无订单」
//
// 设计：
// - 用 server component 直接查 DB（不再走 URL query）
// - 隐私：演示期登录后只能看自己的 phone；上线前再加订单 userId 字段做硬过滤

import Link from "next/link";
import { redirect } from "next/navigation";
import { listOrdersForCustomerPhone } from "@/src/lib/customer";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { getCurrentUser } from "@/src/lib/auth";
import { logoutAction } from "@/app/login/actions";

export default async function CustomerOrdersPage() {
  // 1. 登录用户
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/customer/orders");
  }
  if (user.role !== "customer") {
    redirect("/dashboard");
  }
  if (!user.phone) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1>账号未绑定手机号</h1>
          <p style={{ color: "#6b7280" }}>
            当前账号 <code>{user.name}</code> 是 customer 角色，但未绑定手机号。
            <br />
            请联系管理员。
          </p>
        </div>
      </div>
    );
  }

  // 2. 查该手机号的订单
  const orders = await listOrdersForCustomerPhone(user.phone);

  // 时间格式
  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div style={pageStyle}>
      {/* 极简顶部 — 下单链接 + 退出 */}
      <header style={headerStyle}>
        <Link
          href="/customer"
          style={{
            fontSize: 13,
            color: "#2563eb",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
          }}
        >
          ← 下单
        </Link>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          登录：<code>{user.name}</code>
        </div>
        <form action={logoutAction}>
          <button type="submit" style={logoutBtnStyle}>
            退出
          </button>
        </form>
      </header>

      {/* 查询结果 */}
      {orders.length === 0 ? (
        <div style={emptyStyle}>暂无订单</div>
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
            {user.phone} 的订单 · 共 {orders.length} 单
          </div>
          {orders.map((o) => (
            <div
              key={o.id}
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
                  marginBottom: 10,
                  paddingBottom: 10,
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <div style={{ fontSize: 13, color: "#6b7280" }}>{o.id}</div>
                <StatusBadge
                  label={ORDER_STATUS_LABEL[o.status]}
                  tone={ORDER_TONE[o.status]}
                />
              </div>

              <Field label="服务品类" value={o.serviceCategoryName ?? "—"} />
              <Field label="服务" value={o.serviceName} />
              <Field label="金额" value={`¥${o.amountYuan.toFixed(2)}`} />
              <Field label="预约时间" value={formatDateTime(o.scheduledAt)} />
              <Field
                label="分配师傅"
                value={o.technicianName ?? "—（未派单）"}
              />
              {o.remark ? <Field label="备注" value={o.remark} /> : null}
              <Field label="下单时间" value={formatDateTime(o.createdAt)} />
            </div>
          ))}
        </div>
      )}
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
          width: 72,
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
