import type { Technician } from "./types";
import { z } from "zod";

// 派单匹配 — 纯函数，方便单测和复用。
// 不在这里做 I/O、不在这里改状态，只回答一个问题：
// 「对于这一单订单，按当前的规则和师傅池，能推荐哪些师傅？命中的哪条规则？」

/** 派单规则的结构化内容（从 DispatchRule.ruleJson 解析出来） */
export interface DispatchRuleSpec {
  match: {
    skuId?: string; // 精确 SKU 匹配（可选）
    categoryId?: string; // 类目兜底匹配（可选）
  };
  requiredSkills: string[]; // 师傅技能必须覆盖这个集合
}

/** 库里的派单规则（页面用 rule.name 展示） */
export interface DispatchRuleRow {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  spec: DispatchRuleSpec;
}

/** 推荐结果 — 给 /orders 页面展示用 */
export interface RecommendationResult {
  rule: DispatchRuleRow | null; // 命中的规则（null = 没有规则覆盖）
  candidates: Technician[]; // 按 rating 降序排好的候选师傅
  reason: string; // 一句话说明（为什么有 / 为什么没有）
}

/** 输入：订单的 SKU 和类目，加上规则库 + 师傅池 */
export interface RecommendArgs {
  order: {
    skuId: string | null;
    categoryId: string | null;
  };
  rules: DispatchRuleRow[];
  masters: Technician[];
}

/**
 * 派单推荐：SKU 精确优先 → 类目兜底 → 全无规则就返回空。
 *
 * 命中规则的优先级：
 * 1. enabled = true
 * 2. match.skuId === order.skuId（精确 SKU）
 * 3. match.categoryId === order.categoryId（类目兜底）
 * 4. 同类型多条规则按 priority 降序，再按 id 稳定排序
 *
 * 候选筛选：
 * - status === "available"
 * - skills 是 requiredSkills 的超集（覆盖所有 requiredSkills）
 * - rating 降序排
 *
 * @returns 命中的规则 + 候选列表 + 一句话理由
 */
export function recommendMastersForOrder(
  args: RecommendArgs,
): RecommendationResult {
  const { order, rules, masters } = args;

  // 1. 找命中的规则 — SKU 精确优先
  const enabledRules = rules.filter((r) => r.enabled);
  const skuRules = enabledRules.filter(
    (r) => r.spec.match.skuId && r.spec.match.skuId === order.skuId,
  );
  const categoryRules = enabledRules.filter(
    (r) =>
      r.spec.match.categoryId && r.spec.match.categoryId === order.categoryId,
  );

  let rule: DispatchRuleRow | null = null;
  if (skuRules.length > 0) {
    rule = pickTopRule(skuRules);
  } else if (categoryRules.length > 0) {
    rule = pickTopRule(categoryRules);
  }

  // 2. 没有规则覆盖
  if (!rule) {
    return {
      rule: null,
      candidates: [],
      reason: "没有匹配的派单规则，请人工指派",
    };
  }

  // 3. 筛候选：available + 技能覆盖 requiredSkills
  const required = rule.spec.requiredSkills;
  const candidates = masters
    .filter((m) => m.status === "available")
    .filter((m) => coversAll(m.skills, required))
    .sort((a, b) => b.rating - a.rating);

  if (candidates.length === 0) {
    return {
      rule,
      candidates: [],
      reason:
        required.length === 0
          ? `规则「${rule.name}」不需要特定技能，但没有空闲师傅`
          : `规则「${rule.name}」需要技能 [${required.join("、")}]，当前没有空闲师傅掌握`,
    };
  }

  return {
    rule,
    candidates,
    reason: `命中规则「${rule.name}」（${rule.id}），推荐 ${candidates[0].name}（评分 ${candidates[0].rating}）`,
  };
}

// 工具：skills 是否覆盖 requiredSkills（every 都包含）
function coversAll(skills: string[], required: string[]): boolean {
  if (required.length === 0) return true; // 不要求技能 = 任何人都行
  const set = new Set(skills);
  return required.every((s) => set.has(s));
}

// 工具：从多条同类型规则里挑优先级最高的，id 字典序兜底（稳定）
function pickTopRule(rules: DispatchRuleRow[]): DispatchRuleRow {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Zod schema — 描述 ruleJson 的合法结构。
 * - match 是 optional 对象（缺则空对象），skuId/categoryId 都 optional
 * - requiredSkills 是 string[]；非 string 元素被过滤（preprocess）
 * - 用 z 替代手写 if-else：编译期类型 + 运行期强校验
 * - 设计：宽松解析（filter 掉坏元素，不直接 reject）— 与业务"宽松输入"对齐
 */
export const dispatchRuleSpecSchema = z
  .object({
    match: z
      .object({
        skuId: z.string().optional(),
        categoryId: z.string().optional(),
      })
      .optional()
      .transform((v) => v ?? {}),
    requiredSkills: z
      .preprocess(
        (v) =>
          Array.isArray(v)
            ? v.filter((s): s is string => typeof s === "string")
            : [],
        z.array(z.string()),
      )
      .default([]),
  })
  .transform((v) => ({ match: v.match, requiredSkills: v.requiredSkills }));

/**
 * 解析 DispatchRule.ruleJson（JSON 字符串）→ DispatchRuleSpec
 *
 * 设计：listRules/getRuleForEdit **坏数据不能静默** —— 解析失败时返回 null
 * + 在服务端控制台 warn，调用方有义务看到 null 决定怎么处理。
 * 之前用 throw 会导致上游 catch 静默吞掉，UI 列表显示空但没有线索。
 */
export function parseRuleJson(json: string): DispatchRuleSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    console.warn(
      `[dispatch] ruleJson 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
  const result = dispatchRuleSpecSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[dispatch] ruleJson 校验失败: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
    return null;
  }
  return result.data;
}
