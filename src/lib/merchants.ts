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
