"use client";

import { useState, useTransition } from "react";
import { toggleRuleEnabledAction } from "@/app/dispatch-rules/actions";

interface Props {
  ruleId: string;
  initialEnabled: boolean;
}

/**
 * 列表行右侧「启用/停用」按钮。
 *
 * 乐观更新：点击立即翻按钮文字，server action 失败再回滚 + 显示错误。
 * revalidate 完成后父组件重新拉数据 → 本组件被卸载/重挂载，状态自然一致。
 */
export function DispatchRuleActionsCell({ ruleId, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const next = !enabled;
    setError(null);
    setEnabled(next); // 乐观
    startTransition(async () => {
      const r = await toggleRuleEnabledAction(ruleId);
      if (!r.ok) {
        setEnabled(!next); // 回滚
        setError(r.error);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        style={{
          padding: "3px 10px",
          background: enabled ? "#fff" : "#dbeafe",
          color: enabled ? "#b91c1c" : "#1d4ed8",
          border: "1px solid " + (enabled ? "#fca5a5" : "#93c5fd"),
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 500,
          cursor: isPending ? "wait" : "pointer",
        }}
      >
        {isPending ? "切换中…" : enabled ? "停用" : "启用"}
      </button>
      {error && (
        <div
          style={{
            color: "#b91c1c",
            padding: "2px 6px",
            background: "#fee2e2",
            borderRadius: 3,
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
