// 师傅端订单详情页 — /worker/orders/[id]
//
// MVP 范围（按需求）：
// 1. 路由：/worker/orders/[id]?masterId=...  （masterId 用于越权防护）
// 2. 展示完整订单字段：订单号 / 客户 / 手机 / 地址 / 服务品类 / SKU / 金额 / 状态 / 创建时间 / 师傅
// 3. assigned → 「开始服务」；in_service → 「完成订单」；completed/cancelled → 只展示
// 4. 操作按钮复用 app/worker/WorkerOrderActions（不复制业务逻辑）
// 5. 找不到订单 / 越权 → 404
// 6. 顶部返回链接带 masterId 保留上下文
//
// 设计要点：
// - getOrderForWorker 已带 masterId 校验（worker.ts），这里只负责 UI 渲染 + 404
// - 不复用 OrderCard：详情页字段更多（品类、师傅、创建时间），UI 不一样
// - 操作按钮完全复用 WorkerOrderActions — 列表页和详情页用同一个 client 组件

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getOrderForWorker } from "@/src/lib/worker";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { getCurrentUser } from "@/src/lib/auth";
import { WorkerOrderActions } from "../../WorkerOrderActions";
import { logoutAction } from "@/app/login/actions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkerOrderDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 1. 当前登录 worker
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=/worker/orders/${encodeURIComponent(id)}`);
  }
  if (user.role !== "worker" || !user.workerId) {
    redirect("/dashboard");
  }

  // 2. 拉订单（按登录 workerId 强校验 — 越权返回 null）
  const order = await getOrderForWorker(id, user.workerId);
  if (!order) notFound();

  const backHref = "/worker";

  // 时间格式：YYYY-MM-DD HH:mm
  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        background: "#f7f8fa",
        padding: "16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      {/* 极简顶部 — 含返回 + 退出 */}
      <header
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href={backHref}
          style={{
            fontSize: 13,
            color: "#2563eb",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
          }}
        >
          ← 返回
        </Link>
        <div style={{ fontSize: 13, color: "#6b7280" }}>订单详情</div>
        <form action={logoutAction}>
          <button type="submit" style={logoutBtnStyle}>
            退出
          </button>
        </form>
      </header>

      {/* 订单主卡 — 顶部订单号 + 状态 */}
      <section
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

        {/* 客户信息 */}
        <SectionTitle title="客户信息" />
        <Field label="姓名" value={order.customerName} />
        <Field label="手机" value={order.customerPhone || "—"} />
        <Field label="地址" value={order.address} />

        {/* 服务信息 */}
        <SectionTitle title="服务信息" />
        <Field label="服务品类" value={order.serviceCategoryName ?? "—"} />
        <Field label="服务 SKU" value={order.serviceName} />
        <Field label="金额" value={`¥${order.amountYuan.toFixed(2)}`} />
        <Field label="预约时间" value={formatDateTime(order.scheduledAt)} />

        {/* [v0.7.6] 备注信息 */}
        <SectionTitle title="备注信息" />
        <Field
          label="用户备注"
          value={order.remark?.trim() ? order.remark : "暂无备注"}
        />
        <Field
          label="后台内部备注"
          value={
            order.internalRemark?.trim() ? order.internalRemark : "暂无备注"
          }
        />
        {order.serviceSummary?.trim() ? (
          <Field label="服务完成说明" value={order.serviceSummary} />
        ) : null}

        {/* 师傅信息 */}
        <SectionTitle title="分配师傅" />
        <Field label="姓名" value={order.masterName ?? "—"} />
        <Field label="手机" value={order.masterPhone ?? "—"} />

        {/* 时间戳 */}
        <SectionTitle title="时间信息" />
        <Field label="创建时间" value={formatDateTime(order.createdAt)} />
      </section>

      {/* 操作按钮区 */}
      <section
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <WorkerOrderActions orderId={order.id} status={order.status} />
        {order.status === "completed" || order.status === "cancelled" ? (
          <div
            style={{
              marginTop: 8,
              padding: "12px",
              background: "#f9fafb",
              borderRadius: 6,
              fontSize: 13,
              color: "#6b7280",
              textAlign: "center",
            }}
          >
            {order.status === "completed"
              ? "✓ 订单已完成，不可再操作"
              : "订单已取消，不可再操作"}
          </div>
        ) : null}
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

const logoutBtnStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
};
