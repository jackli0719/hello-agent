import Link from "next/link";
import { notFound } from "next/navigation";
import { NewMasterForm } from "@/components/NewMasterForm";
import { card } from "@/components/ui";
import { prisma } from "@/src/lib/db";
import { skillsToString } from "@/src/lib/masters";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMasterPage({ params }: PageProps) {
  const { id } = await params;

  const m = await prisma.master.findUnique({ where: { id } });
  if (!m) notFound();

  // skills 是 JSON 字符串 → 数组 → 表单用的逗号分隔
  let skillsStr = "";
  try {
    const arr = JSON.parse(m.skills);
    if (Array.isArray(arr))
      skillsStr = skillsToString(arr.filter((s) => typeof s === "string"));
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
          <Link
            href="/masters"
            style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
          >
            ← 返回师傅列表
          </Link>
        </div>
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>
          编辑师傅：{m.name}
        </h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          ID：{m.id}（{m.completedJobs} 单已完成）
        </p>

        <section style={{ ...card, maxWidth: 640 }}>
          <NewMasterForm
            mode="edit"
            initial={{
              id: m.id,
              name: m.name,
              phone: m.phone,
              skills: skillsStr,
              rating: m.rating,
              status: m.status as "available" | "busy" | "offline",
              serviceArea: m.serviceArea,
            }}
          />
        </section>
      </main>
    </>
  );
}
