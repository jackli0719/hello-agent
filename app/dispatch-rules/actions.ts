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
import { createActivityLog } from "@/src/lib/activity-log";
import { requireAdmin, requireCsrf } from "@/src/lib/auth-helpers";
import { verifyCsrfOrigin } from "@/src/lib/csrf";

export type DispatchRuleActionResult =
  Exclude<DispatchRuleResult, { ok: true }> | { ok: true; id: string };

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
    requiredSkills: parseSkillsString(
      String(formData.get("requiredSkills") ?? ""),
    ),
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
    requiredSkills: parseSkillsString(
      String(formData.get("requiredSkills") ?? ""),
    ),
    priority: priorityRaw === "" ? NaN : Number(priorityRaw),
    enabled: asBool(formData.get("enabled")),
  };
}

export async function createRuleAction(
  formData: FormData,
): Promise<DispatchRuleActionResult | null> {
  // [v0.9.4] P0 鉴权收口：admin + csrf
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    return { ok: false, category: csrf.category, error: csrf.error };
  }

  const input = formDataToCreateRule(formData);
  const result = await createRule(input);
  if (!result.ok) return result;

  // 写操作日志
  await createActivityLog({
    action: "dispatch_rule_created",
    targetType: "dispatchRule",
    targetId: result.id,
    message: `管理员新增派单规则：${input.name}（priority=${input.priority}）`,
    metadata: {
      skuCode: input.skuCode,
      categoryCode: input.categoryCode,
      requiredSkills: input.requiredSkills,
    },
  });

  try {
    revalidatePath("/dispatch-rules");
    revalidatePath("/orders"); // 规则影响 /orders 的推荐
  } catch {
    // 单测环境无 Next runtime
  }
  redirect(`/dispatch-rules?created=${encodeURIComponent(result.id)}`);
}

export async function updateRuleAction(
  formData: FormData,
): Promise<DispatchRuleActionResult | null> {
  // [v0.9.4] P0 鉴权收口：admin + csrf
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    return { ok: false, category: csrf.category, error: csrf.error };
  }

  const input = formDataToUpdateRule(formData);
  const result = await updateRule(input);
  if (!result.ok) return result;

  // 写操作日志
  await createActivityLog({
    action: "dispatch_rule_updated",
    targetType: "dispatchRule",
    targetId: result.id,
    message: `管理员更新派单规则：${input.name}（priority=${input.priority}）`,
    metadata: {
      skuCode: input.skuCode,
      categoryCode: input.categoryCode,
      requiredSkills: input.requiredSkills,
    },
  });

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
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.9.7] P0 CSRF：Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }

  const result = await toggleRuleEnabled(id);
  if (result.ok) {
    // 写操作日志
    await createActivityLog({
      action: "dispatch_rule_toggled",
      targetType: "dispatchRule",
      targetId: id,
      message: `管理员${result.enabled ? "启用" : "停用"}了派单规则`,
      metadata: { enabled: result.enabled },
    });
    try {
      revalidatePath("/dispatch-rules");
      revalidatePath("/orders"); // 规则 enabled 影响 /orders 推荐
    } catch {
      // 单测环境无 Next runtime
    }
  }
  return result;
}
