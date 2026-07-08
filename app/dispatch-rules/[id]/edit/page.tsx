import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchRuleForm } from "@/components/DispatchRuleForm";
import { card } from "@/components/ui";
import { listCategories } from "@/src/lib/services";
import { getRuleForEdit } from "@/src/lib/dispatch-rules";
import { prisma } from "@/src/lib/db";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditRulePage({ params }: PageProps) {
  const { id } = await params;

  const [rule, categories, skus] = await Promise.all([
    getRuleForEdit(id),
    listCategories(),
    prisma.serviceSku.findMany({
      where: { enabled: true },
      orderBy: { skuCode: "asc" },
      include: { category: { select: { name: true } } },
    }),
  ]);
  if (!rule) notFound();

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
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>
          编辑派单规则：{rule.name}
        </h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          ID：{rule.id}
        </p>

        <section style={{ ...card, maxWidth: 720 }}>
          <DispatchRuleForm
            mode="edit"
            initial={{
              id: rule.id,
              name: rule.name,
              categoryCode: rule.categoryCode,
              skuCode: rule.skuCode,
              requiredSkillsStr: rule.requiredSkillsStr,
              priority: rule.priority,
              enabled: rule.enabled,
            }}
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
