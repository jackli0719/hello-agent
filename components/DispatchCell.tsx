"use client";

import { useState, useTransition } from "react";
import { dispatchOrderAction } from "@/src/lib/actions/dispatch-order";

interface Props {
  orderId: string;
  technicianName: string;
  reason: string;
}

/**
 * 订单行的「一键派单」按钮。
 * - 点击调 server action，成功由 revalidate 刷新整张表（按钮自动消失）
 * - 失败内联展示，按 category 区分样式：
 *   - validation：红字一行理由（最常见：「无可用师傅」）
 *   - system：灰底 banner + 重试按钮（少见：DB 挂了之类）
 */
export function DispatchCell({ orderId, technicianName, reason }: Props) {
  const [isPending, startTransition] = useTransition();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);

  function handleClick() {
    setValidationError(null);
    setSystemError(null);
    startTransition(async () => {
      const r = await dispatchOrderAction(orderId);
      if (r.ok) {
        // 成功 — revalidatePath 会让服务端重新渲染这一行，状态从 pending → assigned
        // 按钮自然从 DOM 消失（status !== "pending"），无需手动 setState
        return;
      }
      if (r.category === "validation") setValidationError(r.error);
      else setSystemError(r.error);
    });
  }

  if (systemError) {
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
          {systemError}
        </div>
        <button
          type="button"
          onClick={() => setSystemError(null)}
          style={{
            background: "transparent",
            border: "1px solid #d1d5db",
            color: "#374151",
            padding: "3px 10px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: "#15803d", fontWeight: 600 }}>
          推荐：{technicianName}
        </span>
      </div>
      <div style={{ color: "#6b7280", marginBottom: 6 }}>{reason}</div>
      {validationError && (
        <div style={{ color: "#b91c1c", marginBottom: 6 }}>
          {validationError}
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        style={{
          background: isPending ? "#9ca3af" : "#2563eb",
          color: "#fff",
          border: "none",
          padding: "4px 12px",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 500,
          cursor: isPending ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "派单中…" : "一键派单"}
      </button>
    </div>
  );
}
