// 师傅业务逻辑 — 校验 + DB 写操作。
// app/masters/actions.ts（server action）调这里的函数。

import { prisma } from "@/src/lib/db";

export type MasterField =
  "name" | "phone" | "skills" | "rating" | "serviceArea";

export interface CreateMasterInput {
  name: string;
  phone: string;
  skills: string[]; // 数组，内部会 JSON.stringify
  rating: number;
  serviceArea: string;
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
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "请填写师傅姓名", field: "name" };
  if (name.length > 50)
    return { ok: false, error: "师傅姓名不能超过 50 个字符", field: "name" };

  const phone = (input.phone ?? "").trim();
  if (!phone) return { ok: false, error: "请填写手机号", field: "phone" };
  if (!/^1\d{10}$/.test(phone)) {
    return {
      ok: false,
      error: "手机号格式不正确（11 位数字，1 开头）",
      field: "phone",
    };
  }

  const skills = normalizeSkills(input.skills);
  // skills 可空（演示阶段允许），但若填了非法格式已被 normalizeSkills 滤掉

  const rating =
    typeof input.rating === "number" ? input.rating : Number(input.rating);
  if (Number.isNaN(rating))
    return { ok: false, error: "评分必须是数字", field: "rating" };
  if (rating < 0 || rating > 5)
    return { ok: false, error: "评分必须在 0-5 之间", field: "rating" };

  const serviceArea = (input.serviceArea ?? "").trim();
  if (serviceArea.length > 100) {
    return {
      ok: false,
      error: "服务区域不能超过 100 个字符",
      field: "serviceArea",
    };
  }

  return {
    ok: true,
    cleaned: { name, phone, skills, rating, serviceArea },
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
