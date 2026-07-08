// [任务 19] 商家端订单详情页 — /merchant-admin/orders/[id]
//
// 范围：
// 1. 显示本商家师傅接的订单详情（越权防护在 getMerchantOrderDetail）
// 2. 商家可「取消订单」— assigned / in_service 状态
// 3. 取消后自动联动退款（paid → refunded，事务内）
//
// 越权防控（CLAUDE.md P0-1 + 任务 18 数据层零信任）：
// - merchantId 来源唯一 = getEffectiveMerchantId(user)
// - 订单 master.merchantId 必须 === merchantId；不匹配返 null → 跳回列表
// - 任何 form/URL 参数都不接

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import {
  getEffectiveMerchantId,
  getMerchantOrderDetail,
} from "@/src/lib/merchant-admin";
import {
  getLatestDispatchFailure,
  describeFailureCode,
} from "@/src/lib/auto-dispatch";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { CancelForm } from "@/components/CancelForm";
import { AfterSalesCard } from "@/app/customer/orders/[id]/AfterSalesCard";
import { StatusBadge, ORDER_TONE, card } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { merchantCancelOrderAction } from "@/app/merchant-admin/orders/actions";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function MerchantOrderDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 1. 登录校验
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=/merchant-admin/orders/${encodeURIComponent(id)}`);
  }
  // CSRF cookie — CancelForm 需要
  const csrfToken = await ensureCsrfCookie();

  // 2. merchantId（数据层零信任：URL 不接，仅从 session 取）
  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return <div style={{ ...card, color: "#b91c1c" }}>{msg}。</div>;
  }

  // 3. 拉订单（越权防护在 query — 不属于本商家返 null）
  const order = await getMerchantOrderDetail(id, merchantId);
  if (!order) {
    // 不告诉调用方"订单存在 / 不存在"（与 customer 端一致）
    redirect("/merchant-admin/orders?error=not_found");
  }

  // [任务 20] 派单失败原因（仅 pending 状态有意义 — 已派单就看不到）
  const dispatchFailure =
    order.status === "pending" ? await getLatestDispatchFailure(id) : null;

  // 4. 是否可取消：assigned / in_service
  const canCancel =
    order.status === "assigned" || order.status === "in_service";
  const requireReason = order.status === "in_service";

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link
          href="/merchant-admin/orders"
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
          商家账号：<code>{user.name}</code>
        </div>
      </header>

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
            label={
              ORDER_STATUS_LABEL[
                order.status as keyof typeof ORDER_STATUS_LABEL
              ] ?? order.status
            }
            tone={ORDER_TONE[order.status] ?? "neutral"}
          />
        </div>

        <SectionTitle title="客户信息" />
        <Field label="客户姓名" value={order.customerName} />
        <Field label="客户手机" value={order.customerPhone} />

        <SectionTitle title="服务信息" />
        <Field label="服务项目" value={order.serviceName} />
        <Field label="金额" value={`¥${order.amountYuan.toFixed(2)}`} />
        <Field label="预约时间" value={formatDateTime(order.scheduledAt)} />

        <SectionTitle title="已分配师傅" />
        <Field label="师傅" value={order.masterName ?? "—"} />

        {/* [任务 20] 派单失败原因 — pending 状态且有失败日志时显示 */}
        {dispatchFailure ? (
          <div
            style={{
              padding: "10px 14px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              color: "#7f1d1d",
              fontSize: 13,
              marginTop: 14,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ⚠ 暂时无法自动派单
            </div>
            <div>{describeFailureCode(dispatchFailure.failureCode)}</div>
            <div
              style={{
                color: "#9ca3af",
                fontSize: 11,
                marginTop: 4,
              }}
            >
              {formatDateTime(dispatchFailure.createdAt.toISOString())} ·
              请联系平台开通区域或新增师傅
            </div>
          </div>
        ) : null}

        <SectionTitle title="时间信息" />
        <Field label="下单时间" value={formatDateTime(order.createdAt)} />

        {/* 商家操作 — 仅 assigned / in_service 可取消
            取消后自动联动退款：paid → refunded（事务内一步） */}
        {canCancel ? (
          <div style={{ marginTop: 16 }}>
            <SectionTitle title="商家操作" />
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              {order.status === "assigned"
                ? "已派单可取消；取消后自动退款（如已支付）"
                : "服务中可取消，但必须填写原因"}
            </div>
            <CancelForm
              orderId={order.id}
              formAction={merchantCancelOrderAction}
              csrfToken={csrfToken}
              requireReason={requireReason}
              buttonLabel="确认取消订单"
            />
          </div>
        ) : null}

        {/* [任务 21] 售后进度（只读）— 商家视图不参与状态变更
            但商家能看到客户是否发起售后 + 当前进度（可能影响商家决策） */}
        {order.afterSalesStatus ? (
          <div style={{ marginTop: 16 }}>
            <SectionTitle title="售后工单（只读）" />
            <AfterSalesCard
              status={order.afterSalesStatus}
              reason={order.afterSalesReason}
              rejectReason={order.afterSalesRejectReason}
              handledAt={order.afterSalesHandledAt}
            />
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "#9ca3af",
              }}
            >
              售后处理由平台客服操作；如对结果有异议请联系平台运营
            </div>
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
          width: 96,
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
  maxWidth: 720,
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
