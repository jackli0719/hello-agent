"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  bindMerchantArea,
  createMerchant,
  toggleMerchantAreaEnabled,
  updateMerchant,
  type CreateMerchantInput,
  type MerchantResult,
  type MerchantStatus,
  type UpdateMerchantInput,
} from "@/src/lib/merchants";

// [P1-1 修] 拆 create / update 共用函数
// 原因：/merchants/new 没 inviteCodeEnabled checkbox → FormData 没 key
//       之前共用函数传 inviteCodeEnabled=false → 覆盖 createMerchant() 默认 true
//       导致新商家默认禁用
function baseMerchantInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    contactName: String(formData.get("contactName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    status: String(formData.get("status") ?? "") as MerchantStatus,
    province: String(formData.get("province") ?? ""),
    city: String(formData.get("city") ?? ""),
    district: String(formData.get("district") ?? ""),
    street: String(formData.get("street") ?? ""),
    addressDetail: String(formData.get("addressDetail") ?? ""),
  };
}

/** Create 路径：不传 inviteCodeEnabled — createMerchant() 默认 true */
function createMerchantInput(formData: FormData): Partial<CreateMerchantInput> {
  return baseMerchantInput(formData);
}

/** Update 路径：checkbox 必传（/merchants/[id]/edit 有这个 checkbox） */
function updateMerchantInput(formData: FormData): Partial<UpdateMerchantInput> {
  return {
    ...baseMerchantInput(formData),
    id: String(formData.get("id") ?? "").trim(),
    // checkbox 不勾 = FormData 没 key → false
    // checkbox 勾 = FormData["inviteCodeEnabled"] = "true" → true
    inviteCodeEnabled: formData.get("inviteCodeEnabled") != null,
  };
}

function merchantErrorUrl(
  path: string,
  result: Exclude<MerchantResult, { ok: true }>,
) {
  return `${path}?error=${encodeURIComponent(result.error)}`;
}

export async function createMerchantAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) redirect(merchantErrorUrl("/merchants/new", auth));

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(merchantErrorUrl("/merchants/new", csrf));

  const input = createMerchantInput(formData);
  const result = await createMerchant(input);
  if (!result.ok) redirect(merchantErrorUrl("/merchants/new", result));

  // [任务 4] 取新生成的 inviteCode 写日志
  const { getMerchant } = await import("@/src/lib/merchants");
  const created = await getMerchant(result.id);
  if (created) {
    try {
      await createActivityLog({
        action: "merchant_invite_code_generated",
        targetType: "merchant",
        targetId: result.id,
        message: `商家 ${input.name} 生成邀请码 ${created.inviteCode}`,
        metadata: {
          inviteCode: created.inviteCode,
          inviteCodeEnabled: created.inviteCodeEnabled,
        },
      });
    } catch {
      // 写日志失败不阻塞
    }
  }

  await createActivityLog({
    action: "merchant_created",
    targetType: "merchant",
    targetId: result.id,
    message: `管理员新增商家：${input.name}（${input.phone}）`,
    metadata: input,
  });

  revalidatePath("/merchants");
  redirect(`/merchants?created=${encodeURIComponent(result.id)}`);
}

export async function updateMerchantAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = id ? `/merchants/${id}/edit` : "/merchants";

  const auth = await requireAdmin();
  if (!auth.ok) redirect(merchantErrorUrl(back, auth));

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(merchantErrorUrl(back, csrf));

  // [任务 4] 检测 inviteCodeEnabled 变化 — 用于写 enabled/disabled 日志
  const { getMerchant } = await import("@/src/lib/merchants");
  const before = await getMerchant(id);
  const input = updateMerchantInput(formData);
  const result = await updateMerchant(input);
  if (!result.ok) redirect(merchantErrorUrl(back, result));

  // [任务 4] inviteCodeEnabled 变化时写日志
  if (before && input.inviteCodeEnabled !== undefined) {
    const beforeEnabled = before.inviteCodeEnabled;
    const afterEnabled = input.inviteCodeEnabled;
    if (beforeEnabled !== afterEnabled) {
      try {
        await createActivityLog({
          action: afterEnabled
            ? "merchant_invite_code_enabled"
            : "merchant_invite_code_disabled",
          targetType: "merchant",
          targetId: result.id,
          message: `商家 ${input.name} 邀请码 ${afterEnabled ? "启用" : "禁用"}（${before.inviteCode}）`,
          metadata: {
            inviteCode: before.inviteCode,
            fromEnabled: beforeEnabled,
            toEnabled: afterEnabled,
          },
        });
      } catch {
        // 写日志失败不阻塞
      }
    }
  }

  await createActivityLog({
    action: "merchant_updated",
    targetType: "merchant",
    targetId: result.id,
    message: `管理员更新商家：${input.name}（${input.phone}）`,
    metadata: input,
  });

  revalidatePath("/merchants");
  revalidatePath(`/merchants/${result.id}/edit`);
  redirect(`/merchants?updated=${encodeURIComponent(result.id)}`);
}

// ============================================================
// [任务 2] MerchantArea 绑定相关 action
// ============================================================

/**
 * 商家绑定一个 PlatformArea
 * - FormData 含 merchantId + platformAreaId
 * - 业务校验：PlatformArea 必须 enabled=true（业务层做）
 * - 唯一约束 @@unique 防重复（业务层做）
 */
export async function bindMerchantAreaAction(formData: FormData) {
  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const platformAreaId = String(formData.get("platformAreaId") ?? "").trim();
  const back = `/merchants/${merchantId}/edit`;

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);

  if (!merchantId || !platformAreaId) {
    redirect(`${back}?error=${encodeURIComponent("参数缺失")}`);
  }

  const result = await bindMerchantArea(merchantId, platformAreaId);
  if (!result.ok) {
    redirect(`${back}?error=${encodeURIComponent(result.error)}`);
  }

  await createActivityLog({
    action: "merchant_area_bound",
    targetType: "merchantArea",
    targetId: `${merchantId}-${platformAreaId}`,
    message: `管理员绑定商家 ${merchantId} 到区域 ${platformAreaId}`,
    metadata: { merchantId, platformAreaId },
  });

  revalidatePath(back);
  redirect(`${back}?bound=1`);
}

/**
 * 启用/停用一个 MerchantArea
 * - FormData 含 id + enabled ("true" | "false")
 * - enabled=false 时该区域后续不参与派单
 */
export async function toggleMerchantAreaAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const enabledStr = String(formData.get("enabled") ?? "true");
  const enabled = enabledStr === "true";
  const back = `/merchants/${String(formData.get("merchantId") ?? "").trim()}/edit`;

  const auth = await requireAdmin();
  if (!auth.ok) redirect(`${back}?error=${encodeURIComponent(auth.error)}`);

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(`${back}?error=${encodeURIComponent(csrf.error)}`);

  if (!id) redirect(`${back}?error=${encodeURIComponent("参数缺失")}`);

  const result = await toggleMerchantAreaEnabled(id, enabled);
  if (!result.ok) {
    redirect(`${back}?error=${encodeURIComponent(result.error)}`);
  }

  await createActivityLog({
    action: enabled ? "merchant_area_enabled" : "merchant_area_disabled",
    targetType: "merchantArea",
    targetId: id,
    message: `管理员${enabled ? "启用" : "停用"}了商家区域绑定 ${id}`,
    metadata: { id, enabled },
  });

  revalidatePath(back);
  redirect(`${back}?toggled=1`);
}
