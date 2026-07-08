// [任务 18] 商家端 layout — 守卫 + 顶部 nav
//
// 设计：
// - RSC 守卫：未登录跳 /login；非 merchant/admin 角色跳自己默认页（防 worker/customer 越权）
//   - merchant 角色：用 session.merchantId（强绑）
//   - admin 角色：放行（CLAUDE.md 演示便利 + 排障）— 子页用 getEffectiveMerchantId fallback
// - 顶部 6 个 tab：总览 / 订单 / 师傅 / 结算 / 提现记录 / 邀请码
// - 提现记录 + 邀请码 tab 是写操作（商家可申请提现 / 启停邀请码），其他 4 tab 只读

import Link from "next/link";
import { redirect } from "next/navigation";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";

export default async function MerchantAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/merchant-admin");
  // 只放 admin + merchant；其他角色跳自己默认页（worker/customer 不该看到商家后台）
  if (user.role !== "merchant" && user.role !== "admin") {
    redirect(DEFAULT_LANDING[user.role] ?? "/login");
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
      {/* 顶部商家身份标识 + 4 个 tab */}
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          border: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>
            商家后台
          </div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            商家编码：
            <code
              style={{
                background: "#f3f4f6",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              {user.merchantId ?? "(未绑定)"}
            </code>
            {" · 账号："}
            {user.name}
          </div>
        </div>
        <nav style={{ display: "flex", gap: 8 }}>
          <TabLink href="/merchant-admin" label="总览" />
          <TabLink href="/merchant-admin/orders" label="订单" />
          <TabLink href="/merchant-admin/masters" label="师傅" />
          <TabLink href="/merchant-admin/settlements" label="结算" />
          <TabLink href="/merchant-admin/withdraw-requests" label="提现记录" />
          <TabLink href="/merchant-admin/invite-codes" label="邀请码" />
        </nav>
      </div>
      {children}
    </main>
  );
}

function TabLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 14px",
        borderRadius: 6,
        background: "#f3f4f6",
        color: "#374151",
        fontSize: 13,
        fontWeight: 500,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
