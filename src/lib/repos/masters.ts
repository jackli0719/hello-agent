// 师傅 repo — 唯一允许 import @prisma/client 读 Master 表的地方。
// 跟 orders.ts / services.ts 同构：DB 行 ↔ 领域对象转换在这里完成。

import type { Technician, TechnicianStatus } from "@/src/types";
import { prisma } from "@/src/lib/db";

// DB 行 → 领域对象
interface DbMasterRow {
  id: string;
  name: string;
  phone: string;
  skills: string; // JSON 字符串
  rating: number;
  completedJobs: number;
  status: string;
  serviceArea: string;
  merchantId: string;
  merchant: { name: string } | null;
}

function toTechnician(row: DbMasterRow): Technician {
  let skills: string[] = [];
  try {
    const parsed = JSON.parse(row.skills);
    if (Array.isArray(parsed))
      skills = parsed.filter((s) => typeof s === "string");
  } catch {
    // 坏数据：skills 留空，不抛
  }
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    skills,
    rating: row.rating,
    completedJobs: row.completedJobs,
    status: row.status as TechnicianStatus,
    serviceArea: row.serviceArea,
    merchantId: row.merchantId,
    merchantName: row.merchant?.name,
  };
}

const masterSelect = {
  id: true,
  name: true,
  phone: true,
  skills: true,
  rating: true,
  completedJobs: true,
  status: true,
  serviceArea: true,
  merchantId: true,
  merchant: { select: { name: true } },
} satisfies import("@prisma/client").Prisma.MasterSelect;

/** 列所有师傅 — 派单匹配函数用 */
export async function listMasters(): Promise<Technician[]> {
  const rows = await prisma.master.findMany({ select: masterSelect });
  return rows.map(toTechnician);
}

/** 按 ID 取单个师傅 */
export async function getMasterById(id: string): Promise<Technician | null> {
  const row = await prisma.master.findUnique({
    where: { id },
    select: masterSelect,
  });
  return row ? toTechnician(row) : null;
}
