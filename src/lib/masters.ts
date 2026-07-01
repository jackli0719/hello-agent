// 师傅业务逻辑 — 校验 + DB 写操作。
// app/masters/actions.ts（server action）调这里的函数。

import { prisma } from "@/src/lib/db";
import {
  validateMasterName,
  validateMasterRating,
  validatePhone,
  validateSkillsNonEmpty,
} from "@/src/lib/validation";

export type MasterField =
  "name" | "phone" | "skills" | "rating" | "serviceArea" | "merchantId"; // [任务 2] 商家必填

export interface CreateMasterInput {
  name: string;
  phone: string;
  skills: string[]; // 数组，内部会 JSON.stringify
  rating: number;
  serviceArea: string;
  // [任务 2] 师傅必须归属一个商家 — 平台合作模式必填
  merchantId: string;
  // 注意：available/status 不在表单字段里 — 由系统（派单/释放）自动管理
}

export interface UpdateMasterInput extends CreateMasterInput {
  id: string;
}

export type CreateMasterResult =
  | { ok: true; masterId: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
      field?: MasterField;
    };

/**
 * 把 skills 数组规范化为干净数组：
 * - 去空字符串
 * - 去重
 * - trim
 * - 过滤非字符串
 */
export function normalizeSkills(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 把"逗号分隔"字符串解析成 skills 数组。
 * 需求里说 "skills 先用逗号分隔输入即可，例如：air_conditioner_repair,refrigerator_repair"
 * 这里支持中英文逗号 + 全角逗号。
 */
export function parseSkillsString(input: string): string[] {
  return normalizeSkills(
    input
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// 反向：把数组拼回逗号分隔字符串（编辑表单回显用）
// 用 ", " 分隔是因为 parseSkillsString 兼容中英文逗号 + 空格
export function skillsToString(skills: string[]): string {
  return skills.join(", ");
}

/**
 * 通用校验：返回一个 result 或者 ok。
 * server action 和纯单测都调它，保证两边校验一致。
 */
// [任务 2] 校验商家存在 + active
export async function requireActiveMerchant(
  merchantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!merchantId) return { ok: false, error: "请选择所属商家" };
  const m = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!m) return { ok: false, error: "所属商家不存在" };
  if (m.status !== "active") {
    return { ok: false, error: "所属商家已停用，不能新绑定师傅" };
  }
  return { ok: true };
}

/** 列出 active 商家（供师傅表单下拉） */
export async function listActiveMerchants() {
  return prisma.merchant.findMany({
    where: { status: "active" },
    orderBy: [{ createdAt: "desc" }],
  });
}

export function validateMasterInput(input: Partial<CreateMasterInput>):
  | {
      ok: true;
      cleaned: CreateMasterInput;
    }
  | {
      ok: false;
      error: string;
      field: MasterField;
    } {
  // [v0.9.0] 复用 src/lib/validation.ts
  const nameR = validateMasterName(input.name);
  if (!nameR.ok) return { ok: false, error: nameR.error, field: "name" };
  const name = input.name!.trim();

  const phoneR = validatePhone(input.phone);
  if (!phoneR.ok) return { ok: false, error: phoneR.error, field: "phone" };
  const phone = input.phone!.trim();

  // [v0.9.0] 业务规则 #8 — skills 不能为空（之前是允许空数组）
  const skillsR = validateSkillsNonEmpty(input.skills, "技能");
  if (!skillsR.ok) return { ok: false, error: skillsR.error, field: "skills" };
  const skills = normalizeSkills(input.skills);

  const ratingR = validateMasterRating(input.rating);
  if (!ratingR.ok) return { ok: false, error: ratingR.error, field: "rating" };
  const rating =
    typeof input.rating === "number" ? input.rating : Number(input.rating);

  const serviceArea = (input.serviceArea ?? "").trim();
  if (serviceArea.length > 100) {
    return {
      ok: false,
      error: "服务区域不能超过 100 个字符",
      field: "serviceArea",
    };
  }

  // [任务 2] 师傅必须归属商家 — 必填校验
  const merchantId = (input.merchantId ?? "").trim();
  if (!merchantId) {
    return {
      ok: false,
      error: "请选择所属商家",
      field: "merchantId",
    };
  }

  return {
    ok: true,
    cleaned: { name, phone, skills, rating, serviceArea, merchantId },
  };
}

/**
 * 创建师傅 — 校验 + 写库。
 * 业务主键 (id) 自动 cuid。
 * 初始 completedJobs = 0（serviceArea / skills 用 cleaned 后的值）。
 */
export async function createMaster(
  rawInput: Partial<CreateMasterInput>,
): Promise<CreateMasterResult> {
  const validated = validateMasterInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }
  const c = validated.cleaned;

  // [任务 2] 商家必须存在 + active
  const merchantCheck = await requireActiveMerchant(c.merchantId);
  if (!merchantCheck.ok) {
    return {
      ok: false,
      category: "validation",
      error: merchantCheck.error,
      field: "merchantId",
    };
  }

  try {
    const row = await prisma.master.create({
      data: {
        name: c.name,
        phone: c.phone,
        skills: JSON.stringify(c.skills),
        rating: c.rating,
        // 新师傅默认 available — status 由后续派单/释放自动管
        status: "available",
        serviceArea: c.serviceArea,
        // [任务 2] 师傅归属商家 — FK merchantId（validated.cleaned 必填）
        merchant: { connect: { id: c.merchantId } },
      },
      select: { id: true },
    });
    return { ok: true, masterId: row.id };
  } catch (e) {
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "创建师傅失败",
    };
  }
}

/**
 * 编辑师傅 — 校验 + 写库。
 * 不允许改：id / completedJobs（这些是系统字段，UI 不暴露编辑）。
 */
export async function updateMaster(
  rawInput: Partial<UpdateMasterInput>,
): Promise<CreateMasterResult> {
  const id = (rawInput.id ?? "").trim();
  if (!id)
    return {
      ok: false,
      category: "validation",
      error: "缺少师傅 id",
      field: "name",
    };

  const exists = await prisma.master.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) {
    return {
      ok: false,
      category: "validation",
      error: `师傅 ${id} 不存在`,
      field: "name",
    };
  }

  const validated = validateMasterInput(rawInput);
  if (!validated.ok) {
    return {
      ok: false,
      category: "validation",
      error: validated.error,
      field: validated.field,
    };
  }
  const c = validated.cleaned;

  // [任务 2] 改换所属商家时也校验 active
  const merchantCheck = await requireActiveMerchant(c.merchantId);
  if (!merchantCheck.ok) {
    return {
      ok: false,
      category: "validation",
      error: merchantCheck.error,
      field: "merchantId",
    };
  }

  try {
    await prisma.master.update({
      where: { id },
      data: {
        name: c.name,
        phone: c.phone,
        skills: JSON.stringify(c.skills),
        rating: c.rating,
        // 注意：status 不在这里改 — 由 assignOrder / releaseMaster 自动管
        serviceArea: c.serviceArea,
        // [任务 2] 改换所属商家 — FK merchantId
        merchant: { connect: { id: c.merchantId } },
      },
    });
    return { ok: true, masterId: id };
  } catch (e) {
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "更新师傅失败",
    };
  }
}
