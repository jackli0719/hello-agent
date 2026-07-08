"use client";

// [任务 17] 师傅结算汇总 — 客户端筛选器
//
// 拆出来是因为 onChange + window.location.href 是 client-only 操作，
// 不能在 server component (page.tsx) 里写。

import { useRouter, useSearchParams } from "next/navigation";

export function FilterSelect({
  paramKey,
  options,
  placeholder,
  minWidth,
}: {
  paramKey: "period" | "workerId";
  options: { value: string; label: string }[];
  placeholder: string;
  minWidth?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramKey) ?? "";

  return (
    <select
      data-testid={`filter-${paramKey}`}
      defaultValue={current}
      onChange={(e) => {
        const url = new URL(window.location.href);
        if (e.target.value) {
          url.searchParams.set(paramKey, e.target.value);
        } else {
          url.searchParams.delete(paramKey);
        }
        router.push(url.toString());
      }}
      style={{
        padding: "6px 12px",
        border: "1px solid #cbd5e1",
        borderRadius: 4,
        fontSize: 13,
        background: "#fff",
        minWidth: minWidth ?? 120,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
