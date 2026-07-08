import { prisma } from "@/src/lib/db";
import {
  validateMerchantStatus,
  validatePhone,
  validateRequiredText,
} from "@/src/lib/validation";

export type MerchantStatus = "active" | "inactive";

export type MerchantField =
  | "name"
  | "contactName"
  | "phone"
  | "status"
  | "province"
  | "city"
  | "district"
  | "street"
  | "addressDetail";

export interface CreateMerchantInput {
  name: string;
  contactName: string;
  phone: string;
  status: MerchantStatus;
  province: string;
  city: string;
  district: string;
  street: string;
  addressDetail: string;
}

export interface UpdateMerchantInput extends CreateMerchantInput {
  id: string;
}

export type MerchantResult =
  | { ok: true; id: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: MerchantField;
    };

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateMerchantInput(
  input: Partial<CreateMerchantInput>,
):
  | { ok: true; cleaned: CreateMerchantInput }
  | { ok: false; error: string; field: MerchantField } {
  const cleaned = {
    name: cleanText(input.name),
    contactName: cleanText(input.contactName),
    phone: cleanText(input.phone),
    status: cleanText(input.status) as MerchantStatus,
    province: cleanText(input.province),
    city: cleanText(input.city),
    district: cleanText(input.district),
    street: cleanText(input.street),
    addressDetail: cleanText(input.addressDetail),
  };

  for (const [field, label, value, maxLength] of [
    ["name", "商家名称", cleaned.name, 80],
    ["contactName", "联系人", cleaned.contactName, 50],
    ["province", "省", cleaned.province, 50],
    ["city", "市", cleaned.city, 50],
    ["district", "区县", cleaned.district, 50],
    ["street", "街道 / 乡镇", cleaned.street, 50],
  ] as const) {
    const r = validateRequiredText(value, label, maxLength);
    if (!r.ok) return { ok: false, error: r.error, field };
  }

  const phoneR = validatePhone(cleaned.phone);
  if (!phoneR.ok) return { ok: false, error: phoneR.error, field: "phone" };

  const statusR = validateMerchantStatus(cleaned.status);
  if (!statusR.ok) return { ok: false, error: statusR.error, field: "status" };

  if (cleaned.addressDetail.length > 200) {
    return {
      ok: false,
      error: "详细地址不能超过 200 个字符",
      field: "addressDetail",
    };
  }

  return { ok: true, cleaned };
}

export async function listMerchants() {
  return prisma.merchant.findMany({
    include: {
      _count: {
        select: { merchantAreas: true, masters: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getMerchant(id: string) {
  return prisma.merchant.findUnique({ where: { id } });
}

export async function createMerchant(
  rawInput: Partial<CreateMerchantInput>,
): Promise<MerchantResult> {
  const validated = validateMerchantInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }

  try {
    const row = await prisma.merchant.create({ data: validated.cleaned });
    return { ok: true, id: row.id };
  } catch {
    return { ok: false, category: "system", error: "商家保存失败" };
  }
}

export async function updateMerchant(
  rawInput: Partial<UpdateMerchantInput>,
): Promise<MerchantResult> {
  const id = cleanText(rawInput.id);
  if (!id) {
    return {
      ok: false,
      category: "validation",
      error: "缺少商家 id",
      field: "name",
    };
  }

  const validated = validateMerchantInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }

  try {
    const row = await prisma.merchant.update({
      where: { id },
      data: validated.cleaned,
    });
    return { ok: true, id: row.id };
  } catch {
    return { ok: false, category: "system", error: "商家保存失败" };
  }
}

// ============================================================
// [任务 2] 商家合作区域绑定（MerchantArea）
// ============================================================

/**
 * 列商家已绑定的合作区域（带 PlatformArea 详情 + 启用状态）
 */
export async function listMerchantAreas(merchantId: string) {
  return prisma.merchantArea.findMany({
    where: { merchantId },
    include: { platformArea: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 列所有启用的 PlatformArea（供商家绑定 UI 下拉）
 * 排除该商家已绑定的（防重复）
 */
export async function listAvailablePlatformAreas(merchantId: string) {
  const bound = await prisma.merchantArea.findMany({
    where: { merchantId },
    select: { platformAreaId: true },
  });
  const boundIds = bound.map((b) => b.platformAreaId);
  return prisma.platformArea.findMany({
    where: {
      enabled: true,
      id: { notIn: boundIds },
    },
    orderBy: [{ province: "asc" }, { city: "asc" }, { district: "asc" }],
  });
}

/**
 * 商家绑定一个 PlatformArea
 * 唯一约束 @@unique([merchantId, platformAreaId]) 自动防重复
 * 必须 platformArea.enabled = true（业务规则）
 */
export async function bindMerchantArea(
  merchantId: string,
  platformAreaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { status: true },
  });
  if (!merchant) return { ok: false, error: "商家不存在" };
  if (merchant.status !== "active") {
    return { ok: false, error: "商家已停用，不能绑定区域" };
  }

  const pa = await prisma.platformArea.findUnique({
    where: { id: platformAreaId },
  });
  if (!pa) return { ok: false, error: "PlatformArea 不存在" };
  if (!pa.enabled) return { ok: false, error: "PlatformArea 已停用，不能绑定" };

  try {
    await prisma.merchantArea.create({
      data: { merchantId, platformAreaId, enabled: true },
    });
    return { ok: true };
  } catch {
    // 唯一约束冲突 — 已绑定过
    return { ok: false, error: "该区域已绑定" };
  }
}

/**
 * 启用/停用已绑定的 MerchantArea
 * enabled=false 时该区域不参与派单（任务 3 实施）
 */
export async function toggleMerchantAreaEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ma = await prisma.merchantArea.findUnique({ where: { id } });
  if (!ma) return { ok: false, error: "绑定关系不存在" };
  await prisma.merchantArea.update({
    where: { id },
    data: { enabled },
  });
  return { ok: true };
}

/**
 * 商家已绑定合作区域数
 * 供 /merchants 列表展示「已绑定 N 个区域」
 */
export async function countMerchantAreas(merchantId: string): Promise<number> {
  return prisma.merchantArea.count({ where: { merchantId } });
}

/**
 * 商家旗下师傅数
 * 供 /merchants 列表展示「N 个师傅」
 */
export async function countMerchantMasters(
  merchantId: string,
): Promise<number> {
  return prisma.master.count({ where: { merchantId } });
}
