import Link from "next/link";
import { DispatchRuleForm } from "@/components/DispatchRuleForm";
import { card } from "@/components/ui";
import { listCategories } from "@/src/lib/services";
import { prisma } from "@/src/lib/db";

export default async function NewRulePage() {
  const [categories, skus] = await Promise.all([
    listCategories(),
    prisma.serviceSku.findMany({
      where: { enabled: true },
      orderBy: { skuCode: "asc" },
      include: { category: { select: { name: true } } },
    }),
  ]);

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
        <div style={{ marginBottom: 12 }}>
          <Link
            href="/dispatch-rules"
            style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
          >
            ← 返回规则列表
          </Link>
        </div>
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>新增派单规则</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          SKU 精确优先 → 找不到再走类目兜底 → 都没有就「无规则」
        </p>

        <section style={{ ...card, maxWidth: 720 }}>
          <DispatchRuleForm
            mode="create"
            categories={categories.map((c) => ({
              categoryCode: c.categoryCode,
              name: c.name,
            }))}
            skus={skus.map((s) => ({
              skuCode: s.skuCode,
              name: s.name,
              categoryName: s.category.name,
            }))}
          />
        </section>
      </main>
    </>
  );
}