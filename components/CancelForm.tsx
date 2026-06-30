"use client";

// 取消订单表单 — [v0.7.9] 3 端共用
//
// 用法：调用方传 formAction（不同角色）+ csrfToken + requireReason
//   - 后台：cancelOrderAction(orderId, cancelReason)
//   - 师傅：workerCancelOrderAction(formData)
//   - 用户：customerCancelOrderAction(formData)

import { useState, useTransition } from "react";
import { CSRF_FORM_FIELD } from "@/src/lib/csrf-constants";

export interface CancelFormProps {
  orderId: string;
  /** 调用的 server action：参数是 FormData */
  formAction: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  csrfToken: string;
  /** [v0.7.9] 是否强制要求填原因（in_service 必填） */
  requireReason?: boolean;
  /** 按钮文案，默认「确认取消」 */
  buttonLabel?: string;
}

export function CancelForm({
  orderId,
  formAction,
  csrfToken,
  requireReason = false,
  buttonLabel = "确认取消",
}: CancelFormProps) {
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
          padding: "6px 12px",
          background: "#fff",
          color: "#b91c1c",
          border: "1px solid #fca5a5",
          borderRadius: 4,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        取消订单
      </button>
    );
  }

  const handleSubmit = () => {
    setError(null);
    // 业务规则：必填校验
    if (requireReason && !reason.trim()) {
      setError("请填写取消原因");
      return;
    }
    const fd = new FormData();
    fd.set("orderId", orderId);
    fd.set("cancelReason", reason);
    fd.set(CSRF_FORM_FIELD, csrfToken);
    startTransition(async () => {
      const result = await formAction(fd);
      if (!result.ok) {
        setError(result.error ?? "取消失败");
      } else {
        // 成功 — 刷新页面
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
        padding: 12,
        marginTop: 8,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "#7f1d1d",
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        取消订单{requireReason ? "（必填原因）" : ""}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="如：用户临时取消 / 师傅无法按时上门"
        maxLength={500}
        rows={2}
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid #fca5a5",
          borderRadius: 4,
          fontSize: 12,
          boxSizing: "border-box",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      {error && (
        <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 4 }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          style={{
            padding: "4px 12px",
            background: pending ? "#fca5a5" : "#b91c1c",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "取消中…" : buttonLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
            setReason("");
            setError(null);
          }}
          style={{
            padding: "4px 12px",
            background: "#fff",
            color: "#6b7280",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
