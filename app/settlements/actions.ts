"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import { generateAllSettlementPreviews } from "@/src/lib/settlement";

export async function generateSettlementsAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`/settlements?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`/settlements?error=${encodeURIComponent(csrf.error)}`);
  }

  const result = await generateAllSettlementPreviews();

  try {
    await createActivityLog({
      action: "settlement_preview_generated",
      targetType: "order",
      targetId: "batch",
      message: `生成结算预览：新建 ${result.created} 条 / 跳过 ${result.skipped} 条 / 失败 ${result.failed} 条`,
      metadata: result,
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/settlements");
  redirect(
    `/settlements?generated=${result.created}&skipped=${result.skipped}&failed=${result.failed}`,
  );
}
