"use client";

import { useRef, useState, useTransition } from "react";
import {
  assignOrderAction,
  cancelOrderAction,
  completeOrderAction,
  startServiceAction,
  adminRefundOrderAction,
  type AssignOrderActionResult,
  type TransitionActionResult,
  type RefundActionResult,
} from "@/app/orders/actions";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import type { OrderStatus, PayStatus, Technician } from "@/src/types";

interface Props {
  orderId: string;
  status: OrderStatus;
  ruleName: string | null;
  candidates: Technician[]; // pending 状态用
  // [任务 19] 售后退款入口用 — 仅 completed + payStatus=paid 时展示
  payStatus?: PayStatus;
}

/**
 * 订单行操作单元（客户端组件）— 按 status 分发按钮：
 *
 * pending    → 派单按钮列表（每个候选一个）+ 「取消订单」
 * assigned   → 「开始服务」 + 「取消订单」
 * in_service → 「完成订单」 + 「取消订单」
 * completed  → dash（终态）
 * cancelled  → dash（终态）
 *
 * 错误处理：
 * - validation 错误：内联展示（红字）
 * - system 错误：banner + 「重试」按钮（点重试直接重新调同一个 action）
 */
export function OrderActions({
  orderId,
  status,
  ruleName,
  candidates,
  payStatus,
}: Props) {
  // 派单的乐观状态：点击立即显示「✓ 已派给 xxx」
  const [dispatchedTo, setDispatchedTo] = useState<string | null>(null);

  // 状态流转结果（success / validation / system）
  const [transitionResult, setTransitionResult] =
    useState<TransitionActionResult | null>(null);
  const [dispatchResult, setDispatchResult] =
    useState<AssignOrderActionResult | null>(null);
  // [任务 19] 退款结果 — 独立 state，与状态流转的 transitionResult 分开
  const [refundResult, setRefundResult] = useState<RefundActionResult | null>(
    null,
  );

  const [isPending, startTransition] = useTransition();
  const confirmedRef = useRef(false);

  // 记住最后一次 trigger — 用于 system 错误的「重试」
  const lastActionRef = useRef<(() => void) | null>(null);

  // ----- 派单 -----
  function handleDispatch(masterId: string, masterName: string) {
    if (confirmedRef.current || isPending || dispatchedTo) return;
    setDispatchedTo(masterName);
    setDispatchResult(null);
    startTransition(async () => {
      const r = await assignOrderAction(orderId, masterId);
      if (r.ok) {
        confirmedRef.current = true;
        // 保持 dispatchedTo 显示「✓ 已派给 xxx」，直到父组件 re-render
      } else {
        setDispatchedTo(null);
        setDispatchResult(r);
      }
    });
  }

  function handleRetryDispatch() {
    const last = lastDispatchRef.current;
    if (last) last();
  }

  const lastDispatchRef = useRef<(() => void) | null>(null);
  function triggerDispatch(masterId: string, masterName: string) {
    const fn = () => handleDispatch(masterId, masterName);
    lastDispatchRef.current = fn;
    fn();
  }

  // ----- 状态流转（开始服务 / 完成 / 取消） -----
  function runTransition(fn: () => Promise<TransitionActionResult>) {
    const trigger = () => {
      if (isPending) return;
      setTransitionResult(null);
      startTransition(async () => {
        const r = await fn();
        if (r.ok) confirmedRef.current = true;
        setTransitionResult(r);
      });
    };
    lastActionRef.current = trigger;
    trigger();
  }

  function handleRetryTransition() {
    const trigger = lastActionRef.current;
    if (trigger) trigger();
  }

  // ----- 渲染分支 -----

  // 派单成功反馈 — 等 revalidate 后这个组件会被父卸载
  // 条件：已设置乐观 dispatchedTo，且没有 system 错误（system 错误走自己的分支）
  if (
    dispatchedTo &&
    !(
      dispatchResult &&
      !dispatchResult.ok &&
      dispatchResult.category === "system"
    )
  ) {
    return (
      <SuccessFeedback
        primary={`✓ 已派给 ${dispatchedTo}`}
        secondary={isPending ? "列表正在刷新…" : "等待刷新…"}
      />
    );
  }

  // 派单的 system 错误 — 重试
  if (
    dispatchResult &&
    !dispatchResult.ok &&
    dispatchResult.category === "system"
  ) {
    return (
      <SystemErrorBanner
        message={dispatchResult.error}
        onRetry={handleRetryDispatch}
        isPending={isPending}
      />
    );
  }

  // 状态流转的 success
  if (transitionResult?.ok) {
    const nextLabel =
      ORDER_STATUS_LABEL[transitionResult.nextStatus as OrderStatus] ??
      transitionResult.nextStatus;
    return (
      <SuccessFeedback
        primary={`✓ 状态已更新为「${nextLabel}」`}
        secondary="列表正在刷新…"
      />
    );
  }

  // 状态流转的 system 错误 — 重试
  if (
    transitionResult &&
    !transitionResult.ok &&
    transitionResult.category === "system"
  ) {
    return (
      <SystemErrorBanner
        message={transitionResult.error}
        onRetry={handleRetryTransition}
        isPending={isPending}
      />
    );
  }

  // 各状态按钮
  if (status === "pending") {
    return (
      <PendingBranch
        orderId={orderId}
        ruleName={ruleName}
        candidates={candidates}
        isDispatching={isPending}
        hasDispatchedTo={dispatchedTo}
        validationError={
          dispatchResult && !dispatchResult.ok ? dispatchResult.error : null
        }
        onDispatch={triggerDispatch}
        onCancel={() => runTransition(() => cancelOrderAction(orderId))}
      />
    );
  }

  if (status === "assigned" || status === "in_service") {
    return (
      <ForwardBranch
        orderId={orderId}
        status={status}
        isPending={isPending}
        validationError={
          transitionResult &&
          !transitionResult.ok &&
          transitionResult.category === "validation"
            ? transitionResult.error
            : null
        }
        onForward={() =>
          status === "assigned"
            ? runTransition(() => startServiceAction(orderId))
            : runTransition(() => completeOrderAction(orderId))
        }
        onCancel={() => runTransition(() => cancelOrderAction(orderId))}
      />
    );
  }

  // [任务 19] completed + payStatus=paid → 售后退款按钮
  if (status === "completed" && payStatus === "paid") {
    return (
      <div style={{ fontSize: 12 }}>
        {refundResult?.ok ? (
          <div style={{ color: "#15803d", fontWeight: 600 }}>
            ✓ 已发起售后退款
          </div>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (isPending) return;
              setRefundResult(null);
              startTransition(async () => {
                const r = await adminRefundOrderAction(orderId);
                setRefundResult(r);
              });
            }}
            style={{
              background: isPending ? "#f3f4f6" : "#fff",
              color: "#7c2d12",
              border: "1px solid #fdba74",
              padding: "4px 12px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              cursor: isPending ? "not-allowed" : "pointer",
            }}
          >
            {isPending ? "退款中…" : "售后退款"}
          </button>
        )}
        {refundResult && !refundResult.ok ? (
          <div style={{ color: "#b91c1c", marginTop: 4 }}>
            {refundResult.error}
          </div>
        ) : null}
      </div>
    );
  }

  // completed / cancelled — 终态
  return <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>;
}

