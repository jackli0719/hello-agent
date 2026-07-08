import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { card, th, td, StatusBadge } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { getMerchantSettlementDetail } from "@/src/lib/merchant-settlement";
import {
  listPayoutsBySettlement,
  sumPayoutsBySettlement,
} from "@/src/lib/payout";
import {
  archiveMerchantSettlementAction,
  confirmMerchantSettlementAction,
  createPayoutAction,
} from "../actions";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; payout?: string }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function MerchantSettlementDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const [{ id }, { error, payout: payoutFlash }, csrfToken] = await Promise.all(
    [params, searchParams, ensureCsrfCookie()],
  );
  const data = await getMerchantSettlementDetail(id);
  if (!data) notFound();
  const { summary, previews } = data;

  // [任务 12] 加载打款记录 + 累计
  const [payouts, payoutSum] = await Promise.all([
    listPayoutsBySettlement(summary.id),
    sumPayoutsBySettlement(summary.id),
  ]);
  const payoutRemaining = summary.merchantIncome - payoutSum;
  const payoutCanRecord =
    summary.status === "confirmed" || summary.status === "archived";

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
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/merchant-settlements"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          ← 返回汇总列表
        </Link>
      </div>
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>
        商家结算详情 — {summary.merchant.name}
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          fontSize: 14,
        }}
      >
        <span style={{ color: "#6b7280" }}>期间</span>
        <span
          style={{
            fontFamily: "monospace",
            background: "#f3f4f6",
            padding: "2px 6px",
            borderRadius: 3,
            fontSize: 13,
          }}
        >
          {summary.period}
        </span>
        <StatusBadge
          label={
            summary.status === "pending"
              ? "待确认"
              : summary.status === "confirmed"
                ? "已确认"
                : "已归档"
          }
          tone={
            summary.status === "pending"
              ? "gray"
              : summary.status === "confirmed"
                ? "green"
                : "red"
          }
        />
      </div>

      {/* 状态操作按钮 */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      {payoutFlash && (
        <div
          style={{
            padding: "10px 14px",
            background: "#dcfce7",
            color: "#15803d",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          打款记录录入成功：{payoutFlash}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {/* pending → 确认按钮 */}
        {summary.status === "pending" && (
          <form action={confirmMerchantSettlementAction}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="id" value={summary.id} />
            <button
              type="submit"
              style={{
                padding: "8px 18px",
                background: "#15803d",
                color: "#fff",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              确认结算
            </button>
          </form>
        )}
        {/* pending / confirmed → 关闭周期按钮 */}
        {summary.status !== "archived" && (
          <form action={archiveMerchantSettlementAction}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="id" value={summary.id} />
            <button
              type="submit"
              style={{
                padding: "8px 18px",
                background: "#fff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              关闭周期（归档）
            </button>
          </form>
        )}
        {summary.status === "archived" && (
          <span
            style={{
              padding: "8px 18px",
              color: "#9ca3af",
              fontSize: 13,
            }}
          >
            归档后只读
          </span>
        )}
        {/* [任务 11] 导出本条 CSV — 仅 confirmed/archived 可导（pending 不导） */}
        {(summary.status === "confirmed" || summary.status === "archived") && (
          <a
            href={`/api/merchant-settlements/export?scope=one&id=${summary.id}`}
            style={{
              padding: "8px 18px",
              background: "#7c3aed",
              color: "#fff",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            导出本条 CSV
          </a>
        )}
      </div>

      {/* 1. 商家信息 */}
      <section style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>商家信息</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            fontSize: 13,
          }}
        >
          <Field label="商家 ID" value={summary.merchant.id} mono />
          <Field label="商家名称" value={summary.merchant.name} />
          <Field
            label="状态"
            value={summary.merchant.status === "active" ? "启用" : "停用"}
          />
          <Field label="联系人" value={summary.merchant.contactName} />
          <Field label="电话" value={summary.merchant.phone} />
          <Field label="邀请码" value={summary.merchant.inviteCode} mono />
          <Field
            label="邀请码状态"
            value={summary.merchant.inviteCodeEnabled ? "可用" : "禁用"}
          />
          <Field
            label="省 / 市"
            value={`${summary.merchant.province} / ${summary.merchant.city}`}
          />
          <Field
            label="区县 / 街道"
            value={`${summary.merchant.district} / ${summary.merchant.street}`}
          />
        </div>
      </section>

      {/* 2. 周期汇总 */}
      <section style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>
          周期汇总（{summary.period}）
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          <StatCard
            label="订单数"
            value={String(summary.totalOrderCount)}
            color="#111827"
          />
          <StatCard
            label="订单总金额"
            value={formatYuan(summary.totalAmount)}
            color="#15803d"
          />
          <StatCard
            label="平台费"
            value={formatYuan(summary.platformFee)}
            color="#1d4ed8"
          />
          <StatCard
            label="商家 + 师傅收"
            value={formatYuan(summary.merchantIncome + summary.workerIncome)}
            color="#7c3aed"
          />
        </div>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            padding: 12,
            background: "#f9fafb",
            borderRadius: 6,
          }}
        >
          <SplitCard
            label="平台费"
            value={summary.platformFee}
            total={summary.totalAmount}
            color="#1d4ed8"
          />
          <SplitCard
            label="商家收"
            value={summary.merchantIncome}
            total={summary.totalAmount}
            color="#7c3aed"
          />
          <SplitCard
            label="师傅收"
            value={summary.workerIncome}
            total={summary.totalAmount}
            color="#15803d"
          />
        </div>
      </section>

      {/* 3. 订单明细 */}
      <section style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>
          订单明细（{previews.length} 条）
        </h2>
        {previews.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 14, padding: "20px 0" }}>
            该期间暂无订单（可能 SettlementPreview 已被删除）
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>订单</th>
                <th style={th}>客户 / 服务</th>
                <th style={th}>师傅</th>
                <th style={th}>使用策略</th>
                <th style={th}>订单金额</th>
                <th style={th}>平台</th>
                <th style={th}>商家</th>
                <th style={th}>师傅</th>
              </tr>
            </thead>
            <tbody>
              {previews.map((p) => (
                <tr key={p.id}>
                  <td style={td}>
                    <Link
                      href={`/orders/${p.order.id}`}
                      style={{
                        color: "#2563eb",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {p.order.id}
                    </Link>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {p.order.status}
                    </div>
                  </td>
                  <td style={td}>
                    <div>{p.order.customerName}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {p.order.serviceName}
                    </div>
                  </td>
                  <td style={td}>
                    <div>{p.master.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {p.master.phone}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {p.strategy ? (
                      <>
                        {p.strategy.name}
                        <div style={{ color: "#9ca3af", fontSize: 11 }}>
                          {p.strategy.strategyType === "percentage"
                            ? "按比例"
                            : "固定金额"}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>无</span>
                    )}
                  </td>
                  <td style={td}>{formatYuan(p.orderAmount)}</td>
                  <td style={{ ...td, color: "#1d4ed8" }}>
                    {formatYuan(p.platformAmount)}
                  </td>
                  <td style={{ ...td, color: "#7c3aed" }}>
                    {formatYuan(p.merchantAmount)}
                  </td>
                  <td style={{ ...td, color: "#15803d" }}>
                    {formatYuan(p.workerAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* [任务 12] 4. 线下打款记录 */}
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>
          线下打款记录（{payouts.length} 条）
        </h2>

        {/* 累计 vs 应收 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            padding: 12,
            background: "#f9fafb",
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              本期应收（商家收）
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#7c3aed" }}>
              {formatYuan(summary.merchantIncome)}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              累计已打款
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#15803d" }}>
              {formatYuan(payoutSum)}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              剩余未打款
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: payoutRemaining > 0 ? "#dc2626" : "#6b7280",
              }}
            >
              {formatYuan(payoutRemaining)}
            </div>
          </div>
        </div>

        {/* 录入表单 — 仅 confirmed / archived */}
        {payoutCanRecord ? (
          payoutRemaining > 0 ? (
            <form
              action={createPayoutAction}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.2fr 1.5fr auto",
                gap: 8,
                alignItems: "end",
                marginBottom: 16,
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
              }}
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <input type="hidden" name="settlementId" value={summary.id} />
              <Field
                label="打款金额（元）"
                value=""
                editable
                name="amount"
                placeholder="如 100.00"
              />
              <Field
                label="打款时间"
                value=""
                editable
                name="paidAt"
                type="datetime-local"
                placeholder=""
              />
              <Field
                label="凭证 URL（可选）"
                value=""
                editable
                name="proofUrl"
                placeholder="https://..."
              />
              <button
                type="submit"
                style={{
                  padding: "8px 18px",
                  background: "#15803d",
                  color: "#fff",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  height: 36,
                }}
              >
                录入打款
              </button>
            </form>
          ) : (
            <div
              style={{
                padding: "10px 14px",
                background: "#dcfce7",
                color: "#15803d",
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              已完成全部打款（累计 = 应收）
            </div>
          )
        ) : (
          <div
            style={{
              padding: "10px 14px",
              background: "#fef3c7",
              color: "#92400e",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            结算状态为「待确认」，需先确认或归档后才能录打款
          </div>
        )}

        {/* 已录入列表 */}
        {payouts.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 14, padding: "20px 0" }}>
            暂无打款记录
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>打款时间</th>
                <th style={th}>金额</th>
                <th style={th}>凭证</th>
                <th style={th}>操作人</th>
                <th style={th}>录入时间</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{p.paidAt.toLocaleString("zh-CN")}</td>
                  <td style={{ ...td, color: "#15803d", fontWeight: 500 }}>
                    {formatYuan(p.amount)}
                  </td>
                  <td style={td}>
                    {p.proofUrl ? (
                      <a
                        href={p.proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "#2563eb",
                          fontSize: 12,
                          textDecoration: "none",
                        }}
                      >
                        查看 ↗
                      </a>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  <td style={td}>{p.operator}</td>
                  <td style={td}>{p.createdAt.toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  mono,
  editable,
  name,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  mono?: boolean;
  editable?: boolean;
  name?: string;
  placeholder?: string;
  type?: string;
}) {
  if (editable && name) {
    return (
      <div>
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 2 }}>
          {label}
        </div>
        <input
          name={name}
          type={type ?? "text"}
          defaultValue={value}
          placeholder={placeholder}
          required
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: mono ? "monospace" : "inherit",
            background: "#fff",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>
    );
  }
  return (
    <div>
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: "#111827",
          fontFamily: mono ? "monospace" : "inherit",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "12px 8px",
        background: "#f9fafb",
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function SplitCard({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color }}>
        {formatYuan(value)}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
        占 {pct}%
      </div>
    </div>
  );
}
