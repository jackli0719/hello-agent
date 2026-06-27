import Link from "next/link";
import { card, th, td } from "@/components/ui";
import { listMasters } from "@/src/lib/repos/masters";
import { skillsToString } from "@/src/lib/masters";

interface PageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  available: "可接单",
  busy: "服务中",
  offline: "离线",
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  available: { bg: "#dcfce7", fg: "#15803d" },
  busy: { bg: "#dbeafe", fg: "#1d4ed8" },
  offline: { bg: "#f3f4f6", fg: "#6b7280" },
};

export default async function MastersPage({ searchParams }: PageProps) {
  const { created, updated } = await searchParams;
  const masters = await listMasters();

  return (
    <>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>师傅管理</h1>
          <Link
            href="/masters/new"
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
            + 新增师傅
          </Link>
        </div>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          共 {masters.length} 位师傅
        </p>

        {created && (
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
            ✓ 师傅 <strong>{created}</strong> 创建成功
          </div>
        )}
        {updated && (
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
            ✓ 师傅 <strong>{updated}</strong> 更新成功
          </div>
        )}

        <section style={card}>
          {masters.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}>
              暂无师傅，点右上「+ 新增师傅」创建第一位
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>姓名</th>
                  <th style={th}>手机号</th>
                  <th style={th}>技能</th>
                  <th style={th}>评分</th>
                  <th style={th}>是否可接单</th>
                  <th style={th}>服务区域</th>
                  <th style={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {masters.map((m) => {
                  const sc = STATUS_COLOR[m.status] ?? STATUS_COLOR.offline;
                  return (
                    <tr key={m.id}>
                      <td style={td}>{m.name}</td>
                      <td style={td}>{m.phone}</td>
                      <td style={{ ...td, maxWidth: 260 }}>
                        {m.skills.length > 0 ? skillsToString(m.skills) : <span style={{ color: "#9ca3af" }}>—</span>}
                      </td>
                      <td style={td}>⭐ {m.rating.toFixed(1)}</td>
                      <td style={td}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            background: sc.bg,
                            color: sc.fg,
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {STATUS_LABEL[m.status] ?? m.status}
                        </span>
                      </td>
                      <td style={td}>
                        {m.serviceArea || <span style={{ color: "#9ca3af" }}>—</span>}
                      </td>
                      <td style={td}>
                        <Link
                          href={`/masters/${m.id}/edit`}
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
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}