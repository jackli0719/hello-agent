// 服务品类 / SKU 业务逻辑 — 校验 + DB 写操作。
// app/services/actions.ts（server action）调这里的函数。

import { prisma } from "@/src/lib/db";
import { assertValidCode, normalizeCode } from "@/src/lib/codes";
import { normalizeSkills } from "@/src/lib/masters";

// ============================================================
// 类型
// ============================================================

export type ServiceField =
  | "name"
  | "code"
  | "categoryCode"
  | "basePrice"
  | "requiredSkills"
  | "enabled";

export interface CreateCategoryInput {
  name: string;
  code: string;        // 业务编码 — 应用层会强制大写
  enabled: boolean;
}

export interface CreateSkuInput {
  name: string;
  code: string;
  categoryCode: string; // 通过 code 反查 categoryId
  basePrice: number;    // 元（页面录入用），repo 内转分
  enabled: boolean;
  requiredSkills: string[]; // 派单所需技能；空数组 = 不参与自动派单
}

export interface UpdateSkuInput {
  id: string;
  name: string;
  basePrice: number;    // 元
  enabled: boolean;
  requiredSkills: string[];
}

export type ServiceResult =
  | { ok: true; id: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: ServiceField;
    };

// ============================================================
// 类目
// ============================================================

export async function listCategories() {
  return prisma.serviceCategory.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, categoryCode: true, enabled: true, createdAt: true },
  });
}

export function validateCategoryInput(
  input: Partial<CreateCategoryInput>,
): { ok: true; cleaned: CreateCategoryInput } | { ok: false; error: string; field: ServiceField } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "请填写品类名称", field: "name" };
  if (name.length > 30) return { ok: false, error: "品类名称不能超过 30 个字符", field: "name" };

  const codeRaw = (input.code ?? "").trim();
  if (!codeRaw) return { ok: false, error: "请填写品类编码", field: "code" };
  // 用 codes.ts 的 normalizeCode — 一致性：含非 ASCII 直接返空
  const normalized = normalizeCode(codeRaw);
  if (!normalized) return { ok: false, error: "品类编码格式不合法", field: "code" };
  try {
    assertValidCode(normalized, "品类编码");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "品类编码格式不合法", field: "code" };
  }

  const enabled = typeof input.enabled === "boolean" ? input.enabled : Boolean(input.enabled);

  return {
    ok: true,
    cleaned: { name, code: normalized, enabled },
  };
}

/**
 * 创建服务品类。
 * code 走应用层 normalize（强制大写）— 但 assertValidCode 已经在 validate 里跑过，
 * 这里再 normalize 一次保险（如果以后校验规则放宽，normalize 仍然要执行）。
 */
export async function createCategory(
  rawInput: Partial<CreateCategoryInput>,
): Promise<ServiceResult> {
  const validated = validateCategoryInput(rawInput);
  if (!validated.ok) {
    return { ok: false, category: "validation", error: validated.error, field: validated.field };
  }
  const c = validated.cleaned;
  // validate 已经把 code normalize 成大写 — 直接用
  const code = c.code;

  try {
    const row = await prisma.serviceCategory.create({
      data: { name: c.name, categoryCode: code, enabled: c.enabled },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint failed")) {
      return {
        ok: false,
        category: "validation",
        error: `品类名称或编码已存在：${c.name} / ${code}`,
        field: "code",
      };
    }
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "创建品类失败",
    };
  }
}

// ============================================================
// SKU
// ============================================================

export interface SkuListItem {
  id: string;
  skuCode: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  basePriceYuan: number;
  durationMinutes: number;
  enabled: boolean;
}

export async function listSkus(): Promise<SkuListItem[]> {
  const rows = await prisma.serviceSku.findMany({
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      skuCode: true,
      name: true,
      basePrice: true,
      durationMinutes: true,
      enabled: true,
      category: { select: { categoryCode: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    skuCode: r.skuCode,
    name: r.name,
    categoryCode: r.category.categoryCode,
    categoryName: r.category.name,
    basePriceYuan: r.basePrice / 100,
    durationMinutes: r.durationMinutes,
    enabled: r.enabled,
  }));
}

export function validateSkuInput(
  input: Partial<CreateSkuInput>,
): { ok: true; cleaned: CreateSkuInput } | { ok: false; error: string; field: ServiceField } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "请填写 SKU 名称", field: "name" };
  if (name.length > 60) return { ok: false, error: "SKU 名称不能超过 60 个字符", field: "name" };

  const codeRaw = (input.code ?? "").trim();
  if (!codeRaw) return { ok: false, error: "请填写 SKU 编码", field: "code" };
  // 用 codes.ts 的 normalizeCode — 含非 ASCII 直接返空，行为一致
  const codeNormalized = normalizeCode(codeRaw);
  if (!codeNormalized) return { ok: false, error: "SKU 编码格式不合法", field: "code" };
  try {
    assertValidCode(codeNormalized, "SKU 编码");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "SKU 编码格式不合法", field: "code" };
  }

  const categoryCodeRaw = (input.categoryCode ?? "").trim();
  if (!categoryCodeRaw) return { ok: false, error: "请选择所属品类", field: "categoryCode" };
  const categoryCodeNormalized = normalizeCode(categoryCodeRaw);
  if (!categoryCodeNormalized) {
    return { ok: false, error: "品类编码格式不合法", field: "categoryCode" };
  }

  const basePrice = typeof input.basePrice === "number" ? input.basePrice : Number(input.basePrice);
  if (Number.isNaN(basePrice)) return { ok: false, error: "价格必须是数字", field: "basePrice" };
  if (basePrice < 0) return { ok: false, error: "价格不能为负数", field: "basePrice" };
  if (basePrice > 1_000_000) return { ok: false, error: "价格超出合理范围", field: "basePrice" };

  const enabled = typeof input.enabled === "boolean" ? input.enabled : Boolean(input.enabled);

  // requiredSkills — 空数组允许（应急服务、不参与自动派单的场景）
  const requiredSkills = normalizeSkills(input.requiredSkills);

  return {
    ok: true,
    cleaned: {
      name,
      code: codeNormalized,
      categoryCode: categoryCodeNormalized,
      basePrice,
      enabled,
      requiredSkills,
    },
  };
}

