// [任务 18] 商家端后台查询层
//
// 设计原则（CLAUDE.md P0 越权防控）：
// - 每个 query 函数形参唯一接受 merchantId: string
// - merchantId 来源 = getCurrentUser().merchantId，绝不接受 form / URL 参数
// - 复用现有 listMerchantSettlementsByMerchant / listWithdrawRequestsByMerchant / getOrdersVisibleToMerchant 等
//   已有专门化函数，本模块只做"merchantId 注入 + 展示形 transform"
//
// 不做：
// - 商家端写操作（无 server action 暴露页面）
// - 商家端复杂权限（按 merchantId hard filter，不按 merchant 类型再细分）
// - 商家端嵌套 merchant-admin > orders > [id] / settlements > [id] 等详情页
//   — 演示期跳 admin 详情页，CLAUDE.md P3 不做

import { cache } from "react";
import { prisma } from "./db";
import { listMerchantSettlementsByMerchant } from "./merchant-settlement";
import { listWithdrawRequestsByMerchant } from "./withdraw-request";
import { getOrdersVisibleToMerchant } from "./queries";
import type { AuthenticatedUser } from "./auth";

// [任务 18] admin 排障 fallback：取 active 商家中 id 最小的（演示期 M001）
// 演示便利：CLAUDE.md P3-1 演示期 admin 可看商家后台看排障
// 上线后应撤掉，admin 进 /merchant-admin 直接 403
// # MVP: 动态取，不写死 M001
async function _findFallbackMerchantId(): Promise<string | null> {
  const m = await prisma.merchant.findFirst({
    where: { status: "active" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return m?.id ?? null;
}

/**
 * [任务 18] 商家端有效 merchantId
 *
 * 规则（CLAUDE.md P0-6 越权防控）：
 * - merchant 角色：用 user.merchantId（强绑）
 * - admin 角色：用 fallback（演示便利）
 * - 其他角色（worker/customer）：抛错（应被 layout 跳走，这里兜底）
 * - merchant 角色但 user.merchantId=null：抛错（orphan 账号）
 *
 * React.cache 包裹：同 request 内 5 子页调用只跑 1 次 DB query
 */
export const getEffectiveMerchantId = cache(
  async (user: AuthenticatedUser): Promise<string> => {
    if (user.role === "merchant") {
      if (!user.merchantId) {
        throw new Error("merchant 角色账号未绑定 merchantId");
      }
      return user.merchantId;
    }
    if (user.role === "admin") {
      const fallback = await _findFallbackMerchantId();
      if (!fallback) {
        throw new Error("系统无 active 商家，admin fallback 失败");
      }
      return fallback;
    }
    throw new Error(`角色 ${user.role} 不允许访问商家后台`);
  },
);

// ============================================================
// Orders：本商家师傅接的 + 本商家服务区域内可见的（任务 18 选项 B）
// ============================================================

export interface MerchantOrderItem {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  masterId: string | null;
  masterName: string | null;
  status: string;
  amountYuan: number;
  scheduledAt: string;
  createdAt: string;
  /** 本商家师傅接了 OR 落在本商家可见区域内 */
  source: "byMaster" | "byArea";
}

/**
 * A：本商家师傅（master.merchantId = merchantId）接了的订单
 * 性能：master 数量小，order 命中走 Master index + 二次过滤
 * 返回：[{ ..., source: "byMaster" }]
 */
export async function listOrdersByMaster(merchantId: string) {
  if (!merchantId) return [];
  // 1. 拿本商家所有 masterId
  const masters = await prisma.master.findMany({
    where: { merchantId },
    select: { id: true },
  });
  const masterIds = masters.map((m) => m.id);
  if (masterIds.length === 0) return [];

  // 2. 这些 master 接了的订单
  const orders = await prisma.order.findMany({
    where: { masterId: { in: masterIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      serviceName: true,
      masterId: true,
      masterName: true,
      status: true,
      amount: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
  return orders.map((o) => ({
    id: o.id,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    serviceName: o.serviceName,
    masterId: o.masterId,
    masterName: o.masterName,
    status: o.status,
    amountYuan: o.amount / 100,
    scheduledAt: o.scheduledAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    source: "byMaster" as const,
  }));
}

/**
 * B：本商家 enabled 服务区域内可见的订单（复用 getOrdersVisibleToMerchant）
 * 返回：标准化为 MerchantOrderItem[]
 */
export async function listOrdersByArea(merchantId: string): Promise<MerchantOrderItem[]> {
  if (!merchantId) return [];
  const { orders } = await getOrdersVisibleToMerchant(merchantId);
  return orders.map((o) => ({
    id: o.id,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    serviceName: o.serviceName,
    masterId: o.masterId,
    masterName: o.masterName,
    status: o.status,
    amountYuan: o.amountYuan,
    scheduledAt: o.scheduledAt,
    createdAt: o.createdAt,
    source: "byArea" as const,
  }));
}

/**
 * C：合并去重 — 同一订单同时落入两个集合时，只保留 byMaster 优先级
 * 因为 byMaster 是"已派单可入账"，可信度 > byArea（只是"可派单区域"）
 */
export async function listMerchantOrders(merchantId: string): Promise<{
  orders: MerchantOrderItem[];
  counts: { byMaster: number; byArea: number; overlap: number };
}> {
  const [byMaster, byArea] = await Promise.all([
    listOrdersByMaster(merchantId),
    listOrdersByArea(merchantId),
  ]);
  const masterIds = new Set(byMaster.map((o) => o.id));
  const uniqueByArea = byArea.filter((o) => !masterIds.has(o.id));
  const overlap = byArea.length - uniqueByArea.length;
  return {
    orders: [...byMaster, ...uniqueByArea].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    counts: {
      byMaster: byMaster.length,
      byArea: byArea.length,
      overlap,
    },
  };
}

// ============================================================
// Masters：本商家师傅列表
// ============================================================

export interface MerchantMasterItem {
  id: string;
  name: string;
  phone: string;
  status: string;
  skills: string;
  joinSource: string;
}

export async function listMerchantMasters(merchantId: string): Promise<MerchantMasterItem[]> {
  if (!merchantId) return [];
  const masters = await prisma.master.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      skills: true,
      joinSource: true,
    },
  });
  return masters.map((m) => ({
    id: m.id,
    name: m.name,
    phone: m.phone,
    status: m.status,
    skills: m.skills,
    joinSource: m.joinSource,
  }));
}

// ============================================================
// Settlements：本商家商家月结算汇总（复用 lib/merchant-settlement.ts）
// ============================================================

export async function listMerchantSettlements(merchantId: string) {
  if (!merchantId) return [];
  return listMerchantSettlementsByMerchant(merchantId);
}

// ============================================================
// WithdrawRequests：本商家提现记录（只读）
// ============================================================

export async function listMerchantWithdrawRequests(merchantId: string) {
  if (!merchantId) return [];
  return listWithdrawRequestsByMerchant(merchantId);
}

// ============================================================
// Dashboard 总览
// ============================================================

export interface MerchantDashboardSummary {
  merchantId: string;
  masterCount: number;
  orderCountByMaster: number;
  orderCountByArea: number;
  totalIncomeYuan: number; // 来自商户结算汇总
  pendingWithdrawCount: number;
}

export async function getMerchantDashboard(merchantId: string): Promise<MerchantDashboardSummary> {
  if (!merchantId) {
    return {
      merchantId: "",
      masterCount: 0,
      orderCountByMaster: 0,
      orderCountByArea: 0,
      totalIncomeYuan: 0,
      pendingWithdrawCount: 0,
    };
  }
  const [masterCount, byMaster, byArea, allSettlements, withdraws] = await Promise.all([
    prisma.master.count({ where: { merchantId } }),
    listOrdersByMaster(merchantId),
    listOrdersByArea(merchantId),
    listMerchantSettlementsByMerchant(merchantId),
    listWithdrawRequestsByMerchant(merchantId),
  ]);

  // [任务 18 P0-bug 修复] totalIncomeYuan 只计 confirmed/archived
  // 口径与 admin 端 getMerchantAvailable 一致（避免商家被 pending 金额误导）
  const confirmedSettlements = allSettlements.filter(
    (s: { status: string }) => s.status === "confirmed" || s.status === "archived",
  );
  const totalIncomeCents = confirmedSettlements.reduce(
    (sum: number, s: { merchantIncome?: number }) =>
      sum + (s.merchantIncome ?? 0),
    0,
  );
  const pendingWithdrawCount = (withdraws as Array<{ status: string }>).filter(
    (r) => r.status === "pending",
  ).length;

  return {
    merchantId,
    masterCount,
    orderCountByMaster: byMaster.length,
    orderCountByArea: byArea.length,
    totalIncomeYuan: totalIncomeCents / 100,
    pendingWithdrawCount,
  };
}
