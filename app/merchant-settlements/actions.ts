"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  archiveMerchantSettlement,
  confirmMerchantSettlement,
  generateAllMerchantSettlements,
} from "@/src/lib/merchant-settlement";

export async function generateMerchantSettlementsAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`/merchant-settlements?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`/merchant-settlements?error=${encodeURIComponent(csrf.error)}`);
  }

  const result = await generateAllMerchantSettlements();

  try {
    await createActivityLog({
      action: "merchant_settlement_generated",
      targetType: "merchant",
      targetId: "batch",
      message: `生成商家结算汇总：新建 ${result.created} 条 / 更新 ${result.updated} 条（基于 ${result.upserted} 个 (merchant, period) 组合）`,
      metadata: result,
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/merchant-settlements");
  redirect(
    `/merchant-settlements?created=${result.created}&updated=${result.updated}`,
  );
}

// [任务 9] 确认结算
export async function confirmMerchantSettlementAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = id ? `/merchant-settlements/${id}` : "/merchant-settlements";

  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  }
  if (!id) redirect(`${back}?error=${encodeURIComponent("参数缺失")}`);

  const r = await confirmMerchantSettlement(id);
  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "merchant_settlement_confirmed",
      targetType: "merchantSettlement",
      targetId: id,
      message: `管理员确认了商家结算 ${id}`,
      metadata: { id, status: r.status },
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/merchant-settlements");
  revalidatePath(back);
  redirect(back);
}

// [任务 10] 关闭周期（archived）
export async function archiveMerchantSettlementAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = id ? `/merchant-settlements/${id}` : "/merchant-settlements";

  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  }
  if (!id) redirect(`${back}?error=${encodeURIComponent("参数缺失")}`);

  const r = await archiveMerchantSettlement(id);
  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "merchant_settlement_archived",
      targetType: "merchantSettlement",
      targetId: id,
      message: `管理员关闭了商家结算周期 ${id}`,
      metadata: { id, status: r.status },
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/merchant-settlements");
  revalidatePath(back);
  redirect(back);
}
