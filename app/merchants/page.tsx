import Link from "next/link";
import { redirect } from "next/navigation";
import { card, th, td, StatusBadge } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { listMerchants } from "@/src/lib/merchants";

interface PageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export default async function MerchantsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const { created, updated } = await searchParams;
  const merchants = await listMerchants();

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>商家管理</h1>
        <Link
          href="/merchants/new"
          style={{
            padding: "8px 18px",
            background: "#2563eb",
            color: "#fff",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          + 新增商家
        </Link>
      </div>
      <p style={{ color: "#6b7280", margin: "0 0 12px 0", fontSize: 14 }}>
        {merchants.length} 个商家基础资料
      </p>

      {(created || updated) && (
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
          {created ? "商家创建成功" : "商家更新成功"}
        </div>
      )}

      <section style={card}>
        {merchants.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无商家
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>商家名称</th>
                <th style={th}>联系人</th>
                <th style={th}>电话</th>
                <th style={th}>状态</th>
                {/* [任务 4] 邀请码展示 — /worker/join 用 */}
                <th style={th}>邀请码</th>
                <th style={th}>邀请码状态</th>
                <th style={th}>省</th>
                <th style={th}>市</th>
                <th style={th}>区县</th>
                <th style={th}>街道</th>
                <th style={th}>绑定区域</th>
                <th style={th}>旗下师傅</th>
                <th style={th}>详细地址</th>
                <th style={th}>创建时间</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((merchant) => (
                <tr key={merchant.id}>
                  <td style={td}>{merchant.name}</td>
                  <td style={td}>{merchant.contactName}</td>
                  <td style={td}>{merchant.phone}</td>
                  <td style={td}>
                    <StatusBadge
                      label={merchant.status === "active" ? "启用" : "停用"}
                      tone={merchant.status === "active" ? "green" : "gray"}
                    />
                  </td>
                  {/* [任务 4] 邀请码 — 师傅 /worker/join 用 */}
                  <td
                    style={{
                      ...td,
                      fontFamily: "monospace",
                      letterSpacing: 1,
                      fontSize: 13,
                    }}
                  >
                    {merchant.inviteCode}
                  </td>
                  <td style={td}>
                    <StatusBadge
                      label={merchant.inviteCodeEnabled ? "可用" : "禁用"}
                      tone={merchant.inviteCodeEnabled ? "green" : "red"}
                    />
                  </td>
                  <td style={td}>{merchant.province}</td>
                  <td style={td}>{merchant.city}</td>
                  <td style={td}>{merchant.district}</td>
                  <td style={td}>{merchant.street}</td>
                  <td style={td}>{merchant._count.merchantAreas}</td>
                  <td style={td}>{merchant._count.masters}</td>
                  <td style={{ ...td, maxWidth: 180 }}>
                    {merchant.addressDetail || "—"}
                  </td>
                  <td style={td}>
                    {merchant.createdAt.toLocaleString("zh-CN")}
                  </td>
                  <td style={td}>
                    <Link
                      href={`/merchants/${merchant.id}/edit`}
                      style={{
                        color: "#2563eb",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      编辑
                    </Link>
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
