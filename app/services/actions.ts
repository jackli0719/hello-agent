"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCategory,
  createSku,
  updateSku,
  type CreateCategoryInput,
  type CreateSkuInput,
  type ServiceResult,
  type UpdateSkuInput,
} from "@/src/lib/services";
import { parseSkillsString } from "@/src/lib/masters";
import { createActivityLog } from "@/src/lib/activity-log";

export type ServiceActionResult =
  Exclude<ServiceResult, { ok: true }> | { ok: true; id: string };

// checkbox on → boolean true；未选 → false
function asBool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

function formDataToCategory(formData: FormData): Partial<CreateCategoryInput> {
  return {
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
    enabled: asBool(formData.get("enabled")),
  };
}

function formDataToSku(formData: FormData): Partial<CreateSkuInput> {
  const basePriceRaw = String(formData.get("basePrice") ?? "").trim();
  return {
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
    categoryCode: String(formData.get("categoryCode") ?? "").trim(),
    basePrice: basePriceRaw === "" ? NaN : Number(basePriceRaw),
    enabled: asBool(formData.get("enabled")),
    // requiredSkills 是逗号分隔字符串，调用 parseSkillsString 解析
    requiredSkills: parseSkillsString(
      String(formData.get("requiredSkills") ?? ""),
    ),
  };
}

function formDataToUpdateSku(formData: FormData): Partial<UpdateSkuInput> {
  const basePriceRaw = String(formData.get("basePrice") ?? "").trim();
  return {
    id: String(formData.get("id") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    basePrice: basePriceRaw === "" ? NaN : Number(basePriceRaw),
    enabled: asBool(formData.get("enabled")),
    requiredSkills: parseSkillsString(
      String(formData.get("requiredSkills") ?? ""),
    ),
  };
}

export async function createCategoryAction(
  formData: FormData,
): Promise<ServiceActionResult | null> {
  const result = await createCategory(formDataToCategory(formData));
  if (!result.ok) return result;

  try {
    revalidatePath("/services");
    revalidatePath("/orders"); // 新增品类可能影响新建订单的下拉
    revalidatePath("/orders/new");
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/services?category=${encodeURIComponent(result.id)}`);
}

export async function createSkuAction(
  formData: FormData,
): Promise<ServiceActionResult | null> {
  const input = formDataToSku(formData);
  const result = await createSku(input);
  if (!result.ok) return result;

  // 写操作日志
  await createActivityLog({
    action: "service_sku_created",
    targetType: "serviceSku",
    targetId: result.id,
    message: `管理员新增服务 SKU：${input.name}（${input.code}）`,
    metadata: {
      categoryCode: input.categoryCode,
      basePrice: input.basePrice,
      requiredSkills: input.requiredSkills,
    },
  });

  try {
    revalidatePath("/services");
    revalidatePath("/orders");
    revalidatePath("/orders/new");
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/services?sku=${encodeURIComponent(result.id)}`);
}

export async function updateSkuAction(
  formData: FormData,
): Promise<ServiceActionResult | null> {
  const input = formDataToUpdateSku(formData);
  const result = await updateSku(input);
  if (!result.ok) return result;

  // 写操作日志
  await createActivityLog({
    action: "service_sku_updated",
    targetType: "serviceSku",
    targetId: result.id,
    message: `管理员更新服务 SKU：${input.name}`,
    metadata: {
      basePrice: input.basePrice,
      requiredSkills: input.requiredSkills,
    },
  });

  try {
    revalidatePath("/services");
    revalidatePath(`/services/skus/${result.id}/edit`);
    revalidatePath("/orders");
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/services?updated=${encodeURIComponent(result.id)}`);
}
