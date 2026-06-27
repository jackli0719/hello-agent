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

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrderForWorker } from "@/src/lib/worker";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { WorkerOrderActions } from "../../WorkerOrderActions";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ masterId?: string }>;
}

export default async function WorkerOrderDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { masterId } = await searchParams;

  // masterId 缺省：演示期允许（不校验），但页面应该提示
  // masterId 存在：用它做越权校验
  const order = await getOrderForWorker(id, masterId);
  if (!order) notFound();

  // 返回链接 — 永远带 masterId 保留上下文；没 masterId 时回到 /worker 让用户重选
  const backHref = masterId
    ? `/worker?masterId=${encodeURIComponent(masterId)}`
    : "/worker";

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
      {/* 极简顶部 — 含返回 */}
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
        <div style={{ width: 56 }} />
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
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{order.id}</div>
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
            {order.status === "completed" ? "✓ 订单已完成，不可再操作" : "订单已取消，不可再操作"}
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