"use client";

// 订单卡片操作按钮 — client component，调 server action。
//
// 状态分发（按需求 #3-#7）：
// - assigned → 「开始服务」按钮（调 workerStartServiceAction → assigned→in_service）
// - in_service → 「完成订单」按钮（调 workerCompleteOrderAction → in_service→completed）
// - completed / cancelled → 不渲染按钮
//
// 反馈：用 useTransition 给按钮 loading 态；失败用 useState + 内联红条（不用 alert，更友好）。

import { useState, useTransition } from "react";
import {
  workerStartServiceAction,
  workerCompleteOrderAction,
} from "./actions";

type Status = "pending" | "assigned" | "in_service" | "completed" | "cancelled";

export function WorkerOrderActions({
  orderId,
  status,
}: {
  orderId: string;
  status: Status;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // pending 不该出现在师傅端 — 防御性渲染（如果意外出现就不显示按钮）
  if (status === "pending") return null;
  // completed / cancelled 不允许操作（按需求 #6 / #7）
  if (status === "completed" || status === "cancelled") return null;

  const handleStart = () => {
    setError(null);
    startTransition(async () => {
      const result = await workerStartServiceAction(orderId);
      if (!result.ok) {
        setError(`开始服务失败：${result.error}`);
      }
    });
  };

  const handleComplete = () => {
    setError(null);
    startTransition(async () => {
      const result = await workerCompleteOrderAction(orderId);
      if (!result.ok) {
        setError(`完成订单失败：${result.error}`);
      }
    });
  };

  if (status === "assigned") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ErrorBanner message={error} />
        <button
          type="button"
          onClick={handleStart}
          disabled={pending}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: pending ? "#93c5fd" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 500,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "处理中…" : "开始服务"}
        </button>
      </div>
    );
  }

  if (status === "in_service") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ErrorBanner message={error} />
        <button
          type="button"
          onClick={handleComplete}
          disabled={pending}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: pending ? "#86efac" : "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 500,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "处理中…" : "完成订单"}
        </button>
      </div>
    );
  }

  return null;
}

// 内联错误条 — 比 alert 友好（不会打断操作、不阻塞主线程）
function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        padding: "10px 12px",
        background: "#fee2e2",
        color: "#b91c1c",
        borderRadius: 6,
        fontSize: 13,
        border: "1px solid #fca5a5",
      }}
    >
      {message}
    </div>
  );
}