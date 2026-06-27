"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createRule,
  toggleRuleEnabled,
  updateRule,
  type CreateRuleInput,
  type DispatchRuleResult,
  type ToggleRuleResult,
  type UpdateRuleInput,
} from "@/src/lib/dispatch-rules";
import { parseSkillsString } from "@/src/lib/masters";

export type DispatchRuleActionResult = Exclude<DispatchRuleResult, { ok: true }> | { ok: true; id: string };

// 列表行 toggle action 返回
export type ToggleEnabledActionResult = ToggleRuleResult;

function asBool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

function formDataToCreateRule(formData: FormData): Partial<CreateRuleInput> {
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  return {
    name: String(formData.get("name") ?? "").trim(),
    // 业务编码：trim 后空字符串 → undefined（让 validateRuleInput 判断「至少一个」）
    skuCode: String(formData.get("skuCode") ?? "").trim() || null,
    categoryCode: String(formData.get("categoryCode") ?? "").trim() || null,
    requiredSkills: parseSkillsString(String(formData.get("requiredSkills") ?? "")),
    priority: priorityRaw === "" ? NaN : Number(priorityRaw),
    enabled: asBool(formData.get("enabled")),
  };
}

function formDataToUpdateRule(formData: FormData): Partial<UpdateRuleInput> {
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  return {
    id: String(formData.get("id") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    skuCode: String(formData.get("skuCode") ?? "").trim() || null,
    categoryCode: String(formData.get("categoryCode") ?? "").trim() || null,
    requiredSkills: parseSkillsString(String(formData.get("requiredSkills") ?? "")),
    priority: priorityRaw === "" ? NaN : Number(priorityRaw),
    enabled: asBool(formData.get("enabled")),
  };
}

export async function createRuleAction(formData: FormData): Promise<DispatchRuleActionResult | null> {
  const result = await createRule(formDataToCreateRule(formData));
  if (!result.ok) return result;

  try {
    revalidatePath("/dispatch-rules");
    revalidatePath("/orders"); // 规则影响 /orders 的推荐
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/dispatch-rules?created=${encodeURIComponent(result.id)}`);
}

export async function updateRuleAction(formData: FormData): Promise<DispatchRuleActionResult | null> {
  const result = await updateRule(formDataToUpdateRule(formData));
  if (!result.ok) return result;

  try {
    revalidatePath("/dispatch-rules");
    revalidatePath(`/dispatch-rules/${result.id}/edit`);
    revalidatePath("/orders");
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/dispatch-rules?updated=${encodeURIComponent(result.id)}`);
}

/**
 * 切换规则 enabled — 列表行「启用/停用」按钮专用。
 * 成功 → revalidatePath 让其他页面（/orders 推荐结果）也拿到新状态。
 */
export async function toggleRuleEnabledAction(
  id: string,
): Promise<ToggleEnabledActionResult> {
  const result = await toggleRuleEnabled(id);
  if (result.ok) {
    try {
      revalidatePath("/dispatch-rules");
      revalidatePath("/orders"); // 规则 enabled 影响 /orders 推荐
    } catch {
      // 单测环境无 Next runtime
    }
  }
  return result;
}