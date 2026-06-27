// 用户端 — /customer 页面用的查询层。
//
// 范围：
// 1. 列「上架」的服务品类 + SKU（带 categoryCode 用于前端联动）
// 2. 按 skuCode 查 basePrice（用户端没填金额，自动用 SKU basePrice）
//
// 设计：
// - 不复用 services repo：用户端需要 categoryCode 做前端联动，repo 的 ServiceOption 没这个字段
// - 直接打 Prisma（页面级组装，不复杂不需要 queries 层）

import { prisma } from "@/src/lib/db";

export interface CustomerCategoryOption {
  id: string;
  categoryCode: string;
  name: string;
}

export interface CustomerSkuOption {
  id: string;
  skuCode: string;
  name: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  basePriceYuan: number;
  durationMinutes: number;
}

/**
 * 列上架品类 + 上架 SKU（用于 /customer 表单联动）。
 *
 * 品类 + SKU 一次拉出来，按品类名 + SKU 名排序。
 * 页面拿到后渲染「类目下拉」+「SKU 下拉」，JS 联动：选品类后 SKU 下拉只显示该品类。
 */
export async function listCustomerCategoriesAndSkus(): Promise<{
  categories: CustomerCategoryOption[];
  skus: CustomerSkuOption[];
}> {
  const [catRows, skuRows] = await Promise.all([
    prisma.serviceCategory.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
      select: { id: true, categoryCode: true, name: true },
    }),
    prisma.serviceSku.findMany({
      where: { enabled: true },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        skuCode: true,
        name: true,
        basePrice: true,
        durationMinutes: true,
        categoryId: true,
        category: { select: { categoryCode: true, name: true } },
      },
    }),
  ]);
  return {
    categories: catRows.map((c) => ({
      id: c.id,
      categoryCode: c.categoryCode,
      name: c.name,
    })),
    skus: skuRows.map((s) => ({
      id: s.id,
      skuCode: s.skuCode,
      name: s.name,
      categoryId: s.categoryId,
      categoryCode: s.category.categoryCode,
      categoryName: s.category.name,
      basePriceYuan: s.basePrice / 100,
      durationMinutes: s.durationMinutes,
    })),
  };
}

/**
 * 按 skuCode 查 basePrice（用户端自动用 SKU 默认价时用）。
 * 找不到返 null。
 */
export async function getSkuBasePriceByCode(skuCode: string): Promise<number | null> {
  if (!skuCode) return null;
  const row = await prisma.serviceSku.findUnique({
    where: { skuCode },
    select: { basePrice: true, enabled: true },
  });
  if (!row || !row.enabled) return null;
  return row.basePrice / 100;
}

// ---------- 用户端查询订单 ----------

/** 用户端查询结果 — 简化版（不展示师傅手机等隐私字段） */
export interface CustomerOrderLookupItem {
  id: string;
  serviceName: string;
  serviceCategoryName: string | null;
  status: import("@/src/types").OrderStatus;
  scheduledAt: string;
  amountYuan: number;
  technicianName: string | null;
  remark: string | null;
  createdAt: string;
}

/**
 * 按手机号查该用户的所有订单（按 createdAt 降序 — 最近的优先）。
 *
 * 隐私/安全：
 * - 演示期不做手机号验证（任何人都能查任意手机号）
 * - 真实业务必须加验证码 / 限流 / 用户登录
 * - # MVP: 演示用，标注为「不要上线」
 *
 * 返回空数组 = 该手机号没下过单（不是错误）
 */
export async function listOrdersForCustomerPhone(
  phone: string,
): Promise<CustomerOrderLookupItem[]> {
  if (!phone) return [];
  const rows = await prisma.order.findMany({
    where: { customerPhone: phone },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      serviceName: true,
      status: true,
      scheduledAt: true,
      amount: true,
      masterName: true,
      remark: true,
      createdAt: true,
      serviceSku: { select: { category: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    serviceName: r.serviceName,
    serviceCategoryName: r.serviceSku?.category.name ?? null,
    status: r.status as import("@/src/types").OrderStatus,
    scheduledAt: r.scheduledAt.toISOString(),
    amountYuan: r.amount / 100,
    technicianName: r.masterName,
    remark: r.remark,
    createdAt: r.createdAt.toISOString(),
  }));
}