// /orders 页面用的查询层 — 一次拉全订单 + SKU + 类目 + 师傅 + 派单规则，
// 然后在页面层用 lib/dispatch.ts 的纯函数算推荐。
//
// 不放在 repos/ 里是因为 repos/ 是「单表的原子操作」（orders.repo 只管 Order 表），
// queries/ 是「页面级组装」，可以跨表。这是单一职责的拆分。

import { prisma } from "@/src/lib/db";
import {
  recommendMastersForOrder,
  parseRuleJson,
  type DispatchRuleRow,
  type RecommendationResult,
} from "@/lib/dispatch";
import type { Order, OrderStatus, Technician } from "@/src/types";

// ---------- 类型 ----------
export interface OrderListItem {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  serviceSkuId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  technicianName: string | null;
  address: string;
  // [任务 3] 4 级地址 + 详细
  province: string;
  city: string;
  district: string;
  street: string;
  addressDetail: string;
  scheduledAt: string; // ISO 本地时区
  amountYuan: number;
  status: OrderStatus;
  createdAt: string; // ISO 本地时区
  recommendation: RecommendationResult;
  // [v0.7.6] 备注字段
  /** 用户下单备注 */
  remark: string | null;
  /** 后台内部备注（admin 写，user/worker 看） */
  internalRemark: string | null;
  /** 师傅完成说明 */
  serviceSummary: string | null;
  // [v0.7.9] 取消相关字段
  /** 取消原因 */
  cancelReason: string | null;
  /** 取消时间 */
  canceledAt: string | null;
}

export interface OrdersPageData {
  orders: OrderListItem[];
  totalCount: number;
}

