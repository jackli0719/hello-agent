"use server";

// [任务 T2-1] WorkerWithdrawRequest server actions
//
// 权限：
// - createWorkerWithdrawRequestAction: 仅 worker（师傅自己申请）
// - approveWorkerWithdrawRequestAction / rejectWorkerWithdrawRequestAction: 仅 admin
//
// 设计：
// - create 不接收 workerId（自动从 session 拿，避免越权代发）
// - approve / reject 由 admin 审核（worker 角色拒绝）
// - **不写 FinanceLedger**（师傅端无 payout 流程）

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import {
  requireAdmin,
  requireCsrf,
  requireWorker,
} from "@/src/lib/auth-helpers";
import {
  approveWorkerWithdrawRequest,
  createWorkerWithdrawRequest,
  rejectWorkerWithdrawRequest,
} from "@/src/lib/worker-withdraw-request";

const BACK = "/master-withdraw-requests";

/**
 * 创建师傅提现申请（仅 worker 自己）
 */
export async function createWorkerWithdrawRequestAction(formData: FormData) {
  const auth = await requireWorker();
  if (!auth.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(csrf.error)}`);
  }

  // workerId 强制从 session 取 — 不接受表单参数，防止越权代发
  const workerId = auth.user.workerId!;

  const amountYuanRaw = String(formData.get("amount") ?? "").trim();
  const remarkRaw = String(formData.get("remark") ?? "").trim();

  const amountYuan = Number(amountYuanRaw);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent("申请金额必须为正数（元）")}`);
  }
  const amountCents = Math.round(amountYuan * 100);

  const r = await createWorkerWithdrawRequest({
    workerId,
    amount: amountCents,
    remark: remarkRaw || null,
  });

  if (!r.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "worker_withdraw_request_created",
      targetType: "workerWithdrawRequest",
      targetId: r.id,
      message: `师傅 ${auth.user.name} 发起提现申请 ${r.id}（金额 ¥${amountYuan}）`,
      metadata: {
        withdrawRequestId: r.id,
        workerId,
        amount: amountCents,
        available: r.available,
      },
      actorId: auth.user.id,
      actorName: auth.user.name,
      actorRole: "worker",
    });
  } catch {
    // 写日志失败不阻塞
  }

  revalidatePath(BACK);
  redirect(`${BACK}?created=${r.id}`);
}

/**
 * 审核通过（仅 admin）
 */
export async function approveWorkerWithdrawRequestAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = `${BACK}#${id}`;

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("参数缺失")}`);

  const r = await approveWorkerWithdrawRequest({
    id,
    reviewerName: auth.user.name,
  });
  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "worker_withdraw_request_approved",
      targetType: "workerWithdrawRequest",
      targetId: id,
      message: `管理员通过了师傅提现申请 ${id}`,
      metadata: { id, status: r.status, workerId: r.workerId },
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
 * 审核拒绝（仅 admin）
 */
export async function rejectWorkerWithdrawRequestAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const rejectReason = String(formData.get("rejectReason") ?? "").trim();
  const back = `${BACK}#${id}`;

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("参数缺失")}`);

  const r = await rejectWorkerWithdrawRequest({
    id,
    reviewerName: auth.user.name,
    rejectReason,
  });
  if (!r.ok) {
    redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  }

  try {
    await createActivityLog({
      action: "worker_withdraw_request_rejected",
      targetType: "workerWithdrawRequest",
      targetId: id,
      message: `管理员拒绝了师傅提现申请 ${id}（原因：${rejectReason.slice(0, 100)}）`,
      metadata: {
        id,
        status: r.status,
        workerId: r.workerId,
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
