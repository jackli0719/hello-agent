import { NewOrderForm } from "@/components/NewOrderForm";
import { prisma } from "@/src/lib/db";
import { card } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ created?: string }>;
}

export default async function NewOrderPage({ searchParams }: PageProps) {
  const { created } = await searchParams;

  const [categories, skus] = await Promise.all([
    prisma.serviceCategory.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, categoryCode: true },
    }),
    prisma.serviceSku.findMany({
      where: { enabled: true },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      select: {
        id: true,
        skuCode: true,
        name: true,
        basePrice: true,
        categoryId: true,
        durationMinutes: true,
      },
    }),
  ]);

  if (categories.length === 0 || skus.length === 0) {
    notFound();
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
          <Link href="/orders" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}>
            ← 返回订单列表
          </Link>
        </div>
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>新建订单</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          创建后默认状态为「待派单」，会自动出现在订单列表并参与派单推荐
        </p>

        {created ? (
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
            ✓ 订单 <strong>{created}</strong> 创建成功
          </div>
        ) : null}

        <section style={{ ...card, maxWidth: 720 }}>
          <NewOrderForm
            categories={categories}
            skus={skus.map((s) => ({
              ...s,
              basePriceYuan: s.basePrice / 100,
            }))}
          />
        </section>
      </main>
    </>
  );
}