// [任务 21] 售后工单 — admin 详情页 /admin/after-sales/[id]
//
// 设计：
// - RSC 拉 Order + after-sales 详情（复用现有 customer/merchant 路径的反向）
// - 展示客户 + 服务 + 售后详情（afterSalesStatus/Reject/Handled）
// - 3 操作按钮（按当前状态显隐）：
//   1. "开始处理" — pending → processing（client component 调 adminStartProcessingAction）
//   2. "已解决" — processing → resolved（带可选 note）
//   3. "拒绝" — pending/processing → rejected（必填 rejectReason）
//
// 越权：admin 专属（middleware 已挡，server action 兜底）

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { AfterSalesCard } from "@/app/customer/orders/[id]/AfterSalesCard";
import { StartProcessingButton } from "./StartProcessingButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDateTime(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function AdminAfterSalesDetailPage({ params }: PageProps) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=/admin/after-sales/${encodeURIComponent(id)}`);
  }
  if (user.role !== "admin") {
    redirect("/");
  }
  const csrfToken = await ensureCsrfCookie();

  // 拉订单 + afterSales 字段
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      serviceName: true,
      masterName: true,
      amount: true,
      payStatus: true,
      status: true,
      afterSalesStatus: true,
      afterSalesReason: true,
      afterSalesRejectReason: true,
      afterSalesHandledBy: true,
      afterSalesHandledAt: true,
      remark: true,
      internalRemark: true,
      cancelReason: true,
      serviceSummary: true,
      scheduledAt: true,
      address: true,
      createdAt: true,
    },
  });
  if (!order || order.afterSalesStatus === null) {
    // 订单不存在 / 未发起售后 → 列表
    redirect("/admin/after-sales?error=not_found");
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link
          href="/admin/after-sales"
          style={{
            fontSize: 13,
            color: "#2563eb",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
          }}
        >
          ← 返回售后列表
        </Link>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          登录：<code>{user.name}</code>
        </div>
      </header>

      {/* 主卡 — 顶部订单 + 状态 */}
      <section style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>订单号</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
              {order.id}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "#374151" }}>
            <div>
              订单状态：<b>{order.status}</b>
            </div>
            <div>
              支付状态：<b>{order.payStatus}</b>
            </div>
          </div>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}
        >
          {/* 客户/订单信息 */}
          <div>
            <SectionTitle title="订单摘要" />
            <Field label="客户" value={order.customerName} />
            <Field label="手机" value={order.customerPhone || "—"} />
            <Field label="服务" value={order.serviceName} />
            <Field label="金额" value={`¥${(order.amount / 100).toFixed(2)}`} />
            <Field label="地址" value={order.address} />
            <Field label="预约" value={formatDateTime(order.scheduledAt)} />
            <Field label="师傅" value={order.masterName ?? "—"} />
          </div>

          {/* 售后详情 */}
          <div>
            <SectionTitle title="售后详情" />
            <AfterSalesCard
              status={
                order.afterSalesStatus as
                  "pending" | "processing" | "resolved" | "rejected"
              }
              reason={order.afterSalesReason}
              rejectReason={order.afterSalesRejectReason}
              handledAt={
                order.afterSalesHandledAt
                  ? order.afterSalesHandledAt.toISOString()
                  : null
              }
            />
            {/* 处理人 + 时间（admin 元信息） */}
            {order.afterSalesHandledBy ? (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  background: "#f3f4f6",
                  borderRadius: 4,
                  fontSize: 12,
                  color: "#374151",
                }}
              >
                处理人 ID：<code>{order.afterSalesHandledBy}</code>
                {order.afterSalesHandledAt ? (
                  <span style={{ marginLeft: 12 }}>
                    处理时间：{formatDateTime(order.afterSalesHandledAt)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 操作区 — 按 afterSalesStatus 显示可用操作 */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px dashed #e5e7eb",
          }}
        >
          <SectionTitle title="操作" />

          {order.afterSalesStatus === "pending" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* 1. 开始处理 — client 调 server action 走 Origin CSRF */}
              <StartProcessingButton
                orderId={order.id}
                label="开始处理"
                tone="primary"
              />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: -4 }}>
                或直接跳到下方拒绝表单（如果不需要处理则拒绝）
              </div>
              <div
                style={{
                  borderTop: "1px dashed #f0f0f0",
                  paddingTop: 14,
                  marginTop: 6,
                }}
              >
                <RejectForm
                  orderId={order.id}
                  csrfToken={csrfToken}
                  fromStatus="pending"
                />
              </div>
            </div>
          ) : null}

          {order.afterSalesStatus === "processing" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ResolveForm orderId={order.id} csrfToken={csrfToken} />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: -4 }}>
                或
              </div>
              <RejectForm
                orderId={order.id}
                csrfToken={csrfToken}
                fromStatus="processing"
              />
            </div>
          ) : null}

          {order.afterSalesStatus === "resolved" ||
          order.afterSalesStatus === "rejected" ? (
            <div
              style={{
                padding: 12,
                background: "#f9fafb",
                borderRadius: 6,
                fontSize: 13,
                color: "#6b7280",
              }}
            >
              工单已终结（{order.afterSalesStatus}），无法再操作。
              {order.afterSalesStatus === "resolved" ? (
                <div style={{ marginTop: 6, color: "#15803d" }}>
                  如需退款，请用后端&ldquo;售后退款&rdquo;按钮（独立于本流程）。
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

// ---------- 共用小组件 ----------

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "#374151",
        marginBottom: 8,
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
        fontSize: 13,
        lineHeight: 1.7,
        padding: "2px 0",
      }}
    >
      <div style={{ color: "#6b7280", width: 64, flexShrink: 0 }}>{label}</div>
      <div style={{ color: "#111827", flex: 1, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}

/**
 * &ldquo;已解决&rdquo;表单 — 含可选 note
 */
function ResolveForm({
  orderId,
  csrfToken,
}: {
  orderId: string;
  csrfToken: string;
}) {
  return (
    <form
      action={adminResolveActionWrapper}
      style={{
        padding: 12,
        background: "#f0f9ff",
        border: "1px solid #bae6fd",
        borderRadius: 6,
      }}
    >
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="orderId" value={orderId} />
      <div style={{ fontSize: 13, color: "#0c4a6e", marginBottom: 6 }}>
        标记已解决（可选填解决说明）
      </div>
      <textarea
        name="note"
        rows={2}
        placeholder="例如：已与师傅沟通，返工处理"
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: 13,
          border: "1px solid #cbd5e1",
          borderRadius: 4,
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <button
        type="submit"
        style={{
          marginTop: 6,
          padding: "6px 14px",
          fontSize: 13,
          background: "#16a34a",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ✓ 标记已解决
      </button>
    </form>
  );
}

/**
 * &ldquo;拒绝&rdquo;表单 — reason 必填
 */
function RejectForm({
  orderId,
  csrfToken,
  fromStatus,
}: {
  orderId: string;
  csrfToken: string;
  fromStatus: "pending" | "processing";
}) {
  return (
    <form
      action={adminRejectActionWrapper}
      style={{
        padding: 12,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 6,
      }}
    >
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fromStatus" value={fromStatus} />
      <div
        style={{
          fontSize: 13,
          color: "#7f1d1d",
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        拒绝此售后（必填原因）
      </div>
      <textarea
        name="rejectReason"
        rows={2}
        placeholder="例如：已超出售后受理期限 / 服务完成后无质量问题"
        required
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: 13,
          border: "1px solid #fca5a5",
          borderRadius: 4,
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <button
        type="submit"
        style={{
          marginTop: 6,
          padding: "6px 14px",
          fontSize: 13,
          background: "#dc2626",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ✕ 拒绝
      </button>
    </form>
  );
}

/**
 * Server action 包装 — 走 FormData → admin server action 已重定向刷新
 *
 * 注意：HTML form action 要求返回 Promise<void>，所以这里吞掉返回结果
 * （失败用 alert 文案展示由 Next 自动弹，演示期 OK；真实场景可改 client onSubmit 拿结构化 error）
 */
import {
  adminResolveAction,
  adminRejectAction,
} from "@/app/admin/after-sales/actions";

async function adminResolveActionWrapper(formData: FormData): Promise<void> {
  "use server";
  const r = await adminResolveAction(formData);
  // 失败不 throw；Next 16 form action 会自动展示 alert
  // 这里刻意不返回结果 — HTML form action 期望 Promise<void>
  void r;
}

async function adminRejectActionWrapper(formData: FormData): Promise<void> {
  "use server";
  const r = await adminRejectAction(formData);
  void r;
}

// ---------- styles ----------

const pageStyle: React.CSSProperties = {
  minHeight: "calc(100vh - 56px)",
  background: "#f7f8fa",
  padding: "16px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  color: "#111827",
  maxWidth: 960,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "12px 16px",
  marginBottom: 12,
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
