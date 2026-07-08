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
import { recordOrderCommissionInTx } from "@/src/lib/finance-ledger";

export type MerchantSettlementPeriod = string; // "YYYY-MM"

export type MerchantSettlementGenerateResult = {
  upserted: number;
  created: number;
  updated: number;
  // [F0-2] 已 confirmed/archived 的 settlement 跳过覆盖（保持只读）
  skipped: number;
  details: Array<{
    merchantId: string;
    period: string;
    action: "created" | "updated" | "skipped";
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
  let skipped = 0;
  const details: MerchantSettlementGenerateResult["details"] = [];

  for (const g of groups.values()) {
    // 先查现有 — 决定 created / updated / skipped
    const existing = await prisma.merchantSettlement.findUnique({
      where: {
        merchantId_period: {
          merchantId: g.merchantId,
          period: g.period,
        },
      },
      select: { id: true, status: true },
    });

    // [F0-2 PR 审计] 状态机保护：confirmed/archived 状态不再覆盖
    // 业务原因：archived 只读；confirmed 通常已被审核；重新覆盖金额会破坏"已确认"语义
    if (existing && existing.status !== "pending") {
      skipped++;
      details.push({
        merchantId: g.merchantId,
        period: g.period,
        action: "skipped",
      });
      continue;
    }

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
    skipped,
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

// [任务 10] 按 period 过滤（月份筛选）
export async function listMerchantSettlementsByPeriod(period: string) {
  return prisma.merchantSettlement.findMany({
    where: { period },
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: [{ merchantId: "asc" }],
  });
}

// [任务 9] 状态机 — 三状态：pending / confirmed / archived
export type MerchantSettlementStatus = "pending" | "confirmed" | "archived";

export type ConfirmResult =
  { ok: true; status: MerchantSettlementStatus } | { ok: false; error: string };

/**
 * 确认结算（pending → confirmed，单向不可逆）
 *
 * [P0-2 必修 2026-07-03] updateMany({status:'pending'}) 原子状态机
 * [P0-3 必修 2026-07-03] settlement 状态变更 + recordOrderCommissionInTx 同事务；
 *   ledger 写失败 → 整个 confirm 回滚
 */
export async function confirmMerchantSettlement(
  id: string,
): Promise<ConfirmResult> {
  try {
    const r = await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.merchantSettlement.updateMany({
          where: { id, status: "pending" },
          data: { status: "confirmed" },
        });
        if (count === 0) {
          const s = await tx.merchantSettlement.findUnique({
            where: { id },
            select: { id: true, status: true },
          });
          if (!s) return { ok: false as const, error: "结算记录不存在" };
          if (s.status === "confirmed") {
            return { ok: true as const, status: "confirmed" as const }; // 幂等
          }
          if (s.status === "archived") {
            return { ok: false as const, error: "已归档的周期不可再确认" };
          }
          return {
            ok: false as const,
            error: `仅 pending 状态可确认（当前：${s.status}）`,
          };
        }

        // [P0-3] 同事务写 ledger
        const settlement = await tx.merchantSettlement.findUnique({
          where: { id },
          select: { id: true, merchantId: true, merchantIncome: true },
        });
        if (settlement && settlement.merchantIncome > 0) {
          await recordOrderCommissionInTx(tx, {
            settlementId: settlement.id,
            merchantId: settlement.merchantId,
            merchantIncomeCents: settlement.merchantIncome,
            remark: `结算汇总结算 ${settlement.id.slice(0, 12)}`,
          });
        }

        return { ok: true as const, status: "confirmed" as const };
      },
      { isolationLevel: "Serializable" },
    );
    return r;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("could not serialize")) {
      return { ok: false, error: `并发冲突，请重试（${msg.slice(0, 80)}）` };
    }
    return { ok: false, error: `事务失败：${msg}` };
  }
}

/**
 * 关闭周期（pending/confirmed → archived，只读不可再改）
 *
 * [P0-2 必修 2026-07-03] updateMany({status:{not:'archived'}}) 原子状态机
 */
export async function archiveMerchantSettlement(
  id: string,
): Promise<ConfirmResult> {
  try {
    const r = await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.merchantSettlement.updateMany({
          where: { id, status: { not: "archived" } },
          data: { status: "archived" },
        });
        if (count === 0) {
          const s = await tx.merchantSettlement.findUnique({
            where: { id },
            select: { id: true, status: true },
          });
          if (!s) return { ok: false as const, error: "结算记录不存在" };
          if (s.status === "archived") {
            return { ok: true as const, status: "archived" as const }; // 幂等
          }
          return {
            ok: false as const,
            error: `仅非 archived 状态可关闭（当前：${s.status}）`,
          };
        }
        return { ok: true as const, status: "archived" as const };
      },
      { isolationLevel: "Serializable" },
    );
    return r;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("could not serialize")) {
      return { ok: false, error: `并发冲突，请重试（${msg.slice(0, 80)}）` };
    }
    return { ok: false, error: `事务失败：${msg}` };
  }
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
  // status 字段已包含在 summary 中（默认 default("pending")）

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
