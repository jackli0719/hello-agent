import Link from "next/link";
import { card } from "@/components/ui";
import { listMerchants } from "@/src/lib/merchants";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { CommissionStrategyForm } from "../CommissionStrategyForm";

interface PageProps {
  searchParams: Promise<{ error?: string; merchantId?: string }>;
}

export default async function NewCommissionStrategyPage({
  searchParams,
}: PageProps) {
  const { error, merchantId: preselectMerchantId } = await searchParams;
  const [csrfToken, merchants] = await Promise.all([
    ensureCsrfCookie(),
    listMerchants(),
  ]);

  if (merchants.length === 0) {
    return (
      <main style={{ padding: "24px 48px 48px", background: "#f7f8fa" }}>
        <div style={{ color: "#b91c1c" }}>请先创建商家，再配置分成策略</div>
      </main>
    );
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
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/commission-strategies"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          ← 返回策略列表
        </Link>
      </div>
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>新增分成策略</h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        仅做配置，不做真实结算
      </p>

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

      <section style={{ ...card, maxWidth: 720 }}>
        <CommissionStrategyForm
          mode="create"
          csrfToken={csrfToken}
          merchants={merchants.map((m) => ({ id: m.id, name: m.name }))}
          preselectMerchantId={preselectMerchantId}
        />
      </section>
    </main>
  );
}
