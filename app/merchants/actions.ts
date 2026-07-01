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

function merchantInput(formData: FormData): Partial<CreateMerchantInput> {
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

  const input = merchantInput(formData);
  const result = await createMerchant(input);
  if (!result.ok) redirect(merchantErrorUrl("/merchants/new", result));

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

  const input: Partial<UpdateMerchantInput> = {
    id,
    ...merchantInput(formData),
  };
  const result = await updateMerchant(input);
  if (!result.ok) redirect(merchantErrorUrl(back, result));

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
