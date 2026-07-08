"use server";

// [任务 18] 商家端邀请码 server action
//
// 关键：
// - 守卫：requireMerchant()（merchantId 永远从 session 读）
// - CSRF：requireCsrf(formData)
// - 复用 Merchant.inviteCode 字段（schema 已存在 @unique + inviteCodeEnabled）
// - 不写 ActivityLog（商家操作不进入 admin 审计）

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCsrf, requireMerchant } from "@/src/lib/auth-helpers";
import { prisma } from "@/src/lib/db";
import { generateInviteCode } from "@/src/lib/codes";

const BACK = "/merchant-admin/invite-codes";

/**
 * 切换启停（enable / disable）
 */
export async function toggleInviteCodeAction(formData: FormData) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(csrf.error)}`);
  }

  // # spec: 用 session.merchantId 强绑；不接受 form 入参
  const merchant = await prisma.merchant.findUnique({
    where: { id: auth.user.merchantId },
    select: { inviteCodeEnabled: true },
  });
  if (!merchant) {
    redirect(`${BACK}?error=${encodeURIComponent("商家不存在")}`);
  }
  await prisma.merchant.update({
    where: { id: auth.user.merchantId },
    data: { inviteCodeEnabled: !merchant.inviteCodeEnabled },
  });

  revalidatePath(BACK);
  redirect(BACK);
}

/**
 * 重新生成邀请码字符串
 *
 * # spec: 重新生成只改 Merchant.inviteCode 字符串；Master.joinSource 是历史快照不联动
 */
export async function regenerateInviteCodeAction(formData: FormData) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(auth.error)}`);
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    redirect(`${BACK}?error=${encodeURIComponent(csrf.error)}`);
  }

  // 唯一性兜底：极端情况下 base36 8 位可能撞（演示期概率 < 1e-12），
  // 重试 3 次仍撞就回退错误
  let newCode: string | null = null;
  for (let i = 0; i < 3; i++) {
    const candidate = generateInviteCode();
    const existing = await prisma.merchant.findUnique({
      where: { inviteCode: candidate },
      select: { id: true },
    });
    if (!existing) {
      newCode = candidate;
      break;
    }
  }
  if (!newCode) {
    redirect(`${BACK}?error=${encodeURIComponent("生成失败，请重试")}`);
  }

  await prisma.merchant.update({
    where: { id: auth.user.merchantId },
    data: { inviteCode: newCode },
  });

  revalidatePath(BACK);
  redirect(BACK);
}
