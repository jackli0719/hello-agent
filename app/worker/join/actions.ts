"use server";

// /worker/join 服务端 action — 师傅通过邀请码入驻。
//
// 校验顺序（按任务 4 要求）：
// 1. inviteCode 不能为空
// 2. 查商家：存在 + status=active + inviteCodeEnabled=true
// 3. 校验 name / phone (11 位) / skills (至少 1 个有效)
// 4. 查 Master by phone：
//    - 已有 merchantId → 拒绝重复绑定
//    - 没有 merchantId → 绑到该商家
// 5. Master 不存在 → 创建（rating=5, available=true, joinSource=invite_code）
// 6. 写 activity log
// 7. 失败吞 activity log（不影响主流程）

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { findMerchantByInviteCode } from "@/src/lib/merchants";
import { createActivityLog } from "@/src/lib/activity-log";

export type JoinResult =
  | { ok: true; merchantName: string }
  | { ok: false; error: string; field?: string };

// 师傅入驻输入 schema — 简单字段校验（业务校验在 action 里做）
const JoinInputSchema = z.object({
  inviteCode: z.string().trim().min(1, "请输入邀请码").max(20),
  name: z.string().trim().min(1, "请填写姓名").max(50),
  phone: z
    .string()
    .trim()
    .regex(/^1\d{10}$/, "手机号必须为 11 位数字（1 开头）"),
  skills: z.string().trim().min(1, "请至少填写一个技能"),
  serviceArea: z.string().trim().max(100).optional(),
});

export async function joinByInviteCodeAction(
  formData: FormData,
): Promise<JoinResult> {
  // 1. FormData → input
  const raw = {
    inviteCode: String(formData.get("inviteCode") ?? ""),
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    skills: String(formData.get("skills") ?? ""),
    serviceArea: String(formData.get("serviceArea") ?? "") || undefined,
  };
  const parsed = JoinInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue.message,
      field: issue.path[0] as string,
    };
  }
  const input = parsed.data;

  // 2. 查商家 + 校验
  const merchant = await findMerchantByInviteCode(input.inviteCode);
  if (!merchant) {
    return { ok: false, error: "邀请码无效", field: "inviteCode" };
  }
  if (merchant.status !== "active") {
    return {
      ok: false,
      error: "该商家已停用，邀请码不可用",
      field: "inviteCode",
    };
  }
  if (!merchant.inviteCodeEnabled) {
    return { ok: false, error: "该邀请码已被禁用", field: "inviteCode" };
  }

  // 3. skills 解析（至少 1 个有效）
  const skills = input.skills
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (skills.length === 0) {
    return { ok: false, error: "请至少填写一个有效技能", field: "skills" };
  }

  // 4. 查 Master by phone（Master.phone @unique — P1-2 修后用 findUnique）
  const existing = await prisma.master.findUnique({
    where: { phone: input.phone },
  });
  let masterId: string;
  if (existing) {
    // 已绑定商家 → 拒绝重复绑定
    if (existing.merchantId && existing.merchantId !== "") {
      return {
        ok: false,
        error: "该手机号对应师傅已绑定商家，不能重复绑定",
        field: "phone",
      };
    }
    // 未绑定（理论上 schema NOT NULL 不会出现 ""，但防御性检查）— 绑到该商家
    const updated = await prisma.master.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        skills: JSON.stringify(skills),
        serviceArea: input.serviceArea ?? existing.serviceArea,
        merchantId: merchant.id,
        joinSource: "invite_code",
      },
    });
    masterId = updated.id;
  } else {
    // 5. 创建 Master
    const created = await prisma.master.create({
      data: {
        name: input.name,
        phone: input.phone,
        skills: JSON.stringify(skills),
        rating: 5.0,
        completedJobs: 0,
        status: "available",
        serviceArea: input.serviceArea ?? "",
        merchantId: merchant.id,
        joinSource: "invite_code",
      },
    });
    masterId = created.id;
  }

  // 6. activity log — 写 2 条：worker_joined_by_invite_code（师傅事件）+ master_bound_to_merchant（绑定事件）
  try {
    await createActivityLog({
      action: "worker_joined_by_invite_code",
      targetType: "master",
      targetId: masterId,
      message: `师傅 ${input.name}（${input.phone}）通过邀请码入驻商家 ${merchant.name}`,
      metadata: {
        merchantId: merchant.id,
        merchantName: merchant.name,
        phone: input.phone,
        isNewMaster: !existing,
      },
    });
    await createActivityLog({
      action: "master_bound_to_merchant",
      targetType: "master",
      targetId: masterId,
      message: `师傅 ${input.name} 绑定到商家 ${merchant.name}（邀请码入驻）`,
      metadata: {
        merchantId: merchant.id,
        merchantName: merchant.name,
        source: "invite_code",
        isNewMaster: !existing,
      },
    });
  } catch {
    // 写日志失败不阻塞主流程
  }

  try {
    revalidatePath("/masters");
    revalidatePath("/merchants");
  } catch {
    // 单测环境无 Next runtime
  }

  return { ok: true, merchantName: merchant.name };
}
