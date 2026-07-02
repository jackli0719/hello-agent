"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import { generateAllMerchantSettlements } from "@/src/lib/merchant-settlement";

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
