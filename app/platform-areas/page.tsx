import Link from "next/link";
import { redirect } from "next/navigation";
import { card, th, td, StatusBadge } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { listPlatformAreas } from "@/src/lib/areas";

interface PageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export default async function PlatformAreasPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const { created, updated } = await searchParams;
  const areas = await listPlatformAreas();

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
        <h1 style={{ fontSize: 24, margin: 0 }}>平台合作区域</h1>
        <Link
          href="/platform-areas/new"
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
          + 新增区域
        </Link>
      </div>
      <p style={{ color: "#6b7280", margin: "0 0 12px 0", fontSize: 14 }}>
        {areas.length} 个已开放合作区域
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
          {created ? "区域创建成功" : "区域更新成功"}
        </div>
      )}

      <section style={card}>
        {areas.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无平台合作区域
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>省</th>
                <th style={th}>市</th>
                <th style={th}>区县</th>
                <th style={th}>街道 / 乡镇</th>
                <th style={th}>是否启用</th>
                <th style={th}>创建时间</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => (
                <tr key={area.id}>
                  <td style={td}>{area.province}</td>
                  <td style={td}>{area.city}</td>
                  <td style={td}>{area.district}</td>
                  <td style={td}>{area.street}</td>
                  <td style={td}>
                    <StatusBadge
                      label={area.enabled ? "启用" : "停用"}
                      tone={area.enabled ? "green" : "gray"}
                    />
                  </td>
                  <td style={td}>{area.createdAt.toLocaleString("zh-CN")}</td>
                  <td style={td}>
                    <Link
                      href={`/platform-areas/${area.id}/edit`}
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
