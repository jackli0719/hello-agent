import Link from "next/link";
import { redirect } from "next/navigation";
import { card } from "@/components/ui";
import { createMerchantAction } from "@/app/merchants/actions";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import { ensureCsrfCookie } from "@/src/lib/csrf";

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
  required = true,
  maxLength = 80,
  pattern,
}: {
  label: string;
  name: string;
  required?: boolean;
  maxLength?: number;
  pattern?: string;
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        {label}
      </div>
      <input
        name={name}
        required={required}
        maxLength={maxLength}
        pattern={pattern}
        style={inputStyle}
      />
    </label>
  );
}

export default async function NewMerchantPage({ searchParams }: PageProps) {
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
          href="/merchants"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          ← 返回商家列表
        </Link>
      </div>
      <h1 style={{ fontSize: 24, margin: "0 0 20px 0" }}>新增商家</h1>

      <section style={{ ...card, maxWidth: 720 }}>
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
        <form action={createMerchantAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <Field label="商家名称" name="name" />
          <Field label="联系人" name="contactName" maxLength={50} />
          <Field
            label="电话"
            name="phone"
            maxLength={11}
            pattern="1[0-9]{10}"
          />
          <label style={{ display: "block", marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
              状态
            </div>
            <select name="status" defaultValue="active" style={inputStyle}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </label>
          <Field label="省" name="province" maxLength={50} />
          <Field label="市" name="city" maxLength={50} />
          <Field label="区县" name="district" maxLength={50} />
          <Field label="街道 / 乡镇" name="street" maxLength={50} />
          <Field
            label="详细地址"
            name="addressDetail"
            required={false}
            maxLength={200}
          />
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
