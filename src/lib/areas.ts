import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { validateRequiredText } from "@/src/lib/validation";

export type PlatformAreaField =
  "province" | "city" | "district" | "street" | "enabled";

export interface CreatePlatformAreaInput {
  province: string;
  city: string;
  district: string;
  street: string;
  enabled: boolean;
}

export interface UpdatePlatformAreaInput extends CreatePlatformAreaInput {
  id: string;
}

export type PlatformAreaResult =
  | { ok: true; id: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: PlatformAreaField;
    };

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateAreaInput(
  input: Partial<CreatePlatformAreaInput>,
):
  | { ok: true; cleaned: CreatePlatformAreaInput }
  | { ok: false; error: string; field: PlatformAreaField } {
  const province = cleanText(input.province);
  const city = cleanText(input.city);
  const district = cleanText(input.district);
  const street = cleanText(input.street);

  for (const [field, label, value] of [
    ["province", "省", province],
    ["city", "市", city],
    ["district", "区县", district],
    ["street", "街道 / 乡镇", street],
  ] as const) {
    const r = validateRequiredText(value, label, 50);
    if (!r.ok) return { ok: false, error: r.error, field };
  }

  return {
    ok: true,
    cleaned: {
      province,
      city,
      district,
      street,
      enabled:
        typeof input.enabled === "boolean"
          ? input.enabled
          : Boolean(input.enabled),
    },
  };
}

function mapAreaError(e: unknown): PlatformAreaResult {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return {
      ok: false,
      category: "validation",
      error: "平台合作区域已存在，不能重复创建",
      field: "street",
    };
  }
  return { ok: false, category: "system", error: "平台合作区域保存失败" };
}

export async function listPlatformAreas() {
  return prisma.platformArea.findMany({
    orderBy: [
      { enabled: "desc" },
      { province: "asc" },
      { city: "asc" },
      { district: "asc" },
      { street: "asc" },
    ],
  });
}

export async function getPlatformArea(id: string) {
  return prisma.platformArea.findUnique({ where: { id } });
}

export async function createPlatformArea(
  rawInput: Partial<CreatePlatformAreaInput>,
): Promise<PlatformAreaResult> {
  const validated = validateAreaInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }

  try {
    const row = await prisma.platformArea.create({ data: validated.cleaned });
    return { ok: true, id: row.id };
  } catch (e) {
    return mapAreaError(e);
  }
}

export async function updatePlatformArea(
  rawInput: Partial<UpdatePlatformAreaInput>,
): Promise<PlatformAreaResult> {
  const id = cleanText(rawInput.id);
  if (!id) {
    return {
      ok: false,
      category: "validation",
      error: "缺少平台合作区域 id",
      field: "enabled",
    };
  }

  const validated = validateAreaInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }

  try {
    const row = await prisma.platformArea.update({
      where: { id },
      data: validated.cleaned,
    });
    return { ok: true, id: row.id };
  } catch (e) {
    return mapAreaError(e);
  }
}
