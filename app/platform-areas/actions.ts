"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import {
  createPlatformArea,
  updatePlatformArea,
  type CreatePlatformAreaInput,
  type PlatformAreaResult,
  type UpdatePlatformAreaInput,
} from "@/src/lib/areas";

function asBool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

function areaInput(formData: FormData): Partial<CreatePlatformAreaInput> {
  return {
    province: String(formData.get("province") ?? ""),
    city: String(formData.get("city") ?? ""),
    district: String(formData.get("district") ?? ""),
    street: String(formData.get("street") ?? ""),
    enabled: asBool(formData.get("enabled")),
  };
}

function areaErrorUrl(
  path: string,
  result: Exclude<PlatformAreaResult, { ok: true }>,
) {
  return `${path}?error=${encodeURIComponent(result.error)}`;
}

export async function createPlatformAreaAction(formData: FormData) {
  const auth = await requireAdmin();
  if (!auth.ok) redirect(areaErrorUrl("/platform-areas/new", auth));

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(areaErrorUrl("/platform-areas/new", csrf));

  const input = areaInput(formData);
  const result = await createPlatformArea(input);
  if (!result.ok) redirect(areaErrorUrl("/platform-areas/new", result));

  await createActivityLog({
    action: "platform_area_created",
    targetType: "platformArea",
    targetId: result.id,
    message: `管理员新增平台合作区域：${input.province}/${input.city}/${input.district}/${input.street}`,
    metadata: input,
  });

  revalidatePath("/platform-areas");
  redirect(`/platform-areas?created=${encodeURIComponent(result.id)}`);
}

export async function updatePlatformAreaAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const back = id ? `/platform-areas/${id}/edit` : "/platform-areas";

  const auth = await requireAdmin();
  if (!auth.ok) redirect(areaErrorUrl(back, auth));

  const csrf = await requireCsrf(formData);
  if (!csrf.ok) redirect(areaErrorUrl(back, csrf));

  const input: Partial<UpdatePlatformAreaInput> = {
    id,
    ...areaInput(formData),
  };
  const result = await updatePlatformArea(input);
  if (!result.ok) redirect(areaErrorUrl(back, result));

  await createActivityLog({
    action: "platform_area_updated",
    targetType: "platformArea",
    targetId: result.id,
    message: `管理员更新平台合作区域：${input.province}/${input.city}/${input.district}/${input.street}`,
    metadata: input,
  });

  revalidatePath("/platform-areas");
  revalidatePath(`/platform-areas/${result.id}/edit`);
  redirect(`/platform-areas?updated=${encodeURIComponent(result.id)}`);
}
