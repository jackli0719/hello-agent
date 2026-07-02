// [任务 5] 分成策略（CommissionStrategy）业务逻辑
//
// 设计要点：
// - 纯函数 + DB 写操作封装
// - percentage 模式：platformRate + merchantRate + workerRate 必须 = 1（容差 0.001），每个 0-1
// - fixed 模式：3 个 fixed 金额都必须 >= 0
// - enabled 默认 true
// - 一个商家可有多条策略（schema 允许，demo seed 只 1 条/商家）
// - 不做支付/提现/结算，只做配置

import { prisma } from "@/src/lib/db";

export type CommissionStrategyType = "percentage" | "fixed";

export type CommissionStrategyField =
  | "merchantId"
  | "name"
  | "strategyType"
  | "platformRate"
  | "merchantRate"
  | "workerRate"
  | "fixedPlatformAmount"
  | "fixedMerchantAmount"
  | "fixedWorkerAmount"
  | "enabled";

export interface CreateCommissionStrategyInput {
  merchantId: string;
  name: string;
  strategyType: CommissionStrategyType;
  // percentage
  platformRate?: number;
  merchantRate?: number;
  workerRate?: number;
  // fixed
  fixedPlatformAmount?: number;
  fixedMerchantAmount?: number;
  fixedWorkerAmount?: number;
  enabled?: boolean;
}

export interface UpdateCommissionStrategyInput extends CreateCommissionStrategyInput {
  id: string;
}

export type CommissionStrategyResult =
  | { ok: true; id: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: CommissionStrategyField;
    };

// 比例 = 1 容差（避免浮点误差）
const RATE_SUM_TOLERANCE = 0.001;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateStrategyInput(
  input: Partial<CreateCommissionStrategyInput>,
):
  | {
      ok: true;
      cleaned: Required<
        Pick<
          CreateCommissionStrategyInput,
          "merchantId" | "name" | "strategyType"
        >
      > &
        CreateCommissionStrategyInput;
    }
  | { ok: false; error: string; field: CommissionStrategyField } {
  // 商家必填
  const merchantId = cleanText(input.merchantId);
  if (!merchantId) {
    return { ok: false, error: "请选择商家", field: "merchantId" };
  }

  // 策略名必填
  const name = cleanText(input.name);
  if (!name) {
    return { ok: false, error: "请填写策略名", field: "name" };
  }
  if (name.length > 50) {
    return { ok: false, error: "策略名不超过 50 字", field: "name" };
  }

  // 类型
  const strategyType = cleanText(input.strategyType) as CommissionStrategyType;
  if (strategyType !== "percentage" && strategyType !== "fixed") {
    return {
      ok: false,
      error: "策略类型必须为 percentage 或 fixed",
      field: "strategyType",
    };
  }

  // 数字解析（兼容字符串输入）
  const platformRate =
    typeof input.platformRate === "number"
      ? input.platformRate
      : Number(input.platformRate ?? 0);
  const merchantRate =
    typeof input.merchantRate === "number"
      ? input.merchantRate
      : Number(input.merchantRate ?? 0);
  const workerRate =
    typeof input.workerRate === "number"
      ? input.workerRate
      : Number(input.workerRate ?? 0);
  const fixedPlatformAmount =
    typeof input.fixedPlatformAmount === "number"
      ? input.fixedPlatformAmount
      : Number(input.fixedPlatformAmount ?? 0);
  const fixedMerchantAmount =
    typeof input.fixedMerchantAmount === "number"
      ? input.fixedMerchantAmount
      : Number(input.fixedMerchantAmount ?? 0);
  const fixedWorkerAmount =
    typeof input.fixedWorkerAmount === "number"
      ? input.fixedWorkerAmount
      : Number(input.fixedWorkerAmount ?? 0);

  // percentage 模式校验：三方比例之和 = 1，每个 0-1
  if (strategyType === "percentage") {
    if (platformRate < 0 || platformRate > 1) {
      return {
        ok: false,
        error: "平台比例必须在 0-1 之间",
        field: "platformRate",
      };
    }
    if (merchantRate < 0 || merchantRate > 1) {
      return {
        ok: false,
        error: "商家比例必须在 0-1 之间",
        field: "merchantRate",
      };
    }
    if (workerRate < 0 || workerRate > 1) {
      return {
        ok: false,
        error: "师傅比例必须在 0-1 之间",
        field: "workerRate",
      };
    }
    const sum = platformRate + merchantRate + workerRate;
    if (Math.abs(sum - 1) > RATE_SUM_TOLERANCE) {
      return {
        ok: false,
        error: `三方比例之和必须 = 1（当前 ${sum.toFixed(4)}）`,
        field: "workerRate",
      };
    }
  }

  // fixed 模式校验：3 个 fixed 金额都必须 >= 0
  if (strategyType === "fixed") {
    if (fixedPlatformAmount < 0) {
      return {
        ok: false,
        error: "平台固定金额必须 >= 0",
        field: "fixedPlatformAmount",
      };
    }
    if (fixedMerchantAmount < 0) {
      return {
        ok: false,
        error: "商家固定金额必须 >= 0",
        field: "fixedMerchantAmount",
      };
    }
    if (fixedWorkerAmount < 0) {
      return {
        ok: false,
        error: "师傅固定金额必须 >= 0",
        field: "fixedWorkerAmount",
      };
    }
  }

  return {
    ok: true,
    cleaned: {
      merchantId,
      name,
      strategyType,
      platformRate,
      merchantRate,
      workerRate,
      fixedPlatformAmount,
      fixedMerchantAmount,
      fixedWorkerAmount,
      enabled: input.enabled !== false,
    },
  };
}

