import Link from "next/link";
import { notFound } from "next/navigation";
import { EditSkuForm } from "@/components/ServiceForm";
import { card } from "@/components/ui";
import { prisma } from "@/src/lib/db";
import { skillsToString } from "@/src/lib/masters";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSkuPage({ params }: PageProps) {
  const { id } = await params;

  const sku = await prisma.serviceSku.findUnique({
    where: { id },
    include: { category: { select: { name: true, categoryCode: true } } },
  });
  if (!sku) notFound();

  // requiredSkills 是 JSON 字符串 → 数组 → 逗号分隔字符串（表单回显用）
  let requiredSkillsStr = "";
  try {
    const arr = JSON.parse(sku.requiredSkills);
    if (Array.isArray(arr)) {
      requiredSkillsStr = skillsToString(arr.filter((s) => typeof s === "string"));
    }
  } catch {
    // 坏数据留空
  }

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
          <Link href="/services" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}>
            ← 返回服务列表
          </Link>
        </div>
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>编辑 SKU：{sku.name}</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          编码：{sku.skuCode}（编码不可修改）
        </p>

        <section style={{ ...card, maxWidth: 720 }}>
          <EditSkuForm
            initial={{
              id: sku.id,
              name: sku.name,
              basePriceYuan: sku.basePrice / 100,
              enabled: sku.enabled,
              requiredSkillsStr,
              skuCode: sku.skuCode,
              categoryName: sku.category.name,
              categoryCode: sku.category.categoryCode,
              durationMinutes: sku.durationMinutes,
            }}
          />
        </section>
      </main>
    </>
  );
}