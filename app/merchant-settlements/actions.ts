"use server";

// [P0 必修 2026-07-03] ledger 写入已并入业务事务（merchant-settlement.ts / payout.ts），
// actions 层不再单独调 record*，避免"业务成功但 ledger 失败被吞"。

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  archiveMerchantSettlement,
  confirmMerchantSettlement,
  generateAllMerchantSettlements,
} from "@/src/lib/merchant-settlement";
import { createPayoutRecord } from "@/src/lib/payout";

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
      message: `生成商家结算汇总：新建 ${result.created} 条 / 更新 ${result.updated} 条 / 跳过 ${result.skipped} 条（已确认/已归档不覆盖）`,
      metadata: result,
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath("/merchant-settlements");
  redirect(
    `/merchant-settlements?created=${result.created}&updated=${result.updated}&skipped=${result.skipped}`,
  );
}

// [任务 10] 关闭周期（archived）
export async function archiveMerchantSettlementAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = id ? `/merchant-settlements/${id}` : "/merchant-settlements";

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
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

// [任务 9] 确认结算
//
// [P0-3 必修] settlement 状态变更 + recordOrderCommissionInTx 写 ledger 在
// merchant-settlement.ts 同事务；ledger 失败 → 业务回滚
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
  revalidatePath("/finance-ledgers");
  redirect(back);
}

// [任务 12] 录入线下打款
//
// [P0-3 必修] payout 创建 + recordPayoutInTx 写 ledger 在 payout.ts 同事务；
// ledger 失败 → 业务回滚（payout 记录 + ledger 都不写）
export async function createPayoutAction(formData: FormData) {
  const settlementId = String(formData.get("settlementId") ?? "").trim();
  const back = settlementId
    ? `/merchant-settlements/${settlementId}`
    : "/merchant-settlements";

  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  }
  if (!settlementId) {
    redirect(`${back}?error=${encodeURIComponent("参数缺失")}`);
  }

  // 解析表单
  const amountYuanRaw = String(formData.get("amount") ?? "").trim();
  const paidAtRaw = String(formData.get("paidAt") ?? "").trim();
  const proofUrlRaw = String(formData.get("proofUrl") ?? "").trim();

  const amountYuan = Number(amountYuanRaw);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    redirect(`${back}?error=${encodeURIComponent("打款金额必须为正数（元）")}`);
  }
  const amountCents = Math.round(amountYuan * 100);

  const paidAt = new Date(paidAtRaw);
  if (isNaN(paidAt.getTime())) {
    redirect(`${back}?error=${encodeURIComponent("打款时间格式错误")}`);
  }

  const r = await createPayoutRecord({
    withdrawRequestId: settlementId,
    amount: amountCents,
    paidAt,
    proofUrl: proofUrlRaw || null,
    operator: auth.user.name,
  });

  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "payout_record_created",
      targetType: "payoutRecord",
      targetId: r.id,
      message: `录入线下打款 ${r.id}（settlement ${settlementId}，金额 ¥${amountYuan}，累计 ¥${(r.cumulative / 100).toFixed(2)}）`,
      metadata: {
        payoutRecordId: r.id,
        settlementId,
        amount: amountCents,
        cumulative: r.cumulative,
        remaining: r.remaining,
      },
      actorId: auth.user.id,
      actorName: auth.user.name,
      actorRole: "admin",
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath(back);
  revalidatePath("/payout-records");
  revalidatePath("/finance-ledgers");
  redirect(`${back}?payout=${r.id}`);
}
