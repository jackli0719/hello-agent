// [任务 13] 提现申请列表 + 创建 + 审核页面（admin 代发）
//
// 设计：
// - RSC：上方创建表单 + 下方列表
// - 每条 pending 显示 inline 审核表单（approve / reject）
// - approved / rejected 显示审核人 + 时间 + 原因
// - 同时按 merchantId 展示「可提现余额」

import Link from "next/link";
import { redirect } from "next/navigation";
import { card, th, td, StatusBadge } from "@/components/ui";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import {
  getMerchantAvailable,
  listWithdrawRequests,
} from "@/src/lib/withdraw-request";
import {
  approveWithdrawRequestAction,
  createWithdrawRequestAction,
  rejectWithdrawRequestAction,
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

export default async function WithdrawRequestsPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const { error, created } = await searchParams;
  const csrfToken = await ensureCsrfCookie();

  // 1. 所有 active 商家（下拉）
  const merchants = await prisma.merchant.findMany({
    where: { status: "active" },
    select: { id: true, name: true, contactName: true },
    orderBy: { name: "asc" },
  });

  // 2. 所有申请（含审核信息）
  const requests = await listWithdrawRequests();

  // 3. 按 merchantId 算一次可提现余额（给列表展示用）
  const merchantIds = Array.from(new Set(requests.map((r) => r.merchantId)));
  const availableMap = new Map<
    string,
    Awaited<ReturnType<typeof getMerchantAvailable>>
  >();
  await Promise.all(
    merchantIds.map(async (mid) => {
      const a = await getMerchantAvailable(mid);
      availableMap.set(mid, a);
    }),
  );

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
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>提现申请</h1>
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

      {/* 创建表单（admin 代发） */}
      <section style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 14px 0" }}>
          新建提现申请（admin 代发）
        </h2>
        {merchants.length === 0 ? (
          <div
            style={{ color: "#9ca3af", padding: "20px 0", textAlign: "center" }}
          >
            暂无 active 商家
          </div>
        ) : (
          <form
            action={createWithdrawRequestAction}
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <input type="hidden" name="_csrf" value={csrfToken} />

            <div style={{ flex: 2, minWidth: 200 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#374151",
                  marginBottom: 4,
                }}
              >
                商家
              </label>
              <select
                name="merchantId"
                required
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                <option value="">-- 请选择 --</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}（{m.contactName}）
                  </option>
                ))}
              </select>
            </div>

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
                placeholder="如：本月运营资金"
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
        )}
      </section>

      {/* 列表 */}
      <section style={card}>
        {requests.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无提现申请
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>申请时间</th>
                <th style={th}>商家</th>
                <th style={th}>金额</th>
                <th style={th}>可提现余额</th>
                <th style={th}>用途</th>
                <th style={th}>状态</th>
                <th style={th}>审核信息 / 操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const av = availableMap.get(r.merchantId);
                return (
                  <tr key={r.id} id={r.id}>
                    <td style={td}>
                      <div style={{ fontSize: 13 }}>
                        {r.createdAt.toLocaleString("zh-CN")}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>
                        id: {r.id.slice(0, 12)}…
                      </div>
                    </td>
                    <td style={td}>
                      <Link
                        href={`/merchants/${r.merchantId}/edit`}
                        style={{
                          color: "#2563eb",
                          fontSize: 13,
                          textDecoration: "none",
                        }}
                      >
                        {r.merchant.name}
                      </Link>
                    </td>
                    <td style={{ ...td, color: "#15803d", fontWeight: 600 }}>
                      {formatYuan(r.amount)}
                    </td>
                    <td style={td}>
                      {av ? (
                        <span
                          style={{
                            fontSize: 12,
                            color: av.available <= 0 ? "#b91c1c" : "#374151",
                          }}
                        >
                          {formatYuan(av.available)}
                        </span>
                      ) : (
                        <span style={{ color: "#9ca3af" }}>—</span>
                      )}
                      {av && (
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>
                          累计 {formatYuan(av.totalIncome)} − 已打{" "}
                          {formatYuan(av.totalPaid)} − 占用{" "}
                          {formatYuan(av.totalPending)}
                        </div>
                      )}
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
                      {r.status === "pending" ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {/* 审核通过按钮 */}
                          <form
                            action={approveWithdrawRequestAction}
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
                          {/* 拒绝表单：必填 rejectReason */}
                          <form
                            action={rejectWithdrawRequestAction}
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
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
