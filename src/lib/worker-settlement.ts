// [任务 17] 师傅维度结算汇总（WorkerSettlement）业务逻辑
//
// 设计要点：
// - 数据源：SettlementPreview（commission strategy 拆分后的快照）
//   - preview 由 completed 订单生成（参见 src/lib/settlement.ts:splitOrderAmountByStrategy）
//   - 演示 demo 不会变：masterId 改派后历史 settlement 保留（快照语义）
// - 按 (workerId, period "YYYY-MM") 分组
// - 唯一约束：@@unique([workerId, period]) — 重复生成用 upsert（覆盖更新）
// - 无状态机：仅展示用，不走打款
// - 不写 FinanceLedger：不是财务事件
// - 不写 ActivityLog：系统生成而非用户操作
//
// 金额单位：分（与 SettlementPreview 一致）
//
// 与 MerchantSettlement 的差异：
// - merchant-settlement.ts:175-206 listMerchantSettlements / getMerchantSettlement
//   这里镜像：listWorkerSettlements / getWorkerSettlement / getWorkerSettlementByKey
// - merchant-settlement.ts 有 confirm / archive 状态机 — 这里没有

import { prisma } from "@/src/lib/db";
import { formatPeriod as formatPeriodBase } from "@/src/lib/merchant-settlement";

export type WorkerSettlementPeriod = string; // "YYYY-MM"

export type WorkerSettlementGenerateResult = {
  upserted: number;
  created: number;
  updated: number;
  details: Array<{
    workerId: string;
    period: string;
    action: "created" | "updated";
  }>;
};

/**
 * 格式化 Date 为 "YYYY-MM"（re-export merchant-settlement 实现）
 */
export function formatPeriod(date: Date): WorkerSettlementPeriod {
  return formatPeriodBase(date);
}

/**
 * 生成所有师傅的结算汇总
 * - 扫 SettlementPreview（基于它的 createdAt 取 period）
 * - 按 (workerId, period) 聚合
 *   - orderCount += 1
 *   - totalAmount += orderAmount
 *   - workerIncome += workerAmount
 * - upsert 到 WorkerSettlement（unique(workerId, period)）
 *
 * 返回：{ upserted, created, updated, details }
 *
 * # spec: 聚合口径 = SettlementPreview 全表，无 status 过滤
 *   - 假设：preview 全部由 completed 订单生成，preview.status='failed' 不应存在
 *   - 若实际有 failed preview，需补 where: { status: { not: "failed" } } 过滤
 */
export async function generateAllWorkerSettlements(): Promise<WorkerSettlementGenerateResult> {
  const previews = await prisma.settlementPreview.findMany({
    select: {
      masterId: true,
      orderAmount: true,
      workerAmount: true,
      createdAt: true,
    },
  });

  // in-memory Map 聚合
  const buckets = new Map<
    string,
    {
      workerId: string;
      period: string;
      orderCount: number;
      totalAmount: number;
      workerIncome: number;
    }
  >();

  for (const p of previews) {
    const period = formatPeriod(p.createdAt);
    const key = `${p.masterId}|${period}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.totalAmount += p.orderAmount;
      existing.workerIncome += p.workerAmount;
    } else {
      buckets.set(key, {
        workerId: p.masterId,
        period,
        orderCount: 1,
        totalAmount: p.orderAmount,
        workerIncome: p.workerAmount,
      });
    }
  }

  let created = 0;
  let updated = 0;
  const details: WorkerSettlementGenerateResult["details"] = [];

  for (const b of buckets.values()) {
    const existing = await prisma.workerSettlement.findUnique({
      where: { workerId_period: { workerId: b.workerId, period: b.period } },
      select: { id: true },
    });

    if (existing) {
      await prisma.workerSettlement.update({
        where: { id: existing.id },
        data: {
          orderCount: b.orderCount,
          totalAmount: b.totalAmount,
          workerIncome: b.workerIncome,
        },
      });
      updated++;
      details.push({
        workerId: b.workerId,
        period: b.period,
        action: "updated",
      });
    } else {
      await prisma.workerSettlement.create({
        data: {
          workerId: b.workerId,
          period: b.period,
          orderCount: b.orderCount,
          totalAmount: b.totalAmount,
          workerIncome: b.workerIncome,
        },
      });
      created++;
      details.push({
        workerId: b.workerId,
        period: b.period,
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

/**
 * 列出师傅结算汇总（按 period desc, workerId asc）
 *
 * 过滤：可选 period（YYYY-MM）/ workerId
 */
export async function listWorkerSettlements(filter?: {
  period?: string;
  workerId?: string;
}) {
  return prisma.workerSettlement.findMany({
    where: {
      ...(filter?.period ? { period: filter.period } : {}),
      ...(filter?.workerId ? { workerId: filter.workerId } : {}),
    },
    include: { worker: { select: { id: true, name: true, phone: true } } },
    orderBy: [{ period: "desc" }, { workerId: "asc" }],
  });
}

/**
 * 按 id 查单条
 */
export async function getWorkerSettlement(id: string) {
  return prisma.workerSettlement.findUnique({
    where: { id },
    include: { worker: { select: { id: true, name: true, phone: true } } },
  });
}

/**
 * 按 (workerId, period) 查单条
 */
export async function getWorkerSettlementByKey(
  workerId: string,
  period: WorkerSettlementPeriod,
) {
  return prisma.workerSettlement.findUnique({
    where: { workerId_period: { workerId, period } },
    include: { worker: { select: { id: true, name: true, phone: true } } },
  });
}

/**
 * 列出所有已生成的 period（用于页面月份筛选 dropdown）
 *
 * 逻辑：distinct(period) desc — 最近的月份在前
 */
export async function listWorkerSettlementPeriods(): Promise<string[]> {
  const rows = await prisma.workerSettlement.findMany({
    select: { period: true },
    distinct: ["period"],
    orderBy: { period: "desc" },
  });
  return rows.map((r) => r.period);
}
