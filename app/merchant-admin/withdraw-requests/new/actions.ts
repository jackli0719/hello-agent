"use server";

// [任务 18] 商家端提现申请 server action
//
// 关键：
// - 守卫：requireMerchant()（不收 form 入参的 merchantId，强制从 session 读）
// - CSRF：requireCsrf(formData)
// - 复用 src/lib/withdraw-request.ts:createWithdrawRequest（事务 + DB partial unique 兜底）
// - 不写 ActivityLog（商家操作不进入 admin 审计）

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCsrf, requireMerchant } from "@/src/lib/auth-helpers";
import { createWithdrawRequest } from "@/src/lib/withdraw-request";

const BACK = "/merchant-admin/withdraw-requests";

export async function createMerchantWithdrawRequestAction(formData: FormData) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    redirect(`${BACK}/new?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${BACK}/new?error=${encodeURIComponent(csrf.error)}`);
  }

  // # spec: amount 单位是分（与 MerchantSettlement 一致）；前端表单收元
  const amountYuanRaw = String(formData.get("amount") ?? "").trim();
  const remarkRaw = String(formData.get("remark") ?? "").trim();

  const amountYuan = Number(amountYuanRaw);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    redirect(`${BACK}/new?error=${encodeURIComponent("申请金额必须为正数（元）")}`);
  }
  const amountCents = Math.round(amountYuan * 100);

  // # spec: merchantId 永远从 session 读，form 传 merchantId 也不接受
  const r = await createWithdrawRequest({
    merchantId: auth.user.merchantId,
    amount: amountCents,
    remark: remarkRaw || null,
  });

  if (!r.ok) {
    redirect(`${BACK}/new?error=${encodeURIComponent(r.error)}`);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?created=1`);
}
