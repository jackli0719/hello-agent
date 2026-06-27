import Link from "next/link";
import { NewCategoryForm } from "@/components/ServiceForm";
import { card } from "@/components/ui";

export default function NewCategoryPage() {
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
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>新增服务品类</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          创建后可在此品类下新增 SKU
        </p>
        <section style={{ ...card, maxWidth: 640 }}>
          <NewCategoryForm />
        </section>
      </main>
    </>
  );
}