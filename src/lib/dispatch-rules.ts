// 派单规则业务逻辑 — 校验 + DB 写操作。
// app/dispatch-rules/actions.ts（server action）调这里的函数。
//
// 设计：底层 schema 仍然是 ruleJson（DispatchRuleSpec），
// UI 层用业务编码（skuCode / categoryCode）做交互，repo 负责反查 ID 写入 ruleJson。
// 这样不动 dispatch.ts 的核心逻辑。

import { prisma } from "@/src/lib/db";
import { normalizeCode, assertValidCode } from "@/src/lib/codes";
import { parseSkillsString } from "@/src/lib/masters";
import { parseRuleJson } from "@/lib/dispatch";

// ============================================================
// 类型
// ============================================================

export type DispatchRuleField = "name" | "categoryCode" | "skuCode" | "requiredSkills" | "priority" | "enabled";

export interface CreateRuleInput {
  name: string;
  categoryCode: string | null;  // 可空（skuCode 选了就走 SKU 精确，categoryCode 可空）
  skuCode: string | null;       // 可空（categoryCode 选了就走类目兜底）
  requiredSkills: string[];     // 数组
  priority: number;
  enabled: boolean;
}

export interface UpdateRuleInput extends CreateRuleInput {
  id: string;
}

export type DispatchRuleResult =
  | { ok: true; id: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: DispatchRuleField;
    };

// ============================================================
// 校验
// ============================================================

export function validateRuleInput(
  input: Partial<CreateRuleInput>,
): { ok: true; cleaned: CreateRuleInput } | { ok: false; error: string; field: DispatchRuleField } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "请填写规则名称", field: "name" };
  if (name.length > 50) return { ok: false, error: "规则名称不能超过 50 个字符", field: "name" };

  // skuCode / categoryCode 至少有一个（不能两个都空 = 没意义的规则）
  // 也允许两个都填 = 兼容「同一条规则既 SKU 精确又类目兜底」
  // 但需求里没要求双匹配，逻辑上让其中之一存在就够
  const skuCodeRaw = (input.skuCode ?? "").trim();
  const categoryCodeRaw = (input.categoryCode ?? "").trim();
  if (!skuCodeRaw && !categoryCodeRaw) {
    return {
      ok: false,
      error: "SKU 编码和品类编码至少填一个",
      field: "skuCode",
    };
  }

  // 应用层大小写防线：业务编码强制大写
  let skuCode: string | null = null;
  if (skuCodeRaw) {
    const normalized = normalizeCode(skuCodeRaw);
    if (!normalized) return { ok: false, error: "SKU 编码格式不合法", field: "skuCode" };
    try {
      assertValidCode(normalized, "SKU 编码");
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "SKU 编码格式不合法", field: "skuCode" };
    }
    skuCode = normalized;
  }

  let categoryCode: string | null = null;
  if (categoryCodeRaw) {
    const normalized = normalizeCode(categoryCodeRaw);
    if (!normalized) return { ok: false, error: "品类编码格式不合法", field: "categoryCode" };
    try {
      assertValidCode(normalized, "品类编码");
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "品类编码格式不合法", field: "categoryCode" };
    }
    categoryCode = normalized;
  }

  const requiredSkills = parseSkillsString(
    Array.isArray(input.requiredSkills) ? input.requiredSkills.join(",") : "",
  );

  const priority = typeof input.priority === "number" ? input.priority : Number(input.priority);
  if (Number.isNaN(priority)) return { ok: false, error: "优先级必须是数字", field: "priority" };
  if (priority < 0 || priority > 10_000) {
    return { ok: false, error: "优先级必须在 0-10000 之间", field: "priority" };
  }

  const enabled = typeof input.enabled === "boolean" ? input.enabled : Boolean(input.enabled);

  return {
    ok: true,
    cleaned: { name, categoryCode, skuCode, requiredSkills, priority, enabled },
  };
}

// ============================================================
// 列表（页面用 — 关联类目 / SKU 名称）
// ============================================================

export interface RuleListItem {
  id: string;
  name: string;
  skuCode: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  skuName: string | null;
  requiredSkillsStr: string;   // 编辑页回显用
  priority: number;
  enabled: boolean;
  createdAt: string;
}

