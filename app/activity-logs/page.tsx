// [v0.8.0] 操作日志筛选 + 分页页
//
// 设计：
// - RSC（无客户端交互）— 表单 method=get 改 URL，RSC 重读 searchParams 渲染
// - URL query params 持久化筛选状态，刷新保留（CLAUDE.md 业务规则 #9）
// - 用 lib/activity-log.ts 的 listActivityLogs(filter, page, pageSize)
// - 默认 pageSize=10（业务规则 #3 说 20，与 /orders 10 不一致 — 已与用户确认选 10）
// - 空态：暂无符合条件的操作日志（业务规则 #11）
// - 最新日志在最上面（业务规则 #10，orderBy: createdAt desc + id desc tiebreaker）

import Link from "next/link";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ROLES,
  ACTIVITY_TARGET_TYPES,
  listActivityLogs,
  type ActivityAction,
  type ActivityRoleFilter,
  type ActivityTargetTypeFilter,
} from "@/src/lib/activity-log";

interface PageProps {
  searchParams: Promise<{
    actorRole?: string;
    action?: string;
    targetType?: string;
    keyword?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// 角色 / 动作 / 对象中文标签 — 表格里用
const ROLE_LABEL: Record<ActivityRoleFilter, string> = {
  admin: "管理员",
  worker: "师傅",
  customer: "用户",
  system: "系统",
};
const ROLE_COLOR: Record<ActivityRoleFilter, string> = {
  admin: "#2563eb",
  worker: "#059669",
  customer: "#d97706",
  system: "#6b7280",
};
const TARGET_LABEL: Record<ActivityTargetTypeFilter, string> = {
  order: "订单",
  master: "师傅",
  serviceSku: "服务 SKU",
  dispatchRule: "派单规则",
};
// action 中文标签 — 表格里简短显示
const ACTION_LABEL: Record<ActivityAction, string> = {
  order_created: "新建订单",
  order_assigned: "派单",
  service_started: "开始服务",
  order_completed: "完成订单",
  order_canceled: "取消订单",
  order_dispatch_canceled: "取消派单",
  order_refunded: "退款",
  order_internal_remark_updated: "改内部备注",
  order_service_summary_added: "填服务说明",
  master_created: "新增师傅",
  master_updated: "更新师傅",
  service_sku_created: "新增 SKU",
  service_sku_updated: "更新 SKU",
  dispatch_rule_created: "新增规则",
  dispatch_rule_updated: "更新规则",
  auto_dispatch_failed: "派单失败",
};

function formatDateTime(iso: Date | string) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 构造 /activity-logs 的 URL — 空值不写入 URL（CLAUDE.md 业务规则 #8）
 * 多个下拉 / 分页按钮共用一份 URL 构造，避免在 4 处手抄。
 */
function buildActivityLogsUrl(params: {
  actorRole?: string;
  action?: string;
  targetType?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.actorRole && params.actorRole !== "all")
    sp.set("actorRole", params.actorRole);
  if (params.action && params.action !== "all") sp.set("action", params.action);
  if (params.targetType && params.targetType !== "all")
    sp.set("targetType", params.targetType);
  if (params.keyword) sp.set("keyword", params.keyword);
  // page != "1" 才写入 URL；pageSize != "10" 才写入（避免 URL 噪音）
  if (params.page && params.page !== "1") sp.set("page", params.page);
  if (params.pageSize && params.pageSize !== "10")
    sp.set("pageSize", params.pageSize);
  const qs = sp.toString();
  return `/activity-logs${qs ? `?${qs}` : ""}`;
}

export default async function ActivityLogsPage({ searchParams }: PageProps) {
  const {
    actorRole: actorRoleRaw = "all",
    action: actionRaw = "all",
    targetType: targetTypeRaw = "all",
    keyword = "",
    page: pageRaw = "1",
    pageSize: pageSizeRaw = "10",
  } = await searchParams;

  // 白名单校验：URL 手改成 ?actorRole=hacker 也不能传透（P1 风险 #4）
  const actorRole = (ACTIVITY_ROLES as readonly string[]).includes(actorRoleRaw)
    ? (actorRoleRaw as ActivityRoleFilter | "all")
    : "all";
  const action = (ACTIVITY_ACTIONS as readonly string[]).includes(actionRaw)
    ? (actionRaw as ActivityAction | "all")
    : "all";
  const targetType = (ACTIVITY_TARGET_TYPES as readonly string[]).includes(
    targetTypeRaw,
  )
    ? (targetTypeRaw as ActivityTargetTypeFilter | "all")
    : "all";

  const currentPage = Math.max(1, parseInt(pageRaw, 10) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSizeRaw))
    ? Number(pageSizeRaw)
    : 10;

  // 过滤条件（all = 不过滤）
  const filter = {
    actorRole: actorRole === "all" ? undefined : actorRole,
    action: action === "all" ? undefined : action,
    targetType: targetType === "all" ? undefined : targetType,
    keyword: keyword.trim() || undefined,
  };

  const { logs, totalCount } = await listActivityLogs(
    filter,
    currentPage,
    pageSize,
  );
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const isFiltering =
    actorRole !== "all" ||
    action !== "all" ||
    targetType !== "all" ||
    !!keyword.trim();

  return (
    <main
      style={{
        padding: "24px 48px 48px",
        background: "#f7f8fa",
        minHeight: "calc(100vh - 56px)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>操作日志</h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        共 {totalCount} 条 · 当前页 {logs.length} 条 / 第 {currentPage} /{" "}
        {totalPages} 页
      </p>

      {/* 筛选器 — form method=get 改 URL，RSC 重读 searchParams 渲染 */}
      <form
        method="get"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          background: "#fff",
          padding: 16,
          borderRadius: 8,
          border: "1px solid #e5e7eb",
        }}
      >
        <input
          type="text"
          name="keyword"
          defaultValue={keyword}
          placeholder="搜索日志内容（如订单号、师傅名）"
          style={{
            flex: "1 1 240px",
            minWidth: 200,
            padding: "8px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 14,
            background: "#fff",
            outline: "none",
          }}
        />
        <select name="actorRole" defaultValue={actorRole} style={selectStyle}>
          <option value="all">全部角色</option>
          {ACTIVITY_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select name="action" defaultValue={action} style={selectStyle}>
          <option value="all">全部动作</option>
          {ACTIVITY_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
        <select name="targetType" defaultValue={targetType} style={selectStyle}>
          <option value="all">全部对象</option>
          {ACTIVITY_TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {TARGET_LABEL[t]}
            </option>
          ))}
        </select>
        {/* 提交时 page 重置 1 */}
        <input type="hidden" name="page" value="1" />
        <button type="submit" style={submitBtnStyle}>
          搜索
        </button>
        {isFiltering ? (
          <Link
            href="/activity-logs"
            style={{
              padding: "8px 14px",
              background: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            重置
          </Link>
        ) : null}
      </form>

      {/* 表格 */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {logs.length === 0 ? (
          <div
            style={{
              padding: "48px 0",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 14,
            }}
          >
            暂无符合条件的操作日志
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>时间</th>
                <th style={th}>操作人</th>
                <th style={th}>角色</th>
                <th style={th}>动作类型</th>
                <th style={th}>操作对象</th>
                <th style={th}>日志内容</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const role = log.actorRole as ActivityRoleFilter;
                const tType = log.targetType as ActivityTargetTypeFilter;
                return (
                  <tr key={log.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                    <td style={tdMono}>{formatDateTime(log.createdAt)}</td>
                    <td style={td}>{log.actorName ?? "—"}</td>
                    <td style={td}>
                      <span
                        style={{
                          background: ROLE_COLOR[role] ?? "#6b7280",
                          color: "#fff",
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 3,
                          display: "inline-block",
                        }}
                      >
                        {ROLE_LABEL[role] ?? role}
                      </span>
                    </td>
                    <td style={td}>
                      <code style={codeStyle}>{log.action}</code>
                    </td>
                    <td style={td}>
                      {TARGET_LABEL[tType] ?? tType}
                      <span
                        style={{
                          color: "#9ca3af",
                          fontSize: 11,
                          marginLeft: 6,
                        }}
                      >
                        ({log.targetId})
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: 360 }}>{log.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* 分页 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            marginTop: 16,
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <label style={{ fontSize: 13, color: "#6b7280" }}>每页</label>
          <select
            name="pageSize"
            defaultValue={String(pageSize)}
            style={{
              padding: "4px 8px",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              fontSize: 13,
              background: "#fff",
              outline: "none",
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 13, color: "#6b7280" }}>条</span>
          <Link
            href={buildActivityLogsUrl({
              actorRole,
              action,
              targetType,
              keyword,
              page: String(Math.max(1, currentPage - 1)),
              pageSize: String(pageSize),
            })}
            style={{
              ...pageLinkStyle,
              color: currentPage === 1 ? "#d1d5db" : "#374151",
              pointerEvents: currentPage === 1 ? "none" : "auto",
            }}
          >
            上一页
          </Link>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            第 {currentPage} / {totalPages} 页
          </span>
          <Link
            href={buildActivityLogsUrl({
              actorRole,
              action,
              targetType,
              keyword,
              page: String(currentPage + 1),
              pageSize: String(pageSize),
            })}
            style={{
              ...pageLinkStyle,
              color: currentPage >= totalPages ? "#d1d5db" : "#374151",
              pointerEvents: currentPage >= totalPages ? "none" : "auto",
            }}
          >
            下一页
          </Link>
        </div>
      </section>
    </main>
  );
}

// ============================================================
// 内联样式（参考 /orders 风格统一）
// ============================================================
const selectStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  background: "#fff",
  outline: "none",
  minWidth: 120,
};

const submitBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  fontSize: 13,
  color: "#374151",
  borderBottom: "2px solid #e5e7eb",
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 13,
  color: "#111827",
  verticalAlign: "top",
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 12,
  color: "#374151",
  whiteSpace: "nowrap",
};

const codeStyle: React.CSSProperties = {
  background: "#f3f4f6",
  color: "#374151",
  padding: "1px 6px",
  borderRadius: 3,
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
};

const pageLinkStyle: React.CSSProperties = {
  padding: "6px 14px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
  textDecoration: "none",
};
