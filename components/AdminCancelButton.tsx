"use client";

// [v0.7.9] 后台 /orders 取消订单按钮（CancelForm 包装）
// cancelOrderAction 签名: (orderId, cancelReason?) — 不是 FormData

import { useState, useTransition } from "react";
import { cancelOrderAction } from "@/app/orders/actions";
import { CSRF_FORM_FIELD } from "@/src/lib/csrf-constants";

export function AdminCancelButton({
  orderId,
  requireReason,
  csrfToken,
}: {
  orderId: string;
  requireReason: boolean;
  csrfToken: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        style={{
          padding: "4px 10px",
          background: "#fff",
          color: "#b91c1c",
          border: "1px solid #fca5a5",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        取消订单
      </button>
    );
  }

  const handleSubmit = () => {
    setError(null);
    if (requireReason && !reason.trim()) {
      setError("服务中的订单必须填写取消原因");
      return;
    }
    startTransition(async () => {
      // 后台 cancelOrderAction 签名: (orderId, cancelReason)
      // 但本组件传 FormData 给 CancelForm 模式不匹配 — 直接调
      const result = await cancelOrderAction(orderId, reason);
      if (!result.ok) {
        setError(result.error);
      } else {
        window.location.reload();
      }
    });
  };

  return (
    <div
      style={{
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 6,
        padding: 8,
        marginTop: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#7f1d1d",
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        取消订单{requireReason ? "（必填原因）" : ""}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="如：客户来电取消 / 师傅已派单但客户不要"
        maxLength={500}
        rows={2}
        style={{
          width: "100%",
          padding: "4px 6px",
          border: "1px solid #fca5a5",
          borderRadius: 3,
          fontSize: 11,
          boxSizing: "border-box",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      {error && (
        <div style={{ fontSize: 10, color: "#b91c1c", marginTop: 2 }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          style={{
            padding: "3px 8px",
            background: pending ? "#fca5a5" : "#b91c1c",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            fontSize: 11,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "取消中…" : "确认"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
            setReason("");
            setError(null);
          }}
          style={{
            padding: "3px 8px",
            background: "#fff",
            color: "#6b7280",
            border: "1px solid #d1d5db",
            borderRadius: 3,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          返回
        </button>
      </div>
    </div>
  );
}
