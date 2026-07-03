"use server";

// [任务 21] 售后工单 server actions — admin 端 3 个
//
// 设计（CLAUDE.md P0-0 决策 #1 仅 admin 处理）：
// - 客户发起：在 app/orders/actions.ts 的 customerCreateAfterSalesAction（复用订单 file）
// - admin 操作：本文件 3 个 action
//
// CSRF 约定：
// - 接 FormData 的 action → verifyCsrfToken(CSRF_FORM_FIELD)
// - 非 FormData 的 action（adminId/orderId 参数直接传） → verifyCsrfOrigin()
//
// 越权防御：
// - 全部 requireAdmin()
// - 操作日志自动写（after-sales.ts 内部已完成）

import { revalidatePath } from "next/cache";
import {
  startProcessing,
  resolve,
  reject,
  type AfterSalesResult,
} from "@/src/lib/after-sales";
import {
  verifyCsrfOrigin,
  verifyCsrfToken,
  CSRF_FORM_FIELD,
} from "@/src/lib/csrf";
import { requireAdmin } from "@/src/lib/auth-helpers";
import { getCurrentUser } from "@/src/lib/auth";

// 统一 action 返回类型（从 AfterSalesResult 拷过来加 ok:true 时的统一）
export type AdminAfterSalesResult = AfterSalesResult;

/**
 * [任务 21] admin 开始处理售后（pending → processing）。
 *
 * 业务：admin 在 /admin/after-sales/[orderId] 看到 pending 工单后点"开始处理"
 *
 * 鉴权：admin 专属
 * CSRF：非 FormData → verifyCsrfOrigin
 */
export async function adminStartProcessingAction(
  orderId: string,
): Promise<AdminAfterSalesResult> {
  // 鉴权
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  const handler = await resolveAdminActor(auth.user.id, auth.user.name);
  const result = await startProcessing(orderId, handler);
  if (result.ok) {
    try {
      revalidatePath("/admin/after-sales");
      revalidatePath(`/admin/after-sales/${orderId}`);
    } catch {
      /* 单测无 Next runtime */
    }
  }
  return result;
}

/**
 * [任务 21] admin 解决售后（processing → resolved）。
 *
 * 接 FormData（optional note）→ verifyCsrfToken
 */
export async function adminResolveAction(
  formData: FormData,
): Promise<AdminAfterSalesResult> {
  // 鉴权
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF（FormData）
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return {
      ok: false,
      category: "validation",
      error: "会话已过期，请刷新页面后重试",
    };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw ? noteRaw : undefined;

  const handler = await resolveAdminActor(auth.user.id, auth.user.name);
  const result = await resolve(orderId, handler, note);
  if (result.ok) {
    try {
      revalidatePath("/admin/after-sales");
      revalidatePath(`/admin/after-sales/${orderId}`);
    } catch {
      /* 单测无 Next runtime */
    }
  }
  return result;
}

/**
 * [任务 21] admin 拒绝售后（pending/processing → rejected）。
 *
 * 规则：reason 必填（业务决策 #4 — UI + service action 双校验）
 * 接 FormData → verifyCsrfToken
 */
export async function adminRejectAction(
  formData: FormData,
): Promise<AdminAfterSalesResult> {
  // 鉴权
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF（FormData）
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return {
      ok: false,
      category: "validation",
      error: "会话已过期，请刷新页面后重试",
    };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const rejectReason = String(formData.get("rejectReason") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }
  if (!rejectReason) {
    return { ok: false, category: "validation", error: "请填写拒绝原因" };
  }

  const handler = await resolveAdminActor(auth.user.id, auth.user.name);
  const result = await reject(orderId, rejectReason, handler);
  if (result.ok) {
    try {
      revalidatePath("/admin/after-sales");
      revalidatePath(`/admin/after-sales/${orderId}`);
    } catch {
      /* 单测无 Next runtime */
    }
  }
  return result;
}

/**
 * 解析 handler actor — admin name 优先用 auth.user.name，fallback 到 getCurrentUser()
 */
async function resolveAdminActor(
  authUserId: string,
  authUserName: string,
): Promise<{ id: string; name: string }> {
  const user = await getCurrentUser();
  return {
    id: user?.id ?? authUserId,
    name: user?.name ?? authUserName,
  };
}
