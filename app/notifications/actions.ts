"use server";

// [任务 19] 通知中心 — server actions（markRead + markAllRead）
//
// 越权防控：
// - markReadAction 接收 notificationId + form userId ?  **不接 userId**（永远从 session 读）
//   notificationId + session.userId → markRead 内 where: { id, userId } 硬过滤
// - markAllReadAction 不接参数；userId 从 session 读
//
// Next.js 15 form action 约束：必须返回 void；错误 throw 出 form 处理

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/lib/auth";
import { markRead, markAllRead } from "@/src/lib/notifications";
import { requireCsrf, requireRole } from "@/src/lib/auth-helpers";
import { logError } from "@/src/lib/logger";

/**
 * 标记单条通知为已读。
 * 防越权：markRead 内部 where 同时带 id + userId（userId 来自 session 而非 form）。
 */
export async function markReadAction(formData: FormData): Promise<void> {
  // 鉴权：customer/worker/merchant（admin 不在站内通知范围）
  const auth = await requireRole(["customer", "worker", "merchant"]);
  if (!auth.ok) {
    logError("[notification] markReadAction 鉴权失败", undefined, {
      error: auth.error,
    });
    return;
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    logError("[notification] markReadAction CSRF 失败", undefined, {
      error: csrf.error,
    });
    return;
  }

  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId) {
    logError("[notification] markReadAction 缺 notificationId");
    return;
  }

  const result = await markRead(notificationId, auth.user.id);
  if (!result.ok) {
    logError("[notification] markRead 业务失败", undefined, {
      error: result.error,
      notificationId,
    });
    return;
  }

  try {
    revalidatePath("/notifications");
    revalidatePath("/"); // 让 header 铃铛红点更新
  } catch {
    // 单测无 Next runtime
  }
}

/**
 * 标记当前用户所有未读为已读。
 */
export async function markAllReadAction(): Promise<void> {
  const auth = await requireRole(["customer", "worker", "merchant"]);
  if (!auth.ok) {
    logError("[notification] markAllReadAction 鉴权失败", undefined, {
      error: auth.error,
    });
    return;
  }
  // markAllReadAction 不接 formData — 走 Origin 头校验
  const { verifyCsrfOrigin } = await import("@/src/lib/csrf");
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    logError("[notification] markAllReadAction CSRF 失败", undefined, {
      error: csrf.error,
    });
    return;
  }

  await markAllRead(auth.user.id);

  try {
    revalidatePath("/notifications");
    revalidatePath("/");
  } catch {
    // 单测无 Next runtime
  }
}
