// [任务 6] 结算预览（SettlementPreview）业务逻辑
//
// 设计要点：
// - 只对 completed 订单生成
// - 1 个订单 = 1 个预览（orderId @unique）
// - 按 strategyType 计算三方金额：
//   - percentage: platform/merchant/worker 三个 rate * orderAmount
//   - fixed: 直接用 fixedPlatform/fixedMerchant/fixedWorker 金额
// - 不做提现/打款/真实结算
// - 找不到 strategy 时 fallback：orderAmount 全给平台（最保守）
//
// 金额单位：分（与 Order.amount 一致）

import { prisma } from "@/src/lib/db";

export type SettlementStatus = "generated" | "archived" | "failed";

export type SettlementGenerateResult =
  { ok: true; id: string; isNew: boolean } | { ok: false; error: string };

/**
 * 三方金额计算 — 按 strategyType 分支
 * 找不到 strategy 时 fallback：全部给平台（保守，避免 merchant/worker 多收）
 */
function computeAmounts(
  orderAmount: number,
  strategy: {
    strategyType: string;
    platformRate: number;
    merchantRate: number;
    workerRate: number;
    fixedPlatformAmount: number;
    fixedMerchantAmount: number;
    fixedWorkerAmount: number;
  } | null,
): { platformAmount: number; merchantAmount: number; workerAmount: number } {
  if (!strategy) {
    // fallback：全部给平台
    return {
      platformAmount: orderAmount,
      merchantAmount: 0,
      workerAmount: 0,
    };
  }

  if (strategy.strategyType === "percentage") {
    // 用 Math.round 避免浮点累计误差（分单位）
    return {
      platformAmount: Math.round(orderAmount * strategy.platformRate),
      merchantAmount: Math.round(orderAmount * strategy.merchantRate),
      workerAmount: Math.round(orderAmount * strategy.workerRate),
    };
  }

  if (strategy.strategyType === "fixed") {
    // fixed 模式：金额可能超过 orderAmount（业务侧控制）
    return {
      platformAmount: strategy.fixedPlatformAmount,
      merchantAmount: strategy.fixedMerchantAmount,
      workerAmount: strategy.fixedWorkerAmount,
    };
  }

  // 未知 strategyType — 保守 fallback
  return {
    platformAmount: orderAmount,
    merchantAmount: 0,
    workerAmount: 0,
  };
}

/**
 * 生成单张订单的结算预览
 * - 跳过：非 completed / 已存在 preview
 * - 找不到 master/merchant 时 fail
 */
export async function generateSettlementPreview(
  orderId: string,
): Promise<SettlementGenerateResult> {
  // 1. 查订单 + master + merchant
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      master: {
        include: {
          merchant: {
            include: {
              commissionStrategies: {
                where: { enabled: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });
  if (!order) {
    return { ok: false, error: `订单 ${orderId} 不存在` };
  }
  if (order.status !== "completed") {
    return {
      ok: false,
      error: `订单 ${orderId} 状态为 ${order.status}，仅 completed 订单可生成预览`,
    };
  }
  if (!order.masterId || !order.master) {
    return { ok: false, error: `订单 ${orderId} 未指派师傅，无法生成预览` };
  }
  if (!order.master.merchant) {
    return {
      ok: false,
      error: `订单 ${orderId} 师傅未绑定商家，无法生成预览`,
    };
  }

  // 2. 查是否已存在
  const existing = await prisma.settlementPreview.findUnique({
    where: { orderId },
  });
  if (existing) {
    return { ok: true, id: existing.id, isNew: false };
  }

  // 3. 取该商家第 1 个 enabled 策略（按 createdAt asc）
  const strategy = order.master.merchant.commissionStrategies[0] ?? null;

  // 4. 计算金额
  const amounts = computeAmounts(order.amount, strategy);

  // 5. 写 SettlementPreview
  const created = await prisma.settlementPreview.create({
    data: {
      orderId,
      merchantId: order.master.merchant.id,
      masterId: order.master.id,
      strategyId: strategy?.id ?? null,
      orderAmount: order.amount,
      platformAmount: amounts.platformAmount,
      merchantAmount: amounts.merchantAmount,
      workerAmount: amounts.workerAmount,
      status: "generated",
    },
  });
  return { ok: true, id: created.id, isNew: true };
}

/**
 * 批量生成 — 扫所有 completed 订单，无 preview 的全生成
 * 返回：{ created, skipped, failed } 统计
 */
export async function generateAllSettlementPreviews(): Promise<{
  created: number;
  skipped: number;
  failed: number;
  details: Array<{ orderId: string; ok: boolean; error?: string }>;
}> {
  const completed = await prisma.order.findMany({
    where: { status: "completed" },
    select: { id: true },
  });
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const details: Array<{ orderId: string; ok: boolean; error?: string }> = [];

  for (const o of completed) {
    const r = await generateSettlementPreview(o.id);
    if (r.ok) {
      if (r.isNew) created++;
      else skipped++;
      details.push({ orderId: o.id, ok: true });
    } else {
      failed++;
      details.push({ orderId: o.id, ok: false, error: r.error });
    }
  }
  return { created, skipped, failed, details };
}

export async function listSettlementPreviews() {
  return prisma.settlementPreview.findMany({
    include: {
      order: {
        select: {
          id: true,
          customerName: true,
          customerPhone: true,
          serviceName: true,
          amount: true,
          status: true,
          updatedAt: true,
        },
      },
      merchant: { select: { id: true, name: true } },
      master: { select: { id: true, name: true } },
      strategy: { select: { id: true, name: true, strategyType: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getSettlementPreviewByOrder(orderId: string) {
  return prisma.settlementPreview.findUnique({
    where: { orderId },
    include: {
      merchant: { select: { id: true, name: true } },
      master: { select: { id: true, name: true } },
      strategy: true,
    },
  });
}

export async function countSettlementPreviewsByMerchant(
  merchantId: string,
): Promise<number> {
  return prisma.settlementPreview.count({ where: { merchantId } });
}