export function validateUpdateSkuInput(
  input: Partial<UpdateSkuInput>,
): { ok: true; cleaned: UpdateSkuInput } | { ok: false; error: string; field: ServiceField } {
  const id = (input.id ?? "").trim();
  if (!id) return { ok: false, error: "缺少 SKU id", field: "name" };

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "请填写 SKU 名称", field: "name" };
  if (name.length > 60) return { ok: false, error: "SKU 名称不能超过 60 个字符", field: "name" };

  const basePrice = typeof input.basePrice === "number" ? input.basePrice : Number(input.basePrice);
  if (Number.isNaN(basePrice)) return { ok: false, error: "价格必须是数字", field: "basePrice" };
  if (basePrice < 0) return { ok: false, error: "价格不能为负数", field: "basePrice" };
  if (basePrice > 1_000_000) return { ok: false, error: "价格超出合理范围", field: "basePrice" };

  const enabled = typeof input.enabled === "boolean" ? input.enabled : Boolean(input.enabled);

  // requiredSkills — 空数组允许
  const requiredSkills = normalizeSkills(input.requiredSkills);

  return {
    ok: true,
    cleaned: {
      id,
      name,
      basePrice,
      enabled,
      requiredSkills,
    },
  };
}

/**
 * 创建 SKU。
 * - code 走应用层 normalize 强制大写
 * - categoryCode 通过 prisma 反查 categoryId
 * - SKU 默认 requiredSkills = "[]"，durationMinutes = 60（不暴露给 UI 编辑）
 * - 业务编码 / 名称 / 类目任一重复 → unique 冲突 → validation 错误
 */
export async function createSku(
  rawInput: Partial<CreateSkuInput>,
): Promise<ServiceResult> {
  const validated = validateSkuInput(rawInput);
  if (!validated.ok) {
    return { ok: false, category: "validation", error: validated.error, field: validated.field };
  }
  const c = validated.cleaned;
  // validate 已经把 code 和 categoryCode 转成大写 — 直接用
  const skuCode = c.code;
  const categoryCode = c.categoryCode;

  const cat = await prisma.serviceCategory.findUnique({
    where: { categoryCode },
    select: { id: true, enabled: true },
  });
  if (!cat) {
    return {
      ok: false,
      category: "validation",
      error: `所属品类不存在：${categoryCode}`,
      field: "categoryCode",
    };
  }
  if (!cat.enabled) {
    return {
      ok: false,
      category: "validation",
      error: `所属品类已禁用，无法新建 SKU`,
      field: "categoryCode",
    };
  }

  try {
    const row = await prisma.serviceSku.create({
      data: {
        skuCode,
        name: c.name,
        categoryId: cat.id,
        basePrice: Math.round(c.basePrice * 100),
        durationMinutes: 60,
        requiredSkills: JSON.stringify(c.requiredSkills),
        enabled: c.enabled,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint failed")) {
      return {
        ok: false,
        category: "validation",
        error: `SKU 编码已存在：${skuCode}`,
        field: "code",
      };
    }
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "创建 SKU 失败",
    };
  }
}

/**
 * 更新 SKU — 按需求范围只让改 name / basePrice / enabled。
 * code / categoryCode / durationMinutes / requiredSkills 不在表单里。
 */
export async function updateSku(
  rawInput: Partial<UpdateSkuInput>,
): Promise<ServiceResult> {
  const validated = validateUpdateSkuInput(rawInput);
  if (!validated.ok) {
    return { ok: false, category: "validation", error: validated.error, field: validated.field };
  }
  const c = validated.cleaned;

  if (!c.id) {
    return { ok: false, category: "validation", error: "缺少 SKU id", field: "name" };
  }
  const exists = await prisma.serviceSku.findUnique({ where: { id: c.id }, select: { id: true } });
  if (!exists) {
    return { ok: false, category: "validation", error: `SKU ${c.id} 不存在`, field: "name" };
  }

  try {
    await prisma.serviceSku.update({
      where: { id: c.id },
      data: {
        name: c.name,
        basePrice: Math.round(c.basePrice * 100),
        enabled: c.enabled,
        requiredSkills: JSON.stringify(c.requiredSkills),
      },
    });
    return { ok: true, id: c.id };
  } catch (e) {
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "更新 SKU 失败",
    };
  }
}