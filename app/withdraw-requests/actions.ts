"use server";

// [任务 13] WithdrawRequest server actions
//
// 设计：
// - createWithdrawRequestAction：admin 代发（merchantId 下拉 + amount + remark）
// - approveWithdrawRequestAction / rejectWithdrawRequestAction：审核
// - 守卫：requireAdmin + requireCsrf（与其他后台 action 一致）

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  approveWithdrawRequest,
  createWithdrawRequest,
  rejectWithdrawRequest,
} from "@/src/lib/withdraw-request";

const BACK = "/withdraw-requests";

/**
 * 创建提现申请（admin 代发）
 */
export async function createWithdrawRequestAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(csrf.error)}`);
  }

  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const amountYuanRaw = String(formData.get("amount") ?? "").trim();
  const remarkRaw = String(formData.get("remark") ?? "").trim();

  if (!merchantId) {
    redirect(`${BACK}?error=${encodeURIComponent("请选择商家")}`);
  }

  const amountYuan = Number(amountYuanRaw);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent("申请金额必须为正数（元）")}`);
  }
  const amountCents = Math.round(amountYuan * 100);

  const r = await createWithdrawRequest({
    merchantId,
    amount: amountCents,
    remark: remarkRaw || null,
  });

  if (!r.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "withdraw_request_created",
      targetType: "withdrawRequest",
      targetId: r.id,
      message: `创建商家提现申请 ${r.id}（商家 ${merchantId}，金额 ¥${amountYuan}）`,
      metadata: {
        withdrawRequestId: r.id,
        merchantId,
        amount: amountCents,
        available: r.available,
      },
      actorId: auth.user.id,
      actorName: auth.user.name,
      actorRole: "admin",
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath(BACK);
  redirect(`${BACK}?created=${r.id}`);
}

/**
 * 审核通过
 */
export async function approveWithdrawRequestAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = `${BACK}#${id}`;

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("参数缺失")}`);

  const r = await approveWithdrawRequest({
    id,
    reviewerName: auth.user.name,
  });
  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "withdraw_request_approved",
      targetType: "withdrawRequest",
      targetId: id,
      message: `管理员通过了提现申请 ${id}`,
      metadata: { id, status: r.status, merchantId: r.merchantId },
      actorId: auth.user.id,
      actorName: auth.user.name,
      actorRole: "admin",
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath(BACK);
  redirect(back);
}

/**
 * 审核拒绝
 */
export async function rejectWithdrawRequestAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const rejectReason = String(formData.get("rejectReason") ?? "").trim();
  const back = `${BACK}#${id}`;

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("参数缺失")}`);

  const r = await rejectWithdrawRequest({
    id,
    reviewerName: auth.user.name,
    rejectReason,
  });
  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "withdraw_request_rejected",
      targetType: "withdrawRequest",
      targetId: id,
      message: `管理员拒绝了提现申请 ${id}（原因：${rejectReason.slice(0, 100)}）`,
      metadata: {
        id,
        status: r.status,
        merchantId: r.merchantId,
        rejectReason,
      },
      actorId: auth.user.id,
      actorName: auth.user.name,
      actorRole: "admin",
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath(BACK);
  redirect(back);
}
