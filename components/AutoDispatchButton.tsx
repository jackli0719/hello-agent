"use client";

import { useState, useTransition } from "react";
import { adminAutoDispatchAction } from "@/app/orders/actions";

/**
 * [任务 20] admin 手动重试自动派单按钮
 *
 * 场景：admin 在 /orders 看到订单行"派单失败：当前区域暂无商家覆盖"
 * 点"自动派单"按钮 → 调 adminAutoDispatchAction → 再跑 tryAutoDispatch
 *
 * 规则：
 * - 仅 pending + paid 状态显示（与 assignOrder 一致）
 * - 成功后父组件 revalidate 刷新列表，按钮自动消失
 * - 失败：内联展示失败原因
 */
export function AutoDispatchButton({ orderId }: { orderId: string }) {
  const [result, setResult] = useState<
    | { ok: true; masterName: string }
    | { ok: false; error: string }
    | null
  >(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending) return;
    setResult(null);
    startTransition(async () => {
      const r = await adminAutoDispatchAction(orderId);
      if (r.ok) {
        setResult({ ok: true, masterName: r.masterName });
      } else {
        setResult({ ok: false, error: r.error });
      }
    });
  }

  return (
    <div style={{ fontSize: 12 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        style={{
          background: isPending ? "#f3f4f6" : "#fff",
          color: isPending ? "#9ca3af" : "#1d4ed8",
          border: "1px solid #93c5fd",
          padding: "4px 12px",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 500,
          cursor: isPending ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "派单中…" : "自动派单"}
      </button>
      {result?.ok ? (
        <div style={{ color: "#15803d", marginTop: 4, fontWeight: 600 }}>
          ✓ 已派给 {result.masterName}
        </div>
      ) : null}
      {result && !result.ok ? (
        <div style={{ color: "#b91c1c", marginTop: 4 }}>{result.error}</div>
      ) : null}
    </div>
  );
}
