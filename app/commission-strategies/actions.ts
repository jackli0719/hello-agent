"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  createCommissionStrategy,
  toggleCommissionStrategyEnabled,
  updateCommissionStrategy,
  type CommissionStrategyResult,
  type CommissionStrategyType,
} from "@/src/lib/commission";

function commissionInput(formData: FormData) {
  return {
    merchantId: String(formData.get("merchantId") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    strategyType: String(
      formData.get("strategyType") ?? "",
    ) as CommissionStrategyType,
    // percentage
    platformRate: Number(formData.get("platformRate") ?? 0),
    merchantRate: Number(formData.get("merchantRate") ?? 0),
    workerRate: Number(formData.get("workerRate") ?? 0),
    // fixed
    fixedPlatformAmount: Number(formData.get("fixedPlatformAmount") ?? 0),
    fixedMerchantAmount: Number(formData.get("fixedMerchantAmount") ?? 0),
    fixedWorkerAmount: Number(formData.get("fixedWorkerAmount") ?? 0),
    enabled: formData.get("enabled") != null,
  };
}

function errorUrl(
  path: string,
  result: Exclude<CommissionStrategyResult, { ok: true }>,
) {
  return `${path}?error=${encodeURIComponent(result.error)}`;
}

export async function createCommissionStrategyAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) redirect(errorUrl("/commission-strategies/new", auth));

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(errorUrl("/commission-strategies/new", csrf));

  const input = commissionInput(formData);
  const result = await createCommissionStrategy(input);
  if (!result.ok) redirect(errorUrl("/commission-strategies/new", result));

  try {
    await createActivityLog({
      action: "commission_strategy_created",
      targetType: "commissionStrategy",
      targetId: result.id,
      message: `管理员新增分成策略：${input.name}（${input.strategyType}）`,
      metadata: input,
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/commission-strategies");
  revalidatePath("/merchants");
  redirect(`/commission-strategies?created=${encodeURIComponent(result.id)}`);
}

export async function updateCommissionStrategyAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = id
    ? `/commission-strategies/${id}/edit`
    : "/commission-strategies";

  const auth = await requireAdmin();
  if (!auth.ok) redirect(errorUrl(back, auth));

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(errorUrl(back, csrf));

  const input = commissionInput(formData);
  const result = await updateCommissionStrategy({ id, ...input });
  if (!result.ok) redirect(errorUrl(back, result));

  try {
    await createActivityLog({
      action: "commission_strategy_updated",
      targetType: "commissionStrategy",
      targetId: result.id,
      message: `管理员更新分成策略：${input.name}`,
      metadata: input,
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/commission-strategies");
  revalidatePath(`/commission-strategies/${id}/edit`);
  redirect(`/commission-strategies?updated=${encodeURIComponent(result.id)}`);
}

export async function toggleCommissionStrategyAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const enabledStr = String(formData.get("enabled") ?? "true");
  const enabled = enabledStr === "true";
  const back = "/commission-strategies";

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);

  if (!id) redirect(`${back}?error=${encodeURIComponent("参数缺失")}`);

  await toggleCommissionStrategyEnabled(id, enabled);

  try {
    await createActivityLog({
      action: enabled
        ? "commission_strategy_enabled"
        : "commission_strategy_disabled",
      targetType: "commissionStrategy",
      targetId: id,
      message: `管理员${enabled ? "启用" : "禁用"}了分成策略 ${id}`,
      metadata: { id, enabled },
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath(back);
  redirect(back);
}
