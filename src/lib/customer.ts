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
export async function getSkuBasePriceByCode(
  skuCode: string,
): Promise<number | null> {
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
  /** 客户姓名（冗余快照） */
  customerName: string;
  /** 客户手机号（冗余快照） */
  customerPhone: string;
  /** 服务地址 */
  address: string;
  serviceName: string;
  serviceCategoryName: string | null;
  status: import("@/src/types").OrderStatus;
  // [任务 X] 支付状态
  payStatus: import("@/src/types").PayStatus;
  paidAt: string | null;
  scheduledAt: string;
  amountYuan: number;
  /** 已派单师傅 ID（null = 未派单） */
  masterId: string | null;
  /** 已派单师傅姓名（null = 未派单） */
  technicianName: string | null;
  /** 已派单师傅手机号（null = 未派单）— [v0.7.5] 详情页展示 */
  technicianPhone: string | null;
  remark: string | null;
  /** [v0.7.6] 后台内部备注（用户端不展示）*/
  internalRemark?: string | null;
  /** [v0.7.6] 师傅完成说明（用户端 + 后台展示）*/
  serviceSummary?: string | null;
  // [v0.7.9] 取消原因 + 取消时间
  cancelReason: string | null;
  canceledAt: string | null;
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
      customerName: true,
      customerPhone: true,
      address: true,
      serviceName: true,
      status: true,
      payStatus: true, // [任务 X] 支付状态
      paidAt: true, // [任务 X]
      scheduledAt: true,
      amount: true,
      masterId: true,
      masterName: true,
      remark: true,
      createdAt: true,
      serviceSummary: true, // [v0.7.6] 师傅完成说明
      cancelReason: true, // [v0.7.9]
      canceledAt: true, // [v0.7.9]
      // [v0.7.5] 列表也 join master 表（拿手机号）
      master: { select: { phone: true } },
      serviceSku: { select: { category: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    address: r.address,
    serviceName: r.serviceName,
    serviceCategoryName: r.serviceSku?.category.name ?? null,
    status: r.status as import("@/src/types").OrderStatus,
    payStatus: r.payStatus as import("@/src/types").PayStatus, // [任务 X]
    paidAt: r.paidAt ? r.paidAt.toISOString() : null, // [任务 X]
    scheduledAt: r.scheduledAt.toISOString(),
    amountYuan: r.amount / 100,
    masterId: r.masterId,
    technicianName: r.masterName,
    technicianPhone: r.master?.phone ?? null,
    remark: r.remark,
    // [v0.7.6] 列表不需要 internalRemark（用户端不展示），但 serviceSummary 要
    serviceSummary: r.serviceSummary,
    // [v0.7.9] 取消字段（用户端可见 — 业务规则）
    cancelReason: r.cancelReason,
    canceledAt: r.canceledAt ? r.canceledAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * [v0.7.5] 按订单号 + 手机号查单个订单详情（带越权防护）。
 *
 * 越权防护：
 * - 必须传 customerPhone
 * - 订单 customerPhone 必须等于传入的 phone → 否则返 null（防 URL 猜订单号）
 * - 不告诉调用方「订单存在 / 不存在」（防止 ID 枚举）
 *
 * 返回 null = 订单不存在 / 不属于该 phone（两种情况统一处理）
 */
export async function getOrderForCustomer(
  orderId: string,
  phone: string,
): Promise<CustomerOrderLookupItem | null> {
  if (!orderId || !phone) return null;
  const row = await prisma.order.findFirst({
    where: {
      id: orderId,
      customerPhone: phone, // 越权防护
    },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      address: true,
      serviceName: true,
      status: true,
      payStatus: true, // [任务 X] 支付状态
      paidAt: true, // [任务 X]
      scheduledAt: true,
      amount: true,
      masterId: true,
      masterName: true,
      remark: true,
      createdAt: true,
      serviceSummary: true, // [v0.7.6] 师傅完成说明
      cancelReason: true, // [v0.7.9]
      canceledAt: true, // [v0.7.9]
      master: { select: { phone: true } },
      serviceSku: { select: { category: { select: { name: true } } } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    address: row.address,
    serviceName: row.serviceName,
    serviceCategoryName: row.serviceSku?.category.name ?? null,
    status: row.status as import("@/src/types").OrderStatus,
    payStatus: row.payStatus as import("@/src/types").PayStatus, // [任务 X]
    paidAt: row.paidAt ? row.paidAt.toISOString() : null, // [任务 X]
    scheduledAt: row.scheduledAt.toISOString(),
    amountYuan: row.amount / 100,
    masterId: row.masterId,
    technicianName: row.masterName,
    technicianPhone: row.master?.phone ?? null,
    remark: row.remark,
    serviceSummary: row.serviceSummary,
    // [v0.7.9] 取消字段（用户端可见 — 业务规则）
    cancelReason: row.cancelReason,
    canceledAt: row.canceledAt ? row.canceledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
