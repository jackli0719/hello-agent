"use client";

// [任务 19] 售后退款表单 — 仅 completed + payStatus=paid 时展示
//
// 用法：调用方传 formAction（不同角色）+ csrfToken
//   - 客户：customerRefundOrderAction(formData)
//   - admin：直接调 adminRefundOrderAction(orderId)，不需要表单
//
// UI 风格跟 CancelForm / PayForm 对齐 — 折叠面板，点按钮展开确认

import { useState, useTransition } from "react";
import { CSRF_FORM_FIELD } from "@/src/lib/csrf-constants";

export interface RefundFormProps {
  orderId: string;
  formAction: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  csrfToken: string;
  amountYuan: number;
  /** 按钮文案，默认「申请售后退款」 */
  buttonLabel?: string;
}

export function RefundForm({
  orderId,
  formAction,
  csrfToken,
  amountYuan,
  buttonLabel = "申请售后退款",
}: RefundFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        style={{
          padding: "8px 16px",
          background: "#fff",
          color: "#7c2d12",
          border: "1px solid #fdba74",
          borderRadius: 4,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          marginRight: 8,
        }}
      >
        {buttonLabel}
      </button>
    );
  }

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("orderId", orderId);
    fd.set(CSRF_FORM_FIELD, csrfToken);
    startTransition(async () => {
      const result = await formAction(fd);
      if (result.ok) {
        window.location.reload();
      } else {
        setError(result.error ?? "退款失败");
      }
    });
  };

  return (
    <div
      style={{
        display: "inline-block",
        padding: 12,
        background: "#fff7ed",
        border: "1px solid #fdba74",
        borderRadius: 6,
        marginRight: 8,
        verticalAlign: "top",
      }}
    >
      <div style={{ fontSize: 13, color: "#7c2d12", marginBottom: 6 }}>
        申请退款：<strong>¥{amountYuan.toFixed(2)}</strong>（演示模拟）
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        演示期不接真实通道，点击「确认退款」后立即标记为已退款。
      </div>
      {error ? (
        <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 6 }}>
          {error}
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending}
        style={{
          padding: "6px 14px",
          background: pending ? "#9ca3af" : "#ea580c",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          fontSize: 13,
          cursor: pending ? "not-allowed" : "pointer",
        }}
      >
        {pending ? "退款中..." : "确认退款"}
      </button>
      <button
        type="button"
        onClick={() => {
          setShowForm(false);
          setError(null);
        }}
        style={{
          marginLeft: 6,
          padding: "6px 12px",
          background: "#fff",
          color: "#374151",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        取消
      </button>
    </div>
  );
}
