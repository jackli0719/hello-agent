import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { card } from "@/components/ui";
import { updatePlatformAreaAction } from "@/app/platform-areas/actions";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { getPlatformArea } from "@/src/lib/areas";
import { ensureCsrfCookie } from "@/src/lib/csrf";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

const readonlyStyle: React.CSSProperties = {
  padding: "9px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  background: "#f9fafb",
  color: "#374151",
};

export default async function EditPlatformAreaPage({
  params,
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const [{ id }, { error }, csrfToken] = await Promise.all([
    params,
    searchParams,
    ensureCsrfCookie(),
  ]);
  const area = await getPlatformArea(id);
  if (!area) notFound();

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
          href="/platform-areas"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          ← 返回区域列表
        </Link>
      </div>
      <h1 style={{ fontSize: 24, margin: "0 0 20px 0" }}>编辑平台合作区域</h1>

      <section style={{ ...card, maxWidth: 640 }}>
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
        <form action={updatePlatformAreaAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="id" value={area.id} />
          <input type="hidden" name="province" value={area.province} />
          <input type="hidden" name="city" value={area.city} />
          <input type="hidden" name="district" value={area.district} />
          <input type="hidden" name="street" value={area.street} />
          {[
            ["省", area.province],
            ["市", area.city],
            ["区县", area.district],
            ["街道 / 乡镇", area.street],
          ].map(([label, value]) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
                {label}
              </div>
              <div style={readonlyStyle}>{value}</div>
            </div>
          ))}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={area.enabled}
            />
            <span style={{ fontSize: 14 }}>启用</span>
          </label>
          <button
            type="submit"
            style={{
              padding: "9px 18px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            保存
          </button>
        </form>
      </section>
    </main>
  );
}
