"use server";

// [任务 17] WorkerSettlement server actions
//
// 守卫：requireAdmin + requireCsrf（与其他后台 action 一致）
//
// 决策：
// - 不写 FinanceLedger（不是财务事件，是运营视图）
// - 不写 ActivityLog（系统生成而非用户操作，merchant-settlements 写了是因为它是状态机操作）

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import { generateAllWorkerSettlements } from "@/src/lib/worker-settlement";

const BACK = "/worker-settlements";

export async function generateWorkerSettlementsAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(csrf.error)}`);
  }

  const result = await generateAllWorkerSettlements();

  revalidatePath(BACK);
  redirect(
    `${BACK}?created=${result.created}&updated=${result.updated}&upserted=${result.upserted}`,
  );
}
