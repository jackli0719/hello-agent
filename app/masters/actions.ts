"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createMaster,
  updateMaster,
  type CreateMasterInput,
  type CreateMasterResult,
  type MasterField,
  parseSkillsString,
} from "@/src/lib/masters";

// UI 错误类型（给客户端组件展示用）
export type MasterActionResult =
  | { ok: true; masterId: string }
  | { ok: false; category: "validation" | "system"; error: string; field?: MasterField };

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
  };
}

/**
 * 新建师傅 server action。
 */
export async function createMasterAction(formData: FormData): Promise<MasterActionResult | null> {
  const input = formDataToInput(formData);
  const result = await createMaster(input);
  if (!result.ok) return result;

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
export async function updateMasterAction(formData: FormData): Promise<MasterActionResult | null> {
  const input = formDataToInput(formData);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return { ok: false, category: "validation", error: "缺少师傅 id", field: "name" };
  }
  const result = await updateMaster({ ...input, id });
  if (!result.ok) return result;

  try {
    revalidatePath("/masters");
    revalidatePath(`/masters/${id}/edit`);
    revalidatePath("/orders"); // 推荐结果可能受影响
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/masters?updated=${encodeURIComponent(id)}`);
}