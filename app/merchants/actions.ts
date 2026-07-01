"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  createMerchant,
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