// ============================================================
// 子组件
// ============================================================

function SuccessFeedback({
  primary,
  secondary,
}: {
  primary: string;
  secondary: string;
}) {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ color: "#15803d", fontWeight: 600 }}>{primary}</div>
      <div style={{ color: "#6b7280", fontSize: 11 }}>{secondary}</div>
    </div>
  );
}

function SystemErrorBanner({
  message,
  onRetry,
  isPending,
}: {
  message: string;
  onRetry: () => void;
  isPending: boolean;
}) {
  return (
    <div style={{ fontSize: 12 }}>
      <div
        style={{
          color: "#b91c1c",
          padding: "4px 8px",
          background: "#fee2e2",
          borderRadius: 4,
          marginBottom: 6,
        }}
      >
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={isPending}
        style={{
          background: isPending ? "#f3f4f6" : "#fff",
          border: "1px solid #d1d5db",
          color: "#374151",
          padding: "3px 10px",
          borderRadius: 4,
          fontSize: 12,
          cursor: isPending ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "重试中…" : "重试"}
      </button>
    </div>
  );
}

function PendingBranch({
  orderId,
  ruleName,
  candidates,
  isDispatching,
  hasDispatchedTo,
  validationError,
  onDispatch,
  onCancel,
}: {
  orderId: string;
  ruleName: string | null;
  candidates: Technician[];
  isDispatching: boolean;
  hasDispatchedTo: string | null;
  validationError: string | null;
  onDispatch: (masterId: string, masterName: string) => void;
  onCancel: () => void;
}) {
  // 乐观状态：点完按钮立即显示 — 但已经在外层 OrderActions 处理，这里仅按钮本身
  return (
    <div style={{ fontSize: 12 }}>
      {ruleName && (
        <div style={{ marginBottom: 6 }}>
          <span
            style={{
              display: "inline-block",
              padding: "1px 8px",
              background: "#eff6ff",
              color: "#1d4ed8",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            命中规则：{ruleName}
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {candidates.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onDispatch(m.id, m.name)}
            disabled={isDispatching || hasDispatchedTo !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 10px",
              background: "#fff",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              fontSize: 12,
              color: "#111827",
              cursor: isDispatching ? "not-allowed" : "pointer",
              opacity: isDispatching ? 0.6 : 1,
            }}
          >
            <span>
              {m.name}
              <span style={{ color: "#9ca3af", marginLeft: 6 }}>
                ⭐ {m.rating.toFixed(1)} · {m.completedJobs} 单
              </span>
            </span>
            <span
              style={{
                background: "#2563eb",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              派给他
            </span>
          </button>
        ))}
      </div>

      {validationError && (
        <div style={{ color: "#b91c1c", marginTop: 6 }}>{validationError}</div>
      )}

      {/* 取消订单（pending 没有师傅，只改 status） */}
      <div style={{ marginTop: 8 }}>
        <DangerButton onClick={onCancel} disabled={isDispatching}>
          取消订单
        </DangerButton>
      </div>
    </div>
  );
}

function ForwardBranch({
  orderId,
  status,
  isPending,
  validationError,
  onForward,
  onCancel,
}: {
  orderId: string;
  status: "assigned" | "in_service";
  isPending: boolean;
  validationError: string | null;
  onForward: () => void;
  onCancel: () => void;
}) {
  const forwardLabel = status === "assigned" ? "开始服务" : "完成订单";
  const forwardColor: "blue" | "green" =
    status === "assigned" ? "blue" : "green";

  return (
    <div style={{ fontSize: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
      <PrimaryButton
        onClick={onForward}
        disabled={isPending}
        color={forwardColor}
      >
        {forwardLabel}
      </PrimaryButton>
      <DangerButton onClick={onCancel} disabled={isPending}>
        取消订单
      </DangerButton>
      {validationError && (
        <div style={{ color: "#b91c1c", width: "100%", marginTop: 4 }}>
          {validationError}
        </div>
      )}
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  color,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  color: "blue" | "green";
  children: React.ReactNode;
}) {
  const bg = color === "green" ? "#15803d" : "#2563eb";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#f3f4f6" : bg,
        color: disabled ? "#9ca3af" : "#fff",
        border: "none",
        padding: "4px 12px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#f3f4f6" : "#fff",
        color: disabled ? "#9ca3af" : "#b91c1c",
        border: "1px solid #fca5a5",
        padding: "4px 12px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
