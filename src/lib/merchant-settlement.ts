// [任务 7] 商家结算汇总（MerchantSettlement）业务逻辑
//
// 设计要点：
// - 从 SettlementPreview 聚合
// - 按 (merchantId, period "YYYY-MM") 分组
// - period 来源：SettlementPreview.createdAt（演示 demo 不会变更）
// - 同一 (merchantId, period) 唯一 — 重复生成用 upsert（覆盖更新）
// - 不做打款/提现
//
// 金额单位：分（与 SettlementPreview 一致）

import { prisma } from "@/src/lib/db";

export type MerchantSettlementPeriod = string; // "YYYY-MM"

export type MerchantSettlementGenerateResult = {
  upserted: number;
  created: number;
  updated: number;
  details: Array<{
    merchantId: string;
    period: string;
    action: "created" | "updated";
  }>;
};

/**
 * 格式化 Date 为 "YYYY-MM"
 */
export function formatPeriod(date: Date): MerchantSettlementPeriod {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * 生成所有商家的结算汇总
 * - 扫 SettlementPreview（基于它的 createdAt 取 period）
 * - 按 (merchantId, period) 聚合
 * - upsert 到 MerchantSettlement（unique(merchantId, period)）
 *
 * 返回：{ upserted, created, updated, details }
 */
export async function generateAllMerchantSettlements(): Promise<MerchantSettlementGenerateResult> {
  const previews = await prisma.settlementPreview.findMany({
    select: {
      merchantId: true,
      orderAmount: true,
      platformAmount: true,
      merchantAmount: true,
      workerAmount: true,
      createdAt: true,
    },
  });

  // 1. 按 (merchantId, period) 聚合
  type Key = string; // "merchantId|period"
  const groups = new Map<
    Key,
    {
      merchantId: string;
      period: string;
      totalOrderCount: number;
      totalAmount: number;
      platformFee: number;
      merchantIncome: number;
      workerIncome: number;
    }
  >();

  for (const p of previews) {
    const period = formatPeriod(p.createdAt);
    const k: Key = `${p.merchantId}|${period}`;
    const cur = groups.get(k) ?? {
      merchantId: p.merchantId,
      period,
      totalOrderCount: 0,
      totalAmount: 0,
      platformFee: 0,
      merchantIncome: 0,
      workerIncome: 0,
    };
    cur.totalOrderCount += 1;
    cur.totalAmount += p.orderAmount;
    cur.platformFee += p.platformAmount;
    cur.merchantIncome += p.merchantAmount;
    cur.workerIncome += p.workerAmount;
    groups.set(k, cur);
  }

  // 2. upsert 到 MerchantSettlement
  let created = 0;
  let updated = 0;
  const details: MerchantSettlementGenerateResult["details"] = [];

  for (const g of groups.values()) {
    // 先查现有 — 决定 created / updated
    const existing = await prisma.merchantSettlement.findUnique({
      where: {
        merchantId_period: {
          merchantId: g.merchantId,
          period: g.period,
        },
      },
    });

    await prisma.merchantSettlement.upsert({
      where: {
        merchantId_period: {
          merchantId: g.merchantId,
          period: g.period,
        },
      },
      update: {
        totalOrderCount: g.totalOrderCount,
        totalAmount: g.totalAmount,
        platformFee: g.platformFee,
        merchantIncome: g.merchantIncome,
        workerIncome: g.workerIncome,
      },
      create: {
        merchantId: g.merchantId,
        period: g.period,
        totalOrderCount: g.totalOrderCount,
        totalAmount: g.totalAmount,
        platformFee: g.platformFee,
        merchantIncome: g.merchantIncome,
        workerIncome: g.workerIncome,
      },
    });

    if (existing) {
      updated++;
      details.push({
        merchantId: g.merchantId,
        period: g.period,
        action: "updated",
      });
    } else {
      created++;
      details.push({
        merchantId: g.merchantId,
        period: g.period,
        action: "created",
      });
    }
  }

  return {
    upserted: created + updated,
    created,
    updated,
    details,
  };
}

export async function listMerchantSettlements() {
  return prisma.merchantSettlement.findMany({
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: [{ period: "desc" }, { merchantId: "asc" }],
  });
}

export async function getMerchantSettlement(
  merchantId: string,
  period: MerchantSettlementPeriod,
) {
  return prisma.merchantSettlement.findUnique({
    where: { merchantId_period: { merchantId, period } },
    include: { merchant: { select: { id: true, name: true } } },
  });
}

export async function listMerchantSettlementsByMerchant(merchantId: string) {
  return prisma.merchantSettlement.findMany({
    where: { merchantId },
    orderBy: [{ period: "desc" }],
  });
}

/**
 * [任务 8] 详情页 helper — 查 merchant + period 内的 SettlementPreview（订单明细）
 * @param id MerchantSettlement.id
 */
export async function getMerchantSettlementDetail(id: string) {
  const summary = await prisma.merchantSettlement.findUnique({
    where: { id },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          status: true,
          contactName: true,
          phone: true,
          province: true,
          city: true,
          district: true,
          street: true,
          addressDetail: true,
          inviteCode: true,
          inviteCodeEnabled: true,
        },
      },
    },
  });
  if (!summary) return null;

  // 查该 (merchant, period) 内的所有 SettlementPreview（订单明细）
  const periodStart = new Date(`${summary.period}-01T00:00:00`);
  // period 末 = 下个月 1 号
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const previews = await prisma.settlementPreview.findMany({
    where: {
      merchantId: summary.merchantId,
      createdAt: { gte: periodStart, lt: periodEnd },
    },
    include: {
      order: {
        select: {
          id: true,
          customerName: true,
          customerPhone: true,
          serviceName: true,
          serviceSkuId: true,
          amount: true,
          status: true,
          createdAt: true,
        },
      },
      master: { select: { id: true, name: true, phone: true } },
      strategy: { select: { id: true, name: true, strategyType: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return { summary, previews };
}
