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

  const [orderRows, ruleRows, masterRows, totalCount] = await Promise.all([
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
        address: true,
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
            order: { skuId, categoryId },
            rules,
            masters,
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
      scheduledAt: toLocalISOString(r.scheduledAt),
      amountYuan: r.amount / 100,
      status: r.status as OrderStatus,
      createdAt: toLocalISOString(r.createdAt),
      recommendation,
      // [v0.7.6] 备注字段
      remark: r.remark,
      internalRemark: r.internalRemark,
      serviceSummary: r.serviceSummary,
    };
  });

  return { orders, totalCount };
}
