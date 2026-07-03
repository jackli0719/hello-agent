// [任务 T2-1] 师傅提现申请列表 + 创建 + 审核页面
//
// 设计：
// - RSC：上方「可提现余额」+ 创建表单（worker 可见）+ 下方列表
// - worker 角色：只看自己的申请 + 创建新申请（看不到审核操作）
// - admin 角色：看所有申请 + 内联审核表单（approve / reject）
// - pending 唯一：DB partial unique + 事务兜底
//
// 权限：
// - worker + admin 共享同一路由
// - 创建按钮：worker 角色自动绑定；admin 不能代发
// - 审核按钮：仅 admin 可见

import { redirect } from "next/navigation";
import { card, th, td, StatusBadge } from "@/components/ui";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import {
  getWorkerAvailable,
  listWorkerWithdrawRequests,
} from "@/src/lib/worker-withdraw-request";
import {
  approveWorkerWithdrawRequestAction,
  createWorkerWithdrawRequestAction,
  rejectWorkerWithdrawRequestAction,
} from "./actions";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    created?: string;
  }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function WorkerWithdrawRequestsPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // 仅 worker / admin 可访问
  if (user.role !== "worker" && user.role !== "admin") {
    redirect(DEFAULT_LANDING[user.role]);
  }
  const isAdmin = user.role === "admin";
  // worker 必须绑了 workerId
  const scopedWorkerId = isAdmin ? null : user.workerId;

  const { error, created } = await searchParams;
  const csrfToken = await ensureCsrfCookie();

  // 1. 申请列表
  //   - admin 看全部
  //   - worker 只看自己的
  const requests = await listWorkerWithdrawRequests(
    scopedWorkerId ? { workerId: scopedWorkerId } : undefined,
  );

  // 2. 当前"我"的可提现余额
  //   - worker 算自己
  //   - admin 算所有 worker 中位（不太合理；用第一个 pending 关联的 worker 余额；否则不算）
  //     简化：admin 进页不展示自己的余额卡（仅 worker 角色展示）
  let myAvailable: Awaited<ReturnType<typeof getWorkerAvailable>> | null = null;
  if (scopedWorkerId) {
    myAvailable = await getWorkerAvailable(scopedWorkerId);
  }

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
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>师傅提现申请</h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        共 {requests.length} 笔 · pending{" "}
        {requests.filter((r) => r.status === "pending").length} · 已通过{" "}
        {requests.filter((r) => r.status === "approved").length} · 已拒绝{" "}
        {requests.filter((r) => r.status === "rejected").length}
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          （只做申请和审核，不做真实打款）
        </span>
      </p>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          ⚠️ {error}
        </div>
      )}
      {created && (
        <div
          style={{
            padding: "10px 14px",
            background: "#dcfce7",
            color: "#15803d",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          ✓ 申请 {created.slice(0, 12)}… 创建成功，待审核
        </div>
      )}

      {/* 可提现余额卡（仅 worker 角色展示） */}
      {myAvailable && (
        <section style={card}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>我的可提现余额</h2>
          <div
            style={{
              display: "flex",
              gap: 24,
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: myAvailable.available <= 0 ? "#b91c1c" : "#15803d",
              }}
            >
              {formatYuan(myAvailable.available)}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              累计收入 {formatYuan(myAvailable.totalIncome)} − 占用中{" "}
              {formatYuan(myAvailable.totalPending)}
            </div>
          </div>
        </section>
      )}

      {/* 创建表单（仅 worker） */}
      {scopedWorkerId && (
        <section style={card}>
          <h2 style={{ fontSize: 16, margin: "0 0 14px 0" }}>新建提现申请</h2>
          <form
            action={createWorkerWithdrawRequestAction}
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <input type="hidden" name="_csrf" value={csrfToken} />

            <div style={{ flex: 1, minWidth: 140 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#374151",
                  marginBottom: 4,
                }}
              >
                申请金额（元）
              </label>
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0.01"
                required
                placeholder="如 100.00"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ flex: 2, minWidth: 200 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#374151",
                  marginBottom: 4,
                }}
              >
                用途说明（可选）
              </label>
              <input
                type="text"
                name="remark"
                maxLength={500}
                placeholder="如：本月生活费"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: "8px 18px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              提交申请
            </button>
          </form>
        </section>
      )}

      {/* 列表 */}
      <section style={card}>
        {requests.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无师傅提现申请
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>申请时间</th>
                {isAdmin && <th style={th}>师傅</th>}
                <th style={th}>金额</th>
                <th style={th}>用途</th>
                <th style={th}>状态</th>
                <th style={th}>
                  {isAdmin ? "审核信息 / 操作" : "审核信息"}
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} id={r.id}>
                  <td style={td}>
                    <div style={{ fontSize: 13 }}>
                      {r.createdAt.toLocaleString("zh-CN")}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>
                      id: {r.id.slice(0, 12)}…
                    </div>
                  </td>
                  {isAdmin && (
                    <td style={td}>
                      <div style={{ fontSize: 13 }}>{r.worker.name}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>
                        {r.worker.phone}
                      </div>
                    </td>
                  )}
                  <td style={{ ...td, color: "#15803d", fontWeight: 600 }}>
                    {formatYuan(r.amount)}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "#6b7280" }}>
                    {r.remark || <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                  <td style={td}>
                    {r.status === "pending" ? (
                      <StatusBadge label="待审核" tone="amber" />
                    ) : r.status === "approved" ? (
                      <StatusBadge label="已通过" tone="green" />
                    ) : (
                      <StatusBadge label="已拒绝" tone="red" />
                    )}
                  </td>
                  <td style={td}>
                    {r.status === "pending" && isAdmin ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <form
                          action={approveWorkerWithdrawRequestAction}
                          style={{ display: "inline" }}
                        >
                          <input
                            type="hidden"
                            name="_csrf"
                            value={csrfToken}
                          />
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            style={{
                              padding: "4px 12px",
                              background: "#15803d",
                              color: "#fff",
                              border: "none",
                              borderRadius: 4,
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            通过
                          </button>
                        </form>
                        <form
                          action={rejectWorkerWithdrawRequestAction}
                          style={{
                            display: "flex",
                            gap: 4,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <input
                            type="hidden"
                            name="_csrf"
                            value={csrfToken}
                          />
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            type="text"
                            name="rejectReason"
                            required
                            placeholder="拒绝原因"
                            maxLength={500}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #d1d5db",
                              borderRadius: 4,
                              fontSize: 12,
                              width: 140,
                            }}
                          />
                          <button
                            type="submit"
                            style={{
                              padding: "4px 10px",
                              background: "#b91c1c",
                              color: "#fff",
                              border: "none",
                              borderRadius: 4,
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            拒绝
                          </button>
                        </form>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {r.reviewerName && (
                          <div>
                            {r.status === "approved" ? "✓" : "✗"}{" "}
                            {r.reviewerName}
                          </div>
                        )}
                        {r.reviewedAt && (
                          <div style={{ color: "#9ca3af" }}>
                            {r.reviewedAt.toLocaleString("zh-CN")}
                          </div>
                        )}
                        {r.rejectReason && (
                          <div
                            style={{
                              color: "#b91c1c",
                              fontStyle: "italic",
                              marginTop: 4,
                            }}
                          >
                            {r.rejectReason}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