/** 商家必须存在（FK 约束会兜底，但提早给清楚错误） */
async function requireMerchant(
  merchantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true },
  });
  if (!m) {
    return { ok: false, error: "商家不存在" };
  }
  return { ok: true };
}

export async function listCommissionStrategies(merchantId?: string) {
  return prisma.commissionStrategy.findMany({
    where: merchantId ? { merchantId } : undefined,
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getCommissionStrategy(id: string) {
  return prisma.commissionStrategy.findUnique({
    where: { id },
    include: { merchant: { select: { id: true, name: true } } },
  });
}

export async function countCommissionStrategiesByMerchant(
  merchantId: string,
): Promise<number> {
  return prisma.commissionStrategy.count({ where: { merchantId } });
}

export async function createCommissionStrategy(
  rawInput: Partial<CreateCommissionStrategyInput>,
): Promise<CommissionStrategyResult> {
  const validated = validateStrategyInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }
  const input = validated.cleaned;

  const merchantCheck = await requireMerchant(input.merchantId);
  if (!merchantCheck.ok) {
    return {
      ok: false,
      category: "validation",
      error: merchantCheck.error,
      field: "merchantId",
    };
  }

  try {
    const row = await prisma.commissionStrategy.create({
      data: {
        merchantId: input.merchantId,
        name: input.name,
        strategyType: input.strategyType,
        platformRate: input.platformRate ?? 0,
        merchantRate: input.merchantRate ?? 0,
        workerRate: input.workerRate ?? 0,
        fixedPlatformAmount: input.fixedPlatformAmount ?? 0,
        fixedMerchantAmount: input.fixedMerchantAmount ?? 0,
        fixedWorkerAmount: input.fixedWorkerAmount ?? 0,
        enabled: input.enabled !== false,
      },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, category: "system", error: "分成策略保存失败" };
  }
}

export async function updateCommissionStrategy(
  rawInput: Partial<UpdateCommissionStrategyInput>,
): Promise<CommissionStrategyResult> {
  const id = cleanText(rawInput.id);
  if (!id) {
    return {
      ok: false,
      category: "validation",
      error: "缺少策略 id",
      field: "name",
    };
  }

  const validated = validateStrategyInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }
  const input = validated.cleaned;

  const exists = await prisma.commissionStrategy.findUnique({ where: { id } });
  if (!exists) {
    return {
      ok: false,
      category: "validation",
      error: `分成策略 ${id} 不存在`,
      field: "name",
    };
  }

  try {
    await prisma.commissionStrategy.update({
      where: { id },
      data: {
        merchantId: input.merchantId,
        name: input.name,
        strategyType: input.strategyType,
        platformRate: input.platformRate ?? 0,
        merchantRate: input.merchantRate ?? 0,
        workerRate: input.workerRate ?? 0,
        fixedPlatformAmount: input.fixedPlatformAmount ?? 0,
        fixedMerchantAmount: input.fixedMerchantAmount ?? 0,
        fixedWorkerAmount: input.fixedWorkerAmount ?? 0,
        enabled: input.enabled !== false,
      },
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, category: "system", error: "分成策略保存失败" };
  }
}

export async function toggleCommissionStrategyEnabled(
  id: string,
  enabled: boolean,
) {
  return prisma.commissionStrategy.update({
    where: { id },
    data: { enabled },
  });
}