export async function listRules(): Promise<RuleListItem[]> {
  const rows = await prisma.dispatchRule.findMany({
    orderBy: [{ enabled: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      ruleJson: true,
      priority: true,
      enabled: true,
      createdAt: true,
    },
  });

  // 一次查所有 SKU + 类目做映射（避免 N+1）
  const [skus, categories] = await Promise.all([
    prisma.serviceSku.findMany({ select: { id: true, skuCode: true, name: true } }),
    prisma.serviceCategory.findMany({ select: { id: true, categoryCode: true, name: true } }),
  ]);
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  // 用 lib/dispatch.ts 的 parseRuleJson（zod 校验）替代手写 JSON.parse
  // 坏数据 → spec=null → 这条规则从列表里过滤掉（编辑页 listRules 也用这个）
  return rows.flatMap((r) => {
    const spec = parseRuleJson(r.ruleJson);
    if (spec === null) return []; // 坏数据：跳过
    const sku = spec.match.skuId ? skuById.get(spec.match.skuId) : undefined;
    const cat = spec.match.categoryId ? catById.get(spec.match.categoryId) : undefined;
    return [{
      id: r.id,
      name: r.name,
      skuCode: sku?.skuCode ?? null,
      categoryCode: cat?.categoryCode ?? null,
      categoryName: cat?.name ?? null,
      skuName: sku?.name ?? null,
      requiredSkillsStr: spec.requiredSkills.join(", "),
      priority: r.priority,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
    }];
  });
}

/** 编辑页用 — 拿单条 + 原始 ruleJson 字段 */
export async function getRuleForEdit(id: string): Promise<{
  id: string;
  name: string;
  skuCode: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  skuName: string | null;
  requiredSkillsStr: string;
  priority: number;
  enabled: boolean;
} | null> {
  const r = await prisma.dispatchRule.findUnique({ where: { id } });
  if (!r) return null;

  // 坏数据：parseRuleJson 返回 null → 编辑页也返回 null（让 notFound 触发）
  const spec = parseRuleJson(r.ruleJson);
  if (spec === null) return null;

  const [sku, cat] = await Promise.all([
    spec.match.skuId
      ? prisma.serviceSku.findUnique({ where: { id: spec.match.skuId }, select: { skuCode: true, name: true } })
      : Promise.resolve(null),
    spec.match.categoryId
      ? prisma.serviceCategory.findUnique({ where: { id: spec.match.categoryId }, select: { categoryCode: true, name: true } })
      : Promise.resolve(null),
  ]);

  return {
    id: r.id,
    name: r.name,
    skuCode: sku?.skuCode ?? null,
    categoryCode: cat?.categoryCode ?? null,
    categoryName: cat?.name ?? null,
    skuName: sku?.name ?? null,
    requiredSkillsStr: spec.requiredSkills.join(", "),
    priority: r.priority,
    enabled: r.enabled,
  };
}

// ============================================================
// 写操作
// ============================================================

/**
 * 把「业务编码」转换成「ruleJson」：
 * - skuCode 反查 SKU 拿 ID
 * - categoryCode 反查类目拿 ID
 * - 都没找到 / 反查失败 → validation 错误
 */
async function buildRuleJson(input: CreateRuleInput): Promise<
  { ok: true; ruleJson: string } | { ok: false; error: string; field: "skuCode" | "categoryCode" }
> {
  const match: { skuId?: string; categoryId?: string } = {};

  if (input.skuCode) {
    const sku = await prisma.serviceSku.findUnique({
      where: { skuCode: input.skuCode },
      select: { id: true },
    });
    if (!sku) {
      return { ok: false, error: `SKU 编码不存在：${input.skuCode}`, field: "skuCode" };
    }
    match.skuId = sku.id;
  }

  if (input.categoryCode) {
    const cat = await prisma.serviceCategory.findUnique({
      where: { categoryCode: input.categoryCode },
      select: { id: true },
    });
    if (!cat) {
      return { ok: false, error: `品类编码不存在：${input.categoryCode}`, field: "categoryCode" };
    }
    match.categoryId = cat.id;
  }

  return {
    ok: true,
    ruleJson: JSON.stringify({ match, requiredSkills: input.requiredSkills }),
  };
}

export async function createRule(
  rawInput: Partial<CreateRuleInput>,
): Promise<DispatchRuleResult> {
  const validated = validateRuleInput(rawInput);
  if (!validated.ok) {
    return { ok: false, category: "validation", error: validated.error, field: validated.field };
  }
  const c = validated.cleaned;

  // 业务编码 → 内部 ID 写入 ruleJson
  const ruleJsonResult = await buildRuleJson(c);
  if (!ruleJsonResult.ok) {
    return { ok: false, category: "validation", error: ruleJsonResult.error, field: ruleJsonResult.field };
  }

  try {
    const row = await prisma.dispatchRule.create({
      data: {
        name: c.name,
        priority: c.priority,
        enabled: c.enabled,
        ruleJson: ruleJsonResult.ruleJson,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "创建规则失败",
    };
  }
}

export async function updateRule(
  rawInput: Partial<UpdateRuleInput>,
): Promise<DispatchRuleResult> {
  const id = (rawInput.id ?? "").trim();
  if (!id) {
    return { ok: false, category: "validation", error: "缺少规则 id", field: "name" };
  }

  const exists = await prisma.dispatchRule.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return { ok: false, category: "validation", error: `规则 ${id} 不存在`, field: "name" };
  }

  const validated = validateRuleInput(rawInput);
  if (!validated.ok) {
    return { ok: false, category: "validation", error: validated.error, field: validated.field };
  }
  const c = validated.cleaned;

  const ruleJsonResult = await buildRuleJson(c);
  if (!ruleJsonResult.ok) {
    return { ok: false, category: "validation", error: ruleJsonResult.error, field: ruleJsonResult.field };
  }

  try {
    await prisma.dispatchRule.update({
      where: { id },
      data: {
        name: c.name,
        priority: c.priority,
        enabled: c.enabled,
        ruleJson: ruleJsonResult.ruleJson,
      },
    });
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "更新规则失败",
    };
  }
}

/**
 * 切换规则的 enabled 状态 — 列表行「启用/停用」按钮专用。
 * 不需要校验 name / skuCode 等（这些不参与 enabled 切换）。
 * 返回新的 enabled 状态，让 UI 可以确认写库成功。
 */
export type ToggleRuleResult =
  | { ok: true; id: string; enabled: boolean }
  | { ok: false; category: "validation" | "system"; error: string };

export async function toggleRuleEnabled(id: string): Promise<ToggleRuleResult> {
  if (!id) {
    return { ok: false, category: "validation", error: "缺少规则 id" };
  }
  const row = await prisma.dispatchRule.findUnique({ where: { id }, select: { id: true, enabled: true } });
  if (!row) {
    return { ok: false, category: "validation", error: `规则 ${id} 不存在` };
  }
  const next = !row.enabled;
  try {
    await prisma.dispatchRule.update({
      where: { id },
      data: { enabled: next },
    });
    return { ok: true, id, enabled: next };
  } catch (e) {
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "切换启用状态失败",
    };
  }
}