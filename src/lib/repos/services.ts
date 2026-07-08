// 服务项目 repo — 新建订单时的下拉数据来源。
// 跟 orders.ts 一样，页面/action 只调这里，不直接碰 Prisma。

import { prisma } from "@/src/lib/db";

// 服务项目（用于下单页面下拉选择 / 派单规则查询）
export interface ServiceOption {
  id: string;
  skuCode: string;
  name: string;
  categoryName: string;
  basePriceYuan: number; // 元（页面录入用）
  durationMinutes: number;
  requiredSkills: string[]; // 派单所需技能；空数组 = 不参与自动派单
}

function parseSkills(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      return parsed.filter((s) => typeof s === "string");
  } catch {
    // 坏数据留空
  }
  return [];
}

/** 列所有「已上架」的服务项目，按类目 + 名称排序 */
export async function listEnabledServices(): Promise<ServiceOption[]> {
  const rows = await prisma.serviceSku.findMany({
    where: { enabled: true },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      skuCode: true,
      name: true,
      basePrice: true,
      durationMinutes: true,
      requiredSkills: true,
      category: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    skuCode: r.skuCode,
    name: r.name,
    categoryName: r.category.name,
    basePriceYuan: r.basePrice / 100,
    durationMinutes: r.durationMinutes,
    requiredSkills: parseSkills(r.requiredSkills),
  }));
}

/** 取单个服务项目（按 ID）— 给 action 校验/默认值用 */
export async function getServiceById(
  id: string,
): Promise<ServiceOption | null> {
  const row = await prisma.serviceSku.findUnique({
    where: { id },
    select: {
      id: true,
      skuCode: true,
      name: true,
      basePrice: true,
      durationMinutes: true,
      requiredSkills: true,
      category: { select: { name: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    skuCode: row.skuCode,
    name: row.name,
    categoryName: row.category.name,
    basePriceYuan: row.basePrice / 100,
    durationMinutes: row.durationMinutes,
    requiredSkills: parseSkills(row.requiredSkills),
  };
}
