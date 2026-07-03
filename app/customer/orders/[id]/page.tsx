// 用户端订单详情页 — /customer/orders/[id]
//
// [v0.7.5] 任务：用户端订单详情页
//
// 设计：
// - RSC 直接查 DB（按 customerPhone 过滤 = 越权防护）
// - 订单不属于该 phone → 跳回列表 + 提示
// - 状态文案按 4 种状态分：
//   - pending: 「等待后台派单」
//   - assigned / in_service / completed / cancelled: 不同文案
// - 已派单展示师傅姓名 + 手机号
//
// 隐私/越权（CLAUDE.md P0-1）：
// - customerPhone 校验放在查询层（getOrderForCustomer）—— 不靠 UI 隐藏
// - 不告诉调用方「订单存在 / 不存在」—— 统一跳回列表

import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrderForCustomer } from "@/src/lib/customer";
import { getCurrentUser } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { customerCancelOrderAction } from "@/app/orders/actions";
import { CancelForm } from "@/components/CancelForm";
import { PayForm } from "./PayForm";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import type { OrderStatus, PayStatus } from "@/src/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

// 状态文案 — 按业务规则
// [任务 X] payStatus 区分: status=pending + payStatus=unpaid → 待支付
//         status=pending + payStatus=paid   → 待派单
function statusHint(status: OrderStatus, payStatus: PayStatus): string {
  if (status === "pending" && payStatus === "unpaid") {
    return "订单待支付 — 完成支付后将进入待派单";
  }
  switch (status) {
    case "pending":
      return "已支付,等待后台派单";
    case "assigned":
      return "已派单,师傅即将联系您";
    case "in_service":
      return "师傅正在服务中";
    case "completed":
      return "服务已完成";
    case "cancelled":
      return "订单已取消";
  }
}

// 时间格式
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function CustomerOrderDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 1. 登录用户
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=/customer/orders/${encodeURIComponent(id)}`);
  }
  // [v0.7.9] RSC 阶段确保 csrf cookie 存在（用户取消按钮需要）
  const csrfToken = await ensureCsrfCookie();
  if (user.role !== "customer" || !user.phone) {
    redirect("/customer/orders");
  }

  // 2. 查订单（越权防护在 query 层 — phone 不匹配返 null）
  const order = await getOrderForCustomer(id, user.phone);
  if (!order) {
    // 订单不存在 / 不属于该 phone → 跳回列表
    redirect("/customer/orders?error=not_found");
  }

  return (
    <div style={pageStyle}>
      {/* 顶部 — 返回列表 + 登录信息 + 退出（与列表页一致） */}
      <header style={headerStyle}>
        <Link
          href="/customer/orders"
          style={{
            fontSize: 13,
            color: "#2563eb",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
          }}
        >
          ← 返回订单列表
        </Link>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          登录：<code>{user.name}</code>
        </div>
      </header>

      {/* 订单主卡 — 顶部订单号 + 状态 */}
      <section style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>订单号</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
              {order.id}
            </div>
          </div>
          <StatusBadge
            label={ORDER_STATUS_LABEL[order.status]}
            tone={ORDER_TONE[order.status]}
          />
        </div>

        {/* 状态文案 — 按业务规则分 */}
        <div
          style={{
            padding: "10px 14px",
            background: "#f9fafb",
            borderRadius: 6,
            color: "#374151",
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {statusHint(order.status, order.payStatus)}
        </div>

        {/* 客户信息 */}
        <SectionTitle title="客户信息" />
        <Field label="姓名" value={order.customerName} />
        <Field label="手机" value={order.customerPhone || "—"} />
        <Field label="地址" value={order.address || "—"} />

        {/* 服务信息 */}
        <SectionTitle title="服务信息" />
        <Field label="服务品类" value={order.serviceCategoryName ?? "—"} />
        <Field label="服务 SKU" value={order.serviceName} />
        <Field label="金额" value={`¥${order.amountYuan.toFixed(2)}`} />
        <Field label="预约时间" value={formatDateTime(order.scheduledAt)} />
        {/* [v0.7.6] 用户备注 — 改空态显示「暂无备注」+ 加 serviceSummary 展示 */}
        <Field
          label="问题描述 / 备注"
          value={order.remark?.trim() ? order.remark : "暂无备注"}
        />
        {order.serviceSummary?.trim() ? (
          <Field label="服务完成说明" value={order.serviceSummary} />
        ) : null}

        {/* [v0.7.9] 取消信息（cancelled 状态展示）*/}
        {order.status === "cancelled" && order.cancelReason ? (
          <Field label="取消原因" value={order.cancelReason} />
        ) : null}
        {order.status === "cancelled" && order.canceledAt ? (
          <Field label="取消时间" value={formatDateTime(order.canceledAt)} />
        ) : null}

        {/* 师傅信息 — 仅在已派单时显示 */}
        {order.technicianName ? (
          <>
            <SectionTitle title="已分配师傅" />
            <Field label="姓名" value={order.technicianName} />
            {order.technicianPhone ? (
              <Field label="手机" value={order.technicianPhone} />
            ) : null}
          </>
        ) : null}

        {/* 时间戳 */}
        <SectionTitle title="时间信息" />
        <Field label="下单时间" value={formatDateTime(order.createdAt)} />

        {/* [v0.7.9] 用户取消按钮 — 仅 pending 状态（业务规则 #10）
            [任务 X] 支付按钮 — 仅 payStatus=unpaid 时显示 */}
        {order.status === "pending" && (
          <div style={{ marginTop: 16 }}>
            <SectionTitle title="操作" />
            {order.payStatus === "unpaid" ? (
              <PayForm
                orderId={order.id}
                csrfToken={csrfToken}
                amountYuan={order.amountYuan}
              />
            ) : null}
            <CancelForm
              orderId={order.id}
              formAction={customerCancelOrderAction}
              csrfToken={csrfToken}
              buttonLabel="确认取消订单"
            />
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "#374151",
        marginTop: 14,
        marginBottom: 6,
        paddingBottom: 4,
        borderBottom: "1px dashed #e5e7eb",
      }}
    >
      {title}
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
        padding: "3px 0",
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

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 20,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};
