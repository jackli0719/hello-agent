"use client";

import { useRef, useState, useTransition } from "react";
import {
  cancelDispatchAction,
  type CancelDispatchActionResult,
} from "@/app/orders/actions";

interface Props {
  orderId: string;
}

/**
 * 「取消派单」按钮（已派单 / 服务中 订单使用）。
 *
 * 点击后：
 * - 订单状态：assigned/in_service → pending
 * - 师傅状态：busy → available
 * - masterName 历史快照保留（不抹掉，知道当初派给了谁）
 *
 * 失败内联展示（按 category 区分样式）。
 * system 错误的「重试」按钮直接重新调用 server action，不只是清错误。
 */
export function CancelDispatchButton({ orderId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CancelDispatchActionResult | null>(null);
  // 记住已点过 — 防止重复触发（revalidate 后父组件可能保留组件实例）
  const confirmedRef = useRef(false);

  function handleClick() {
    if (confirmedRef.current || isPending) return;
    setResult(null);
    startTransition(async () => {
      const r = await cancelDispatchAction(orderId);
      if (r.ok) {
        confirmedRef.current = true;
        // 成功保持显示，revalidate 后父组件会卸载这个按钮
      } else {
        setResult(r);
      }
    });
  }

  if (result?.ok) {
    return (
      <div style={{ fontSize: 12 }}>
        <div style={{ color: "#15803d", fontWeight: 600 }}>
          ✓ 已取消{masterNameSuffix(result.masterName)}的派单
        </div>
        <div style={{ color: "#6b7280", fontSize: 11 }}>列表正在刷新…</div>
      </div>
    );
  }

  if (result && !result.ok && result.category === "system") {
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
          {result.error}
        </div>
        <button
          type="button"
          onClick={handleClick}
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

  const validationError =
    result && !result.ok && result.category === "validation" ? result.error : null;

  return (
    <div style={{ fontSize: 12 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        style={{
          background: isPending ? "#f3f4f6" : "#fff",
          color: "#b91c1c",
          border: "1px solid #fca5a5",
          padding: "3px 10px",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 500,
          cursor: isPending ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "处理中…" : "取消派单"}
      </button>
      {validationError && (
        <div style={{ color: "#b91c1c", marginTop: 4 }}>{validationError}</div>
      )}
    </div>
  );
}

function masterNameSuffix(name: string | null): string {
  return name ? `「${name}」` : "";
}