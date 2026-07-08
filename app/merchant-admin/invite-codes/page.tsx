// [任务 18] 商家端邀请码管理
//
// 设计：
// - 顶部大字展示当前邀请码（演示用 — 真实场景用 copy-to-clipboard）
// - 启停状态：button 切换（无 client 状态，用 server form post）
// - 重新生成：button 触发 regenerateInviteCodeAction（唯一性兜底重试 3 次）
// - merchant 强绑 session.merchantId — 不可越权

import { redirect } from "next/navigation";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId } from "@/src/lib/merchant-admin";
import { prisma } from "@/src/lib/db";
import { card } from "@/components/ui";
import { regenerateInviteCodeAction, toggleInviteCodeAction } from "./actions";

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function MerchantInviteCodesPage({
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
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      name: true,
      inviteCode: true,
      inviteCodeEnabled: true,
    },
  });
  if (!merchant) {
    return <div style={{ ...card, color: "#b91c1c" }}>商家不存在</div>;
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>邀请码管理</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 24px 0" }}>
        商家 <code>{merchant.name}</code>（<code>{merchant.id}</code>
        ）的入驻邀请码。
        邀请码由商家端生成，师傅在注册入驻时填入即绑定到本商家。
      </p>

      {error && (
        <div
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

      {/* 邀请码大字卡 */}
      <div
        data-testid="invite-code-display"
        style={{
          ...card,
          textAlign: "center",
          padding: "32px 16px",
          marginBottom: 24,
          background: merchant.inviteCodeEnabled ? "#fff" : "#f9fafb",
        }}
      >
        <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
          当前邀请码
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: merchant.inviteCodeEnabled ? "#111827" : "#9ca3af",
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
          }}
        >
          {merchant.inviteCode}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 13,
            color: merchant.inviteCodeEnabled ? "#15803d" : "#b91c1c",
            fontWeight: 500,
          }}
        >
          {merchant.inviteCodeEnabled ? "✓ 启用中" : "✗ 已禁用"}
        </div>
      </div>

      {/* 启停表单 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <form action={toggleInviteCodeAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            data-testid="toggle-invite-code"
            style={{
              padding: "8px 20px",
              background: merchant.inviteCodeEnabled ? "#fef3c7" : "#dcfce7",
              color: merchant.inviteCodeEnabled ? "#854d0e" : "#15803d",
              border: `1px solid ${merchant.inviteCodeEnabled ? "#fde68a" : "#86efac"}`,
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {merchant.inviteCodeEnabled ? "禁用此邀请码" : "启用此邀请码"}
          </button>
        </form>

        <form action={regenerateInviteCodeAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            data-testid="regenerate-invite-code"
            style={{
              padding: "8px 20px",
              background: "#f3f4f6",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            🔄 重新生成邀请码
          </button>
        </form>
      </div>

      <div
        style={{
          padding: "12px 16px",
          background: "#f0f9ff",
          borderRadius: 6,
          color: "#0c4a6e",
          fontSize: 12,
          border: "1px solid #bae6fd",
          lineHeight: 1.6,
        }}
      >
        💡 <strong>说明</strong>：
        <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
          <li>启用中：师傅注册填此码即绑定到本商家</li>
          <li>
            已禁用：新师傅注册时即使填此码也会被拒（已有历史绑定不受影响）
          </li>
          <li>重新生成：旧码立即失效，已用旧码注册的师傅不受影响</li>
          <li>演示期不支持在商家后台查看邀请码历史</li>
        </ul>
      </div>
    </div>
  );
}
