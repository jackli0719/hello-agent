import Link from "next/link";
import { redirect } from "next/navigation";
import { card } from "@/components/ui";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { createPlatformAreaAction } from "@/app/platform-areas/actions";

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

function Field({
  label,
  name,
}: {
  label: string;
  name: "province" | "city" | "district" | "street";
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        {label}
      </div>
      <input name={name} required maxLength={50} style={inputStyle} />
    </label>
  );
}

export default async function NewPlatformAreaPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const [{ error }, csrfToken] = await Promise.all([
    searchParams,
    ensureCsrfCookie(),
  ]);

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
      <h1 style={{ fontSize: 24, margin: "0 0 20px 0" }}>新增平台合作区域</h1>

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
        <form action={createPlatformAreaAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <Field label="省" name="province" />
          <Field label="市" name="city" />
          <Field label="区县" name="district" />
          <Field label="街道 / 乡镇" name="street" />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <input type="checkbox" name="enabled" defaultChecked />
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
