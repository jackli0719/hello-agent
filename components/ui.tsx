import type React from "react";

// 表格样式 — 在订单页和后续师傅页 / 服务页复用
export const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#fafafa",
  fontSize: 13,
  color: "#374151",
  fontWeight: 600,
};

export const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f0f0f0",
  fontSize: 14,
  color: "#111827",
  verticalAlign: "top",
};

export const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 20,
  marginBottom: 24,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

type Tone = "gray" | "blue" | "green" | "amber" | "red";
const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  gray: { bg: "#f3f4f6", fg: "#374151" },
  blue: { bg: "#dbeafe", fg: "#1d4ed8" },
  green: { bg: "#dcfce7", fg: "#15803d" },
  amber: { bg: "#fef3c7", fg: "#b45309" },
  red: { bg: "#fee2e2", fg: "#b91c1c" },
};

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const c = TONE_COLORS[tone];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// 订单状态对应的徽标颜色，集中在这里
export const ORDER_TONE: Record<string, Tone> = {
  pending: "amber",
  assigned: "blue",
  in_service: "blue",
  completed: "green",
  cancelled: "red",
};

export const TECHNICIAN_TONE: Record<string, Tone> = {
  available: "green",
  busy: "blue",
  offline: "gray",
};
