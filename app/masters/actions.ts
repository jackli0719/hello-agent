"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import {
  createMaster,
  updateMaster,
  type CreateMasterInput,
  type CreateMasterResult,
  type MasterField,
  parseSkillsString,
} from "@/src/lib/masters";
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";

// UI 错误类型（给客户端组件展示用）
export type MasterActionResult =
  | { ok: true; masterId: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: MasterField;
    };

/**
 * 把 FormData → CreateMasterInput：
 * - skills 字段是逗号分隔字符串，调用 parseSkillsString 解析成数组
 * - 注意：available / status 不在这里处理 — 由系统自动管理
 */
function formDataToInput(formData: FormData): Partial<CreateMasterInput> {
  const ratingRaw = String(formData.get("rating") ?? "").trim();
  return {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    skills: parseSkillsString(String(formData.get("skills") ?? "")),
    rating: ratingRaw === "" ? NaN : Number(ratingRaw),
    serviceArea: String(formData.get("serviceArea") ?? ""),
    // [任务 2] 商家必填 — UI 必传
    merchantId: String(formData.get("merchantId") ?? "").trim(),
  };
}

/**
 * 新建师傅 server action。
 */
export async function createMasterAction(
  formData: FormData,
): Promise<MasterActionResult | null> {
  // [v0.9.4] P0 鉴权收口：admin + csrf
  const auth = await requireAdmin();
  if (!auth.ok) {
    return {
      ok: false,
      category: auth.category,
      error: auth.error,
      field: "name",
    };
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    return { ok: false, category: csrf.category, error: csrf.error };
  }

  const input = formDataToInput(formData);
  const result = await createMaster(input);
  if (!result.ok) return result;

  // 写操作日志
  await createActivityLog({
    action: "master_created",
    targetType: "master",
    targetId: result.masterId,
    message: `管理员新增师傅 ${input.name}（${input.phone}）`,
    metadata: { skills: input.skills, serviceArea: input.serviceArea },
  });
  // [任务 2] 师傅归属商家绑定
  if (input.merchantId) {
    await createActivityLog({
      action: "master_bound_to_merchant",
      targetType: "master",
      targetId: result.masterId,
      message: `师傅 ${input.name} 绑定到商家 ${input.merchantId}`,
      metadata: { merchantId: input.merchantId },
    });
  }

  try {
    revalidatePath("/masters");
    revalidatePath("/orders"); // 推荐结果可能受新师傅影响
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/masters?created=${encodeURIComponent(result.masterId)}`);
}

/**
 * 编辑师傅 server action。
 */
export async function updateMasterAction(
  formData: FormData,
): Promise<MasterActionResult | null> {
  // [v0.9.4] P0 鉴权收口：admin + csrf
  const auth = await requireAdmin();
  if (!auth.ok) {
    return {
      ok: false,
      category: auth.category,
      error: auth.error,
      field: "name",
    };
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    return { ok: false, category: csrf.category, error: csrf.error };
  }

  const input = formDataToInput(formData);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return {
      ok: false,
      category: "validation",
      error: "缺少师傅 id",
      field: "name",
    };
  }
  const previousMerchant = await prisma.master.findUnique({
    where: { id },
    select: { merchantId: true },
  });
  const result = await updateMaster({ ...input, id });
  if (!result.ok) return result;

  // [任务 2] 检测商家变化 — 改换所属商家才写日志
  const merchantChanged = previousMerchant?.merchantId !== input.merchantId;

  // 写操作日志
  await createActivityLog({
    action: "master_updated",
    targetType: "master",
    targetId: id,
    message: `管理员更新师傅 ${input.name}（${input.phone}）`,
    metadata: { skills: input.skills, serviceArea: input.serviceArea },
  });
  if (merchantChanged && input.merchantId) {
    await createActivityLog({
      action: "master_merchant_changed",
      targetType: "master",
      targetId: id,
      message: `师傅 ${input.name} 改换所属商家 ${input.merchantId}（原 ${previousMerchant?.merchantId ?? "无"}）`,
      metadata: {
        fromMerchantId: previousMerchant?.merchantId,
        toMerchantId: input.merchantId,
      },
    });
  }

  try {
    revalidatePath("/masters");
    revalidatePath(`/masters/${id}/edit`);
    revalidatePath("/orders"); // 推荐结果可能受影响
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/masters?updated=${encodeURIComponent(id)}`);
}
