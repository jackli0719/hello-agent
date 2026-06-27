import Link from "next/link";
import { NewMasterForm } from "@/components/NewMasterForm";
import { card } from "@/components/ui";

export default function NewMasterPage() {
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
          <Link href="/masters" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}>
            ← 返回师傅列表
          </Link>
        </div>
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>新增师傅</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          创建后可立即参与订单派单推荐
        </p>

        <section style={{ ...card, maxWidth: 640 }}>
          <NewMasterForm mode="create" />
        </section>
      </main>
    </>
  );
}