// ---------- 工具 ----------
function toLocalISOString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzOffset = -d.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffset);
  const tz = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`
  );
}

// DB Order → 领域对象（页面用）
function toDomainOrder(row: {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceSkuId: string | null;
  serviceName: string;
  masterName: string | null;
  address: string;
  scheduledAt: Date;
  amount: number;
  status: string;
  createdAt: Date;
}): Order {
  return {
    id: row.id,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    serviceName: row.serviceName,
    technicianName: row.masterName,
    address: row.address,
    scheduledAt: toLocalISOString(row.scheduledAt),
    amount: row.amount / 100,
    status: row.status as OrderStatus,
  };
}

// DB Master → 领域对象
function toDomainMaster(row: {
  id: string;
  name: string;
  phone: string;
  skills: string;
  rating: number;
  completedJobs: number;
  status: string;
  serviceArea: string;
  merchantId: string;
  merchant?: { id: string; name: string; status: string } | null;
}): Technician {
  let skills: string[] = [];
  try {
    const parsed = JSON.parse(row.skills);
    if (Array.isArray(parsed))
      skills = parsed.filter((s) => typeof s === "string");
  } catch {
    // 坏数据留空，不抛
  }
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    skills,
    rating: row.rating,
    completedJobs: row.completedJobs,
    status: row.status as Technician["status"],
    serviceArea: row.serviceArea,
    merchantId: row.merchantId,
    // [任务 3] 给 Technician 加 merchantName（dispatch.ts 透传）
    merchantName: row.merchant?.name ?? undefined,
  };
}

// DB DispatchRule → DispatchRuleRow
// 返回 null 表示 ruleJson 坏了（parseRuleJson 失败）— 这种情况**不**给上游，
// 而是直接 filter 掉，让坏规则彻底不参与匹配。
function toRuleRow(row: {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  ruleJson: string;
}): DispatchRuleRow | null {
  const spec = parseRuleJson(row.ruleJson);
  if (spec === null) return null; // 坏数据
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    enabled: row.enabled,
    spec,
  };
}

// ---------- 查询入口 ----------

export interface OrderPageFilters {
  /** 精确按 ServiceSku.skuCode 过滤（业务编码） */
  skuCode?: string;
  /** 时间范围起始（含当天，>= 00:00） */
  dateFrom?: Date;
  /** 时间范围结束（不含当天，< 次日 00:00） */
  dateTo?: Date;
  /** 时间字段：按 createdAt 或 scheduledAt */
  dateField?: "createdAt" | "scheduledAt";
  /** 分页页码（1-based） */
  page?: number;
  /** 分页大小 */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 10; // 任务要求：每页默认 10 条

/**
 * 拉一页订单 + 全量派单规则 + 全量师傅，做服务端组装。
 * 一次 query 把 5 张表的数据全拿出来，避免 N+1。
 *
 * skuCode / 时间范围在 DB 端过滤（更高效）；status/keyword 在 page.tsx 客户端过滤
 * —— status/keyword 已有的代码不动，避免改面太多。
 */
export async function listOrdersForPage(
  filters: OrderPageFilters = {},
): Promise<OrdersPageData> {
  // SKU 过滤 — 业务编码转内部 ID
  // 不存在时直接返 0（不查 order）
  let serviceSkuIdFilter: string | undefined;
  if (filters.skuCode) {
    const sku = await prisma.serviceSku.findUnique({
      where: { skuCode: filters.skuCode },
      select: { id: true },
    });
    if (!sku) {
      return { orders: [], totalCount: 0 };
    }
    serviceSkuIdFilter = sku.id;
  }

  // 时间范围 where 子句
  const dateWhere: { gte?: Date; lt?: Date } = {};
  if (filters.dateFrom) dateWhere.gte = filters.dateFrom;
  if (filters.dateTo) {
    // dateTo 设为「次日 00:00」（不含当天） — 让用户传 2026-06-25 包含 2026-06-25 全天
    const nextDay = new Date(filters.dateTo);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    dateWhere.lt = nextDay;
  }
  const dateField = filters.dateField ?? "createdAt";

  // 分页
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * pageSize;

  // SKU + 时间范围合并到 where
  const where: Record<string, unknown> = {};
  if (serviceSkuIdFilter) where.serviceSkuId = serviceSkuIdFilter;
  if (dateWhere.gte || dateWhere.lt) {
    where[dateField] = dateWhere;
  }

  const [
    orderRows,
    ruleRows,
    masterRows,
    platformAreaRows,
    merchantAreaRows,
    totalCount,
  ] = await Promise.all([
    prisma.order.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        serviceSkuId: true,
        serviceName: true,
        masterName: true,
        remark: true, // [v0.7.6]
        internalRemark: true, // [v0.7.6]
        serviceSummary: true, // [v0.7.6]
        cancelReason: true, // [v0.7.9]
        canceledAt: true, // [v0.7.9]
        address: true,
        // [任务 3] 4 级地址 — 推荐走精确匹配
        province: true,
        city: true,
        district: true,
        street: true,
        addressDetail: true,
        scheduledAt: true,
        amount: true,
        status: true,
        createdAt: true,
        serviceSku: {
          select: {
            id: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.dispatchRule.findMany({
      select: {
        id: true,
        name: true,
        priority: true,
        enabled: true,
        ruleJson: true,
      },
    }),
    prisma.master.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        skills: true,
        rating: true,
        completedJobs: true,
        status: true,
        serviceArea: true,
        merchantId: true,
        // [任务 3] 推荐结果展示师傅所属商家
        merchant: {
          select: { id: true, name: true, status: true },
        },
      },
    }),
    prisma.platformArea.findMany({
      where: { enabled: true },
      select: {
        id: true,
        province: true,
        city: true,
        district: true,
        street: true,
        enabled: true,
      },
    }),
    prisma.merchantArea.findMany({
      where: { enabled: true, merchant: { status: "active" } },
      select: {
        merchantId: true,
        platformAreaId: true,
        enabled: true,
      },
    }),
    prisma.order.count({
      where: Object.keys(where).length > 0 ? where : undefined,
    }),
  ]);

  // 坏数据：parseRuleJson 返回 null 的规则完全过滤掉
  // 之前是 fallback 到空 spec → 坏规则仍参与匹配（按 match.skuId/categoryId 都是空，永远不命中）
  // 过滤掉是更安全的做法
  const rules = ruleRows
    .map(toRuleRow)
    .filter((r): r is DispatchRuleRow => r !== null);
  const masters = masterRows.map(toDomainMaster);

  const orders: OrderListItem[] = orderRows.map((r) => {
    const skuId = r.serviceSku?.id ?? null;
    const categoryId = r.serviceSku?.category.id ?? null;
    const categoryName = r.serviceSku?.category.name ?? null;

    // 推荐只对 pending 订单算；其它状态直接空推荐
    const recommendation =
      r.status === "pending"
        ? recommendMastersForOrder({
            order: {
              skuId,
              categoryId,
              // [任务 3] 4 级字段精确匹配；旧订单空时 dispatch.ts fallback 模糊
              province: r.province,
              city: r.city,
              district: r.district,
              street: r.street,
              address: r.address,
              addressDetail: r.addressDetail,
            },
            rules,
            masters,
            platformAreas: platformAreaRows,
            merchantAreas: merchantAreaRows,
          })
        : { rule: null, candidates: [], reason: "—（非待派单状态）" };

    return {
      id: r.id,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      serviceName: r.serviceName,
      serviceSkuId: skuId,
      categoryId,
      categoryName,
      technicianName: r.masterName,
      address: r.address,
      // [任务 3] 4 级地址
      province: r.province,
      city: r.city,
      district: r.district,
      street: r.street,
      addressDetail: r.addressDetail,
      scheduledAt: toLocalISOString(r.scheduledAt),
      amountYuan: r.amount / 100,
      status: r.status as OrderStatus,
      createdAt: toLocalISOString(r.createdAt),
      recommendation,
      // [v0.7.6] 备注字段
      remark: r.remark,
      internalRemark: r.internalRemark,
      serviceSummary: r.serviceSummary,
      // [v0.7.9]
      cancelReason: r.cancelReason,
      canceledAt: r.canceledAt ? toLocalISOString(r.canceledAt) : null,
    };
  });

  return { orders, totalCount };
}

// ============================================================
// 商家可见订单查询 — TODO 后续商家端任务
// ============================================================
// 任务 3 边界 = 只做派单区域过滤（dispatch.ts + 下单页 + 4 级地址）
// 这个函数超出当前任务边界 — 是商家端前置接口，本阶段没有 /merchant/* 页面
// 暂留是因为 verify-dispatch.ts 的 "附加场景" 用它断言 4 级地址 → 商家覆盖
// 后续任务（商家端 / 邀请码 / 商家后台）会真正用上
// 保留位置：src/lib/queries.ts:getOrdersVisibleToMerchant
// ============================================================

/**
 * 返回某商家可见的所有订单（基于商家绑定的合作区域）
 *
 * ⚠️ TODO 后续任务（商家端）：本阶段没有 /merchant/* 页面调用此函数。
 * 任务 3 边界 = 只做派单区域过滤。函数已实现但**没有 UI 入口**。
 * 验证入口：scripts/verify-dispatch.ts 的"附加场景"用此函数断言
 * "订单 4 级地址 → 商家覆盖区域"映射。
 *
 * 逻辑：
 * 1. 查 merchant 的 enabled MerchantArea → 拿到 platformAreaIds
 * 2. 关联 enabled PlatformArea
 * 3. 查 Order.province/city/district/street 命中这些 PlatformArea 的所有订单
 *
 * 注意：
 * - 商家 status=active 已被 prisma 隐式约束（MerchantArea 关联的 merchant 必须 active 才能查）
 *   但这里再做一次 merchant.status 防御性检查
 * - 用 4 级字段精确匹配（与 recommendMastersForOrder 一致）
 * - 不返回 cancelled 订单（业务上商家不需要看自己取消的）
 *   — 不，**返回所有状态**让调用方自己过滤（更灵活）
 */
export async function getOrdersVisibleToMerchant(merchantId: string) {
  if (!merchantId) {
    return { orders: [], totalCount: 0 };
  }

  // 1. 商家存在 + active 校验
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, status: true },
  });
  if (!merchant || merchant.status !== "active") {
    return { orders: [], totalCount: 0 };
  }

  // 2. 商家 enabled MerchantArea
  const merchantAreas = await prisma.merchantArea.findMany({
    where: { merchantId, enabled: true },
    select: { platformAreaId: true },
  });
  if (merchantAreas.length === 0) {
    return { orders: [], totalCount: 0 };
  }

  // 3. enabled PlatformArea（防御性：检查 platformArea.enabled）
  const platformAreas = await prisma.platformArea.findMany({
    where: {
      id: { in: merchantAreas.map((ma) => ma.platformAreaId) },
      enabled: true,
    },
    select: {
      id: true,
      province: true,
      city: true,
      district: true,
      street: true,
    },
  });
  if (platformAreas.length === 0) {
    return { orders: [], totalCount: 0 };
  }

  // 4. 查订单 — 4 级地址命中任一 platformArea
  // Prisma 用 OR 组合每条 platformArea 的 4 字段精确匹配
  // 注意：旧订单（4 级字段为空）会落不到任何 platformArea — 业务上需要商家主动迁移
  const orders = await prisma.order.findMany({
    where: {
      OR: platformAreas.map((pa) => ({
        province: pa.province,
        city: pa.city,
        district: pa.district,
        street: pa.street,
      })),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      serviceName: true,
      serviceSkuId: true,
      masterId: true,
      masterName: true,
      address: true,
      province: true,
      city: true,
      district: true,
      street: true,
      addressDetail: true,
      scheduledAt: true,
      amount: true,
      status: true,
      createdAt: true,
      remark: true,
    },
  });

  return {
    orders: orders.map((o) => ({
      id: o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      serviceName: o.serviceName,
      serviceSkuId: o.serviceSkuId,
      masterId: o.masterId,
      masterName: o.masterName,
      address: o.address,
      province: o.province,
      city: o.city,
      district: o.district,
      street: o.street,
      addressDetail: o.addressDetail,
      scheduledAt: toLocalISOString(o.scheduledAt),
      amountYuan: o.amount / 100,
      status: o.status as OrderStatus,
      createdAt: toLocalISOString(o.createdAt),
      remark: o.remark,
    })),
    totalCount: orders.length,
  };
}
