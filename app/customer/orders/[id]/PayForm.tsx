"use client";

// [任务 X] 客户订单详情页「立即支付」表单 — 模拟支付（演示期）
//
// 设计：
// - 复用 customerPayOrderAction（已经 requireRole + requireCsrf）
// - 客户端状态：pending / error / success
// - 成功后 redirect 到 /customer/orders/[id]?paid=1 显示提示
//   (Next.js router.refresh 替代硬跳,让 order.payStatus 重新 fetch)
//
// UI 风格跟 CancelForm 对齐 — 一个折叠面板,点「立即支付」展开确认

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CSRF_FORM_FIELD } from "@/src/lib/csrf-constants";
import { customerPayOrderAction } from "@/app/customer/actions";

export interface PayFormProps {
  orderId: string;
  csrfToken: string;
  amountYuan: number;
}

export function PayForm({ orderId, csrfToken, amountYuan }: PayFormProps) {
  const router = useRouter();
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
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          marginRight: 8,
        }}
      >
        立即支付（模拟）
      </button>
    );
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("orderId", orderId);
    formData.set(CSRF_FORM_FIELD, csrfToken);

    startTransition(async () => {
      const result = await customerPayOrderAction(formData);
      if (result.ok) {
        // 模拟支付成功 — 刷新当前页让 payStatus 重新 fetch
        router.refresh();
        setShowForm(false);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "inline-block",
        padding: 12,
        background: "#eff6ff",
        border: "1px solid #93c5fd",
        borderRadius: 6,
        marginRight: 8,
      }}
    >
      <div style={{ fontSize: 13, color: "#1e40af", marginBottom: 6 }}>
        支付金额：<strong>¥{amountYuan.toFixed(2)}</strong>（演示模拟）
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        演示期不接真实支付,点击「确认支付」后立即标记为已支付。
      </div>
      {error ? (
        <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 6 }}>
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        style={{
          padding: "6px 14px",
          background: pending ? "#9ca3af" : "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          fontSize: 13,
          cursor: pending ? "not-allowed" : "pointer",
        }}
      >
        {pending ? "处理中..." : "确认支付"}
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
    </form>
  );
}
