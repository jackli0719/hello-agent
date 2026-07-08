// [任务 21] 售后状态展示卡片 — 客户 / 商家 / admin 共用展示逻辑
//
// 设计：
// - 4 状态不同色调 + 不同文案
// - 已解决(resolved)状态建议联系客服发起退款（任务 21 决策 #2：不自动联动）
// - 已拒绝(rejected)状态展示拒绝原因
//
// 注意：本组件只展示数据，不调 action — 操作按钮由父级集成

type AfterSalesStatus = "pending" | "processing" | "resolved" | "rejected";

interface Props {
  status: AfterSalesStatus;
  reason: string | null;
  rejectReason: string | null;
  handledAt: string | null;
}

const STATUS_LABEL: Record<AfterSalesStatus, string> = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已解决",
  rejected: "已拒绝",
};

const STATUS_TONE: Record<
  AfterSalesStatus,
  { bg: string; border: string; color: string }
> = {
  pending: { bg: "#fef3c7", border: "#fde68a", color: "#92400e" },
  processing: { bg: "#dbeafe", border: "#bfdbfe", color: "#1e40af" },
  resolved: { bg: "#dcfce7", border: "#bbf7d0", color: "#15803d" },
  rejected: { bg: "#fee2e2", border: "#fecaca", color: "#b91c1c" },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AfterSalesCard({
  status,
  reason,
  rejectReason,
  handledAt,
}: Props) {
  const tone = STATUS_TONE[status];
  return (
    <div
      style={{
        padding: "12px 14px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 6,
        color: tone.color,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          售后工单 — {STATUS_LABEL[status]}
        </div>
        {handledAt ? (
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            处理时间：{formatDateTime(handledAt)}
          </div>
        ) : null}
      </div>

      {reason ? (
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: "#6b7280" }}>问题描述：</span>
          <span>{reason}</span>
        </div>
      ) : (
        <div style={{ marginBottom: 6, color: "#9ca3af" }}>（未填原因）</div>
      )}

      {status === "rejected" && rejectReason ? (
        <div style={{ marginTop: 6 }}>
          <span style={{ color: "#6b7280" }}>拒绝原因：</span>
          <span>{rejectReason}</span>
        </div>
      ) : null}

      {status === "resolved" ? (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "#fff",
            border: "1px dashed #bbf7d0",
            borderRadius: 4,
            fontSize: 12,
            color: "#15803d",
          }}
        >
          ✓ 售后已解决。如需退款，请联系客服发起退款。
        </div>
      ) : null}

      {status === "pending" || status === "processing" ? (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
          工作人员正在处理中，请耐心等待
        </div>
      ) : null}
    </div>
  );
}
