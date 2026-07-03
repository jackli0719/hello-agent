import type { Technician } from "./types";
import { z } from "zod";
import {
  defaultAreaMatcher,
  type AreaMatcher,
} from "@/src/lib/area-matcher";

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
  // [任务 3] 命中的平台合作区域（成功推荐时填，失败时也可能填）
  matchedArea?: PlatformAreaRow | null;
  // [任务 3] 推荐失败原因 code — 调用方按 code 写 activity log
  // 不写 enum 避免 dispatch.ts 引入硬编码，调用方按 code 字符串映射
  failureCode?:
    | "area_no_platform_area" // 区域没匹配到 PlatformArea
    | "area_no_merchant" // 区域有但无 active 商家覆盖
    | "area_no_master" // 区域有商家覆盖但无师傅
    | "no_rule" // 无 SKU/类目规则
    | "no_skill_matched" // 有规则但无技能匹配
    | "merchant_inactive" // 商家覆盖区域但全部 inactive（理论上 db 过滤后不会到这里，留作防御）
    | "distance_out_of_range"; // [任务 4-0] 距离/经纬度超出师傅服务范围（演示期永远不触发）
}

export interface PlatformAreaRow {
  id: string;
  province: string;
  city: string;
  district: string;
  street: string;
  enabled: boolean;
}

export interface MerchantAreaRow {
  merchantId: string;
  platformAreaId: string;
  enabled: boolean;
}

/** 输入：订单的 SKU 和类目，加上规则库 + 师傅池 */
export interface RecommendArgs {
  order: {
    skuId: string | null;
    categoryId: string | null;
    // [任务 3] 4 级地址：精确匹配 PlatformArea 必传 4 字段
    // 旧订单（无 4 字段）只传 address → 走模糊 fallback 路径
    province?: string | null;
    city?: string | null;
    district?: string | null;
    street?: string | null;
    addressDetail?: string | null;
    address?: string | null;
  };
  rules: DispatchRuleRow[];
  masters: Technician[];
  platformAreas?: PlatformAreaRow[];
  merchantAreas?: MerchantAreaRow[];
  // [任务 4-0] 区域匹配器（地图 API 预留位）；默认 defaultAreaMatcher 永远返 true
  areaMatcher?: AreaMatcher;
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
  const { order, rules } = args;

