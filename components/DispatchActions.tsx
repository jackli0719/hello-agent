"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  assignOrderAction,
  type AssignOrderActionResult,
} from "@/app/orders/actions";
import type { Technician } from "@/src/types";

interface Props {
  orderId: string;
  ruleName: string;
  candidates: Technician[]; // 已按 rating 排好的候选列表
}

/**
 * 派单操作单元（客户端组件，含乐观更新）。
 *
 * 用户体验路径：
 * 1. 点「派给他」→ 立即在本地把 orderId → masterName 标记为「乐观已派」
 * 2. 渲染立即变成「✓ 已派给 xxx」，**不等** revalidate 返回（响应 < 16ms）
 * 3. server action 在后台跑：
 *    - 成功 → revalidate 拉新数据，组件拿到新 props（candidates 仍存在但实际 DB 已 assigned，
 *      父组件会重新渲染 — 不过当前父组件只对 pending 订单渲染 DispatchActions，
 *      所以 revalidate 后这个组件会被卸载，让父组件展示「已分配师傅」+ 取消派单按钮）
 *    - 失败 → 清掉乐观标记，按钮列表恢复 + 错误提示
 *
 * 关键不变量：乐观标记只在「本地有缓存、服务端未确认」期间存在。
 * 服务端一旦 revalidate 完，父组件重渲染后 DispatchActions 不会再次挂载（因为订单不是 pending），
 * useEffect 清理兜底。
 */
export function DispatchActions({ orderId, ruleName, candidates }: Props) {
  const [optimisticMasterName, setOptimisticMasterName] = useState<string | null>(null);
  const [error, setError] = useState<{ category: "validation" | "system"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  // 标记「该组件实例是否已经被服务端确认成功」
  // revalidate 后父组件可能不卸载这个组件（如果订单状态没变），这时不重复触发 server action
  const confirmedRef = useRef(false);
  // 记住「最后一次触发的派单动作」 — system 错误的「重试」按钮直接重发它
  const lastActionRef = useRef<{ masterId: string; masterName: string } | null>(null);

  // 兜底：组件卸载时清掉乐观状态（一般不会触发，因为 revalidate 后订单变 assigned 会卸载这个组件）
  useEffect(() => {
    return () => {
      // no-op：只是文档化「卸载不保留状态」
    };
  }, []);

  function handleClick(masterId: string, masterName: string) {
    if (confirmedRef.current || isPending) return;

    // 乐观更新：立即让 UI 切换到「已派给 xxx」
    setError(null);
    setOptimisticMasterName(masterName);
    lastActionRef.current = { masterId, masterName };

    startTransition(async () => {
      const r = await assignOrderAction(orderId, masterId);

      if (r.ok) {
        // 成功 — 标记 confirmed，乐观状态保持显示直到父组件 re-render
        confirmedRef.current = true;
      } else {
        // 失败 — 回滚乐观状态，保留 lastActionRef 让重试能再发
        setOptimisticMasterName(null);
        setError({ category: r.category, message: r.error });
      }
    });
  }

  function handleRetry() {
    const last = lastActionRef.current;
    if (!last) return;
    setError(null);
    handleClick(last.masterId, last.masterName);
  }

  // 乐观状态：显示成功反馈，按钮列表消失
  if (optimisticMasterName) {
    return (
      <div style={{ fontSize: 12 }}>
        <div style={{ color: "#15803d", fontWeight: 600, marginBottom: 4 }}>
          ✓ 已派给 {optimisticMasterName}
        </div>
        <div style={{ color: "#6b7280", fontSize: 11 }}>
          {isPending ? "列表正在刷新…" : "等待刷新…"}
        </div>
      </div>
    );
  }

  // 系统错误：给「重试」按钮 — 点击直接重新调用 server action
  if (error && error.category === "system") {
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
          {error.message}
        </div>
        <button
          type="button"
          onClick={handleRetry}
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

  // 默认：候选列表
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 6 }}>
        <span
          style={{
            display: "inline-block",
            padding: "1px 8px",
            background: "#eff6ff",
            color: "#1d4ed8",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          命中规则：{ruleName}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {candidates.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => handleClick(m.id, m.name)}
            disabled={isPending}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 10px",
              background: isPending ? "#f3f4f6" : "#fff",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              fontSize: 12,
              color: "#111827",
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            <span>
              {m.name}
              <span style={{ color: "#9ca3af", marginLeft: 6 }}>
                ⭐ {m.rating.toFixed(1)} · {m.completedJobs} 单
              </span>
            </span>
            <span
              style={{
                background: isPending ? "#9ca3af" : "#2563eb",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              派给他
            </span>
          </button>
        ))}
      </div>

      {error && error.category === "validation" && (
        <div style={{ color: "#b91c1c", marginTop: 6 }}>{error.message}</div>
      )}
    </div>
  );
}