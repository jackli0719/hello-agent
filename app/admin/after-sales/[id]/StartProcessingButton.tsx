"use client";

// [任务 21] admin 开始处理按钮 — 调 adminStartProcessingAction（非 FormData → Origin CSRF）
//
// 设计：
// - 用 useTransition 包按钮 onClick 异步调 action
// - 失败时 alert / 下面 bar 显示（演示期 OK）
// - 成功后 Next 16 自动 revalidate

import { useState, useTransition } from "react";

interface Props {
  orderId: string;
  label: string;
  tone: "primary" | "secondary";
}

export function StartProcessingButton({ orderId, label, tone }: Props) {
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function onClick() {
    setErrorMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      try {
        const { adminStartProcessingAction } =
          await import("@/app/admin/after-sales/actions");
        const r = await adminStartProcessingAction(orderId);
        if (r.ok) {
          setSuccessMsg(`已接单（状态：${r.afterSalesStatus}）`);
        } else {
          setErrorMsg(r.error);
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "操作失败");
      }
    });
  }

  const bg = tone === "primary" ? "#2563eb" : "#6b7280";

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        style={{
          padding: "8px 16px",
          fontSize: 14,
          background: bg,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: isPending ? "not-allowed" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? "处理中..." : label}
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
      {successMsg ? (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 6,
            color: "#15803d",
            fontSize: 12,
          }}
        >
          {successMsg}
        </div>
      ) : null}
    </div>
  );
}
