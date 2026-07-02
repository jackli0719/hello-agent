import Link from "next/link";
import { notFound } from "next/navigation";
import { card } from "@/components/ui";
import { getCommissionStrategy } from "@/src/lib/commission";
import { listMerchants } from "@/src/lib/merchants";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { CommissionStrategyForm } from "../../CommissionStrategyForm";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function EditCommissionStrategyPage({
  params,
  searchParams,
}: PageProps) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const [csrfToken, strategy, merchants] = await Promise.all([
    ensureCsrfCookie(),
    getCommissionStrategy(id),
    listMerchants(),
  ]);
  if (!strategy) notFound();

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
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>
        编辑策略：{strategy.name}
      </h1>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        归属商家：{strategy.merchant.name}
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
          mode="edit"
          csrfToken={csrfToken}
          merchants={merchants.map((m) => ({ id: m.id, name: m.name }))}
          initial={{
            id: strategy.id,
            merchantId: strategy.merchantId,
            name: strategy.name,
            strategyType: strategy.strategyType as "percentage" | "fixed",
            platformRate: strategy.platformRate,
            merchantRate: strategy.merchantRate,
            workerRate: strategy.workerRate,
            fixedPlatformAmount: strategy.fixedPlatformAmount,
            fixedMerchantAmount: strategy.fixedMerchantAmount,
            fixedWorkerAmount: strategy.fixedWorkerAmount,
            enabled: strategy.enabled,
          }}
        />
      </section>
    </main>
  );
}
