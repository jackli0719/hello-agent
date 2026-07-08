// [任务 18] 商家端提现申请表单
//
// 设计：
// - 顶部「可提现余额」卡 — 调 getMerchantAvailable（withdraw-request.ts:78）
// - 表单：金额（元，必填） + 用途说明（可选，500 字以内）
// - 提交：调 createMerchantWithdrawRequestAction（强制 requireMerchant + requireCsrf）
// - ?error= 提示失败原因（已有 pending 申请 / 金额异常 / 商户未激活）

import { redirect } from "next/navigation";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId } from "@/src/lib/merchant-admin";
import { getMerchantAvailable } from "@/src/lib/withdraw-request";
import { card } from "@/components/ui";
import { createMerchantWithdrawRequestAction } from "./actions";

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default async function NewMerchantWithdrawRequestPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let merchantId: string;
  try {
    merchantId = await getEffectiveMerchantId(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未授权";
    return <div style={{ ...card, color: "#b91c1c" }}>{msg}。</div>;
  }

  const { error } = await searchParams;
  const csrfToken = await ensureCsrfCookie();
  const { available } = await getMerchantAvailable(merchantId);

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>申请新提现</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 24px 0" }}>
        提交后由平台审核，审核通过后会另行通知。
      </p>

      {/* 余额卡 */}
      <div
        data-testid="merchant-available-card"
        style={{
          ...card,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 6 }}>
            当前可提现余额
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "#15803d" }}>
            {formatYuan(available)}
          </div>
        </div>
        <div style={{ color: "#9ca3af", fontSize: 12, textAlign: "right" }}>
          来自已确认 / 已归档的月度结算
          <br />− 待审核 / 已批准中的申请
        </div>
      </div>

      {error && (
        <div
          data-testid="withdraw-error-toast"
          style={{
            padding: "12px 16px",
            background: "#fee2e2",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 13,
            marginBottom: 16,
            border: "1px solid #fecaca",
          }}
        >
          ✗ {decodeURIComponent(error)}
        </div>
      )}

      <form action={createMerchantWithdrawRequestAction}>
        <input type="hidden" name="_csrf" value={csrfToken} />

        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="amount"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 6,
              color: "#374151",
            }}
          >
            申请金额（元）<span style={{ color: "#b91c1c" }}>*</span>
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            placeholder="例如 100.00"
            data-testid="amount-input"
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label
            htmlFor="remark"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 6,
              color: "#374151",
            }}
          >
            用途说明（可选，500 字以内）
          </label>
          <textarea
            id="remark"
            name="remark"
            maxLength={500}
            rows={3}
            placeholder="如：6 月运营成本结算"
            data-testid="remark-input"
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              boxSizing: "border-box",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            data-testid="submit-withdraw"
            style={{
              padding: "8px 20px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            提交申请
          </button>
          <a
            href={BACK}
            style={{
              padding: "8px 20px",
              background: "#f3f4f6",
              color: "#374151",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
              lineHeight: "1.55",
            }}
          >
            取消
          </a>
        </div>
      </form>
    </div>
  );
}

const BACK = "/merchant-admin/withdraw-requests";