  let masters = args.masters;
  let matchedArea: PlatformAreaRow | null = null;
  if (args.platformAreas && args.merchantAreas) {
    const areaResult = filterMastersByArea({
      order,
      masters,
      platformAreas: args.platformAreas,
      merchantAreas: args.merchantAreas,
      areaMatcher: args.areaMatcher,
    });
    if (!areaResult.ok) {
      return {
        rule: null,
        candidates: [],
        reason: areaResult.reason,
        failureCode: areaResult.failureCode,
        matchedArea: null,
      };
    }
    masters = areaResult.masters;
    matchedArea = areaResult.matchedArea ?? null;
  }

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
      failureCode: "no_rule",
      matchedArea,
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
      failureCode: "no_skill_matched",
      matchedArea,
    };
  }

  return {
    rule,
    candidates,
    reason: `命中规则「${rule.name}」（${rule.id}），推荐 ${candidates[0].name}（评分 ${candidates[0].rating}）`,
    matchedArea,
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

function filterMastersByArea(args: {
  order: RecommendArgs["order"];
  masters: Technician[];
  platformAreas: PlatformAreaRow[];
  merchantAreas: MerchantAreaRow[];
  // [任务 4-0] 距离匹配器 — 默认 defaultAreaMatcher
  areaMatcher?: AreaMatcher;
}):
  | {
      ok: true;
      masters: Technician[];
      matchedArea?: PlatformAreaRow;
    }
  | {
      ok: false;
      reason: string;
      failureCode:
        | "area_no_platform_area"
        | "area_no_merchant"
        | "area_no_master"
        | "distance_out_of_range";
    } {
  const matchedArea = pickPlatformAreaForOrder(args.order, args.platformAreas);
  if (!matchedArea) {
    return {
      ok: false,
      reason: "当前区域暂未开放平台合作服务",
      failureCode: "area_no_platform_area",
    };
  }

  const merchantIds = new Set(
    args.merchantAreas
      .filter((ma) => ma.enabled && ma.platformAreaId === matchedArea.id)
      .map((ma) => ma.merchantId),
  );
  if (merchantIds.size === 0) {
    return {
      ok: false,
      reason: `平台区域「${formatPlatformArea(matchedArea)}」暂无启用商家覆盖`,
      failureCode: "area_no_merchant",
    };
  }

  const masters = args.masters.filter(
    (m) => m.merchantId !== undefined && merchantIds.has(m.merchantId),
  );
  if (masters.length === 0) {
    return {
      ok: false,
      reason: `平台区域「${formatPlatformArea(matchedArea)}」的商家下暂无师傅`,
      failureCode: "area_no_master",
    };
  }

  // [任务 4-0] 距离/经纬度校验 — 演示期 always true（接口位预留）
  // 后续接腾讯/高德 API 时：替换 args.areaMatcher?.distanceCheck 实现即可
  const matcher = args.areaMatcher ?? defaultAreaMatcher;
  const orderArea = {
    province: args.order.province ?? "",
    city: args.order.city ?? "",
    district: args.order.district ?? "",
    street: args.order.street ?? "",
  };
  const outOfRange = masters.filter(
    (m) =>
      !matcher.distanceCheck(orderArea, {
        masterId: m.id,
        // [任务 4-0] 上方已过滤掉 merchantId === undefined 的师傅（line 246）
        merchantId: m.merchantId!,
      }),
  );
  if (outOfRange.length === masters.length) {
    // 全部师傅都不在距离范围内（演示期永远不触发）
    return {
      ok: false,
      reason: `平台区域「${formatPlatformArea(matchedArea)}」内所有师傅距离均超出服务范围`,
      failureCode: "distance_out_of_range",
    };
  }

  return { ok: true, masters, matchedArea };
}

/**
 * [任务 3] 匹配 PlatformArea：
 * - 优先 4 级字段精确匹配（订单有 province/city/district/street 就走精确）
 * - 4 级任一为空时退到旧 address 模糊匹配（兼容历史订单）
 */
function pickPlatformAreaForOrder(
  order: RecommendArgs["order"],
  platformAreas: PlatformAreaRow[],
): PlatformAreaRow | null {
  const hasAllFour =
    !!order.province && !!order.city && !!order.district && !!order.street;
  if (hasAllFour) {
    return (
      platformAreas
        .filter((area) => area.enabled)
        .find(
          (area) =>
            area.province === order.province &&
            area.city === order.city &&
            area.district === order.district &&
            area.street === order.street,
        ) ?? null
    );
  }
  // fallback: address 模糊匹配（兼容旧订单）
  return pickPlatformAreaForAddress(order.address ?? "", platformAreas);
}

function pickPlatformAreaForAddress(
  address: string,
  platformAreas: PlatformAreaRow[],
): PlatformAreaRow | null {
  if (!address) return null;
  const normalizedAddress = normalizeAreaText(address);
  const matches = platformAreas
    .filter((area) => area.enabled)
    .filter((area) =>
      [area.province, area.city, area.district, area.street].every((part) =>
        normalizedAddress.includes(normalizeAreaText(part)),
      ),
    );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    const lenA = areaTextLength(a);
    const lenB = areaTextLength(b);
    if (lenB !== lenA) return lenB - lenA;
    return a.id.localeCompare(b.id);
  })[0];
}

function normalizeAreaText(value: string): string {
  return value.replace(/\s+/g, "");
}

function areaTextLength(area: PlatformAreaRow): number {
  return [area.province, area.city, area.district, area.street]
    .map(normalizeAreaText)
    .join("").length;
}

function formatPlatformArea(area: PlatformAreaRow): string {
  return `${area.province}/${area.city}/${area.district}/${area.street}`;
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
