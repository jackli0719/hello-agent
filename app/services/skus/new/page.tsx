import Link from "next/link";
import { NewSkuForm } from "@/components/ServiceForm";
import { card } from "@/components/ui";
import { listCategories } from "@/src/lib/services";

export default async function NewSkuPage() {
  const categories = await listCategories();

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
            href="/services"
            style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
          >
            ← 返回服务列表
          </Link>
        </div>
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>新增服务 SKU</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          创建后可在「新建订单」页面的服务下拉中选择
        </p>

        {categories.length === 0 ? (
          <section style={{ ...card, maxWidth: 640 }}>
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                color: "#b91c1c",
              }}
            >
              请先创建一个服务品类，才能新增 SKU
              <div style={{ marginTop: 12 }}>
                <Link
                  href="/services/categories/new"
                  style={{ color: "#2563eb", textDecoration: "none" }}
                >
                  → 去新增品类
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section style={{ ...card, maxWidth: 640 }}>
            <NewSkuForm
              categories={categories.map((c) => ({
                categoryCode: c.categoryCode,
                name: c.name,
                enabled: c.enabled,
              }))}
            />
          </section>
        )}
      </main>
    </>
  );
}
