"use client";

// [任务 21] 客户发起售后表单 — 客户端组件，复用 CSRF hidden input 模式
//
// 设计：
// - 表单含 textarea + 提交按钮；reason 可空（演示期允许）
// - 用 hidden input 传 orderId + csrfToken
// - 调 formAction（customerCreateAfterSalesAction）；失败由 server action 返回结构化错误
// - 本地 useState 管 disabled + 提交中（防御双击）

import { useState, useTransition } from "react";

interface Props {
  orderId: string;
  csrfToken: string;
  formAction: (formData: FormData) => Promise<{
    ok: boolean;
    error?: string;
    category?: string;
  }>;
}

export function AfterSalesForm({ orderId, csrfToken, formAction }: Props) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setErrorMsg(null);
    formData.set("orderId", orderId);
    formData.set("reason", reason);
    startTransition(async () => {
      const r = await formAction(formData);
      if (!r.ok && r.error) {
        setErrorMsg(r.error);
      }
    });
  }

  const tooLong = reason.length > 500;

  return (
    <form action={onSubmit} style={{ marginTop: 8 }}>
      {/* CSRF — hidden input（CLAUDE.md CSRF 约定） */}
      <input type="hidden" name="_csrf" value={csrfToken} />

      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        问题描述（可选）
      </div>
      <textarea
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="请简述售后原因（500 字以内）"
        rows={4}
        disabled={isPending}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 13,
          border: "1px solid #d1d5db",
          borderRadius: 6,
          resize: "vertical",
          boxSizing: "border-box",
          backgroundColor: isPending ? "#f3f4f6" : "#fff",
        }}
      />
      <div
        style={{
          fontSize: 11,
          color: tooLong ? "#dc2626" : "#9ca3af",
          marginTop: 2,
        }}
      >
        {reason.length} / 500
      </div>

      <button
        type="submit"
        disabled={isPending || tooLong}
        style={{
          marginTop: 10,
          padding: "8px 16px",
          fontSize: 14,
          background: "#7c3aed",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: isPending || tooLong ? "not-allowed" : "pointer",
          opacity: isPending || tooLong ? 0.6 : 1,
        }}
      >
        {isPending ? "提交中..." : "发起售后工单"}
      </button>

      {errorMsg ? (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            color: "#7f1d1d",
            fontSize: 12,
          }}
        >
          {errorMsg}
        </div>
      ) : null}
    </form>
  );
}
