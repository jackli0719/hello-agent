// [v0.9.0] 基础数据校验集中化。
//
// 业务规则：
// 1. 手机号不能为空，至少校验为 11 位数字。
// 2. 客户姓名不能为空。
// 3. 服务地址不能为空。
// 4. 订单金额必须大于 0。
// 5. 师傅姓名不能为空。
// 6. 师傅手机号不能为空，且必须为 11 位数字。
// 7. 师傅评分必须在 0 到 5 之间。
// 8. 师傅 skills 不能为空，逗号分隔后至少有一个有效技能。
// 9. 服务品类 code 不能为空。
// 10. 服务 SKU code 不能为空。
// 11. 服务 SKU basePrice 必须大于等于 0。
// 12. 派单规则 priority 必须是数字。
// 13. 派单规则 requiredSkills 不能为空，逗号分隔后至少有一个有效技能。
// 14. 取消订单时 cancelReason 不能为空。
// 15. 师傅完成订单时 serviceSummary 可以为空，但如果填写，需要去除首尾空格。
// 16. 平台合作区域省 / 市 / 区县 / 街道不能为空。
// 17. 商家名称 / 联系人不能为空，商家状态只能是 active / inactive。
//
// 设计：
// - 纯函数 + 单职责：每个函数只回答一个问题
// - 返回 { ok, error } 让 UI 拿 error 直接展示
// - 不引入 Zod 等框架（CLAUDE.md 禁止事项 #5）
// - 复用 normalizeSkills / parseSkillsString（masters.ts 已有）

import { normalizeSkills, parseSkillsString } from "@/src/lib/masters";

// 统一返回类型 — UI 拿 error 直接展示
export type ValidationResult = { ok: true } | { ok: false; error: string };

function ok(): ValidationResult {
  return { ok: true };
}
function fail(error: string): ValidationResult {
  return { ok: false, error };
}

// ============================================================
// 手机号
// ============================================================

/**
 * 手机号校验 — 业务规则 #1 / #7
 * - 非空
 * - 必须是 11 位数字，且 1 开头
 */
export function validatePhone(phone: unknown): ValidationResult {
  if (typeof phone !== "string") return fail("手机号不能为空");
  const trimmed = phone.trim();
  if (!trimmed) return fail("手机号不能为空");
  if (!/^1\d{10}$/.test(trimmed)) {
    return fail("手机号格式不正确（11 位数字，1 开头）");
  }
  return ok();
}

export function validateRequiredText(
  value: unknown,
  label: string,
  maxLength = 100,
): ValidationResult {
  if (typeof value !== "string") return fail(`请填写${label}`);
  const trimmed = value.trim();
  if (!trimmed) return fail(`请填写${label}`);
  if (trimmed.length > maxLength) {
    return fail(`${label}不能超过 ${maxLength} 个字符`);
  }
  return ok();
}

export function validateMerchantStatus(status: unknown): ValidationResult {
  if (typeof status !== "string") return fail("商家状态不正确");
  if (status !== "active" && status !== "inactive") {
    return fail("商家状态只能是 active / inactive");
  }
  return ok();
}

// ============================================================
// 客户姓名 / 师傅姓名
// ============================================================

/**
 * 客户姓名校验 — 业务规则 #2
 */
export function validateCustomerName(name: unknown): ValidationResult {
  if (typeof name !== "string") return fail("请填写客户姓名");
  const trimmed = name.trim();
  if (!trimmed) return fail("请填写客户姓名");
  if (trimmed.length > 50) return fail("客户姓名不能超过 50 个字符");
  return ok();
}

/**
 * 师傅姓名校验 — 业务规则 #6
 */
export function validateMasterName(name: unknown): ValidationResult {
  if (typeof name !== "string") return fail("请填写师傅姓名");
  const trimmed = name.trim();
  if (!trimmed) return fail("请填写师傅姓名");
  if (trimmed.length > 50) return fail("师傅姓名不能超过 50 个字符");
  return ok();
}

// ============================================================
// 服务地址
// ============================================================

/**
 * 服务地址校验 — 业务规则 #3
 */
export function validateAddress(addr: unknown): ValidationResult {
  if (typeof addr !== "string") return fail("请填写服务地址");
  const trimmed = addr.trim();
  if (!trimmed) return fail("请填写服务地址");
  if (trimmed.length > 200) return fail("服务地址不能超过 200 个字符");
  return ok();
}

// ============================================================
// 金额 / 价格
// ============================================================

/**
 * 订单金额校验 — 业务规则 #4（必须 > 0）
 */
export function validateOrderAmount(amount: unknown): ValidationResult {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return fail("订单金额必须是数字");
  if (n <= 0) return fail("订单金额必须大于 0");
  if (n > 1_000_000) return fail("订单金额超出合理范围");
  return ok();
}

/**
 * SKU basePrice 校验 — 业务规则 #11（必须 ≥ 0）
 * 与订单金额区别：SKU 可能 0 元（如免费服务）
 */
export function validateSkuBasePrice(price: unknown): ValidationResult {
  const n = typeof price === "number" ? price : Number(price);
  if (Number.isNaN(n)) return fail("价格必须是数字");
  if (n < 0) return fail("价格不能为负数");
  if (n > 1_000_000) return fail("价格超出合理范围");
  return ok();
}

// ============================================================
// 师傅评分
// ============================================================

/**
 * 师傅评分校验 — 业务规则 #7
 */
export function validateMasterRating(rating: unknown): ValidationResult {
  const n = typeof rating === "number" ? rating : Number(rating);
  if (Number.isNaN(n)) return fail("评分必须是数字");
  if (n < 0 || n > 5) return fail("评分必须在 0-5 之间");
  return ok();
}

// ============================================================
// skills（师傅 + 派单规则共用）
// ============================================================

/**
 * skills 非空校验 — 业务规则 #8 / #13
 * 接收逗号分隔字符串或数组，至少一个有效技能
 */
export function validateSkillsNonEmpty(
  input: unknown,
  label = "技能",
): ValidationResult {
  const arr = Array.isArray(input)
    ? normalizeSkills(input)
    : parseSkillsString(typeof input === "string" ? input : "");
  if (arr.length === 0) {
    return fail(`请填写至少一个${label}（逗号分隔）`);
  }
  return ok();
}

// ============================================================
// 业务编码（品类 / SKU）
// ============================================================

/**
 * 品类 / SKU code 通用校验 — 业务规则 #9 / #10
 * - 非空
 * - 格式：normalize 后非空（应用层防线）
 */
export function validateCode(code: unknown, label: string): ValidationResult {
  if (typeof code !== "string") return fail(`请填写${label}编码`);
  const trimmed = code.trim();
  if (!trimmed) return fail(`请填写${label}编码`);
  return ok();
}

// ============================================================
// 派单规则 priority
// ============================================================

/**
 * 派单规则 priority 校验 — 业务规则 #12
 * 必须是数字，0-10000
 */
export function validateRulePriority(priority: unknown): ValidationResult {
  const n = typeof priority === "number" ? priority : Number(priority);
  if (Number.isNaN(n)) return fail("优先级必须是数字");
  if (n < 0 || n > 10_000) return fail("优先级必须在 0-10000 之间");
  return ok();
}

// ============================================================
// 取消订单 cancelReason
// ============================================================

/**
 * 取消订单原因校验 — 业务规则 #14
 * 所有 cancel 状态都必填（pending / assigned / in_service）
 */
export function validateCancelReason(reason: unknown): ValidationResult {
  if (typeof reason !== "string") return fail("请填写取消原因");
  const trimmed = reason.trim();
  if (!trimmed) return fail("请填写取消原因");
  if (trimmed.length > 500) return fail("取消原因不能超过 500 个字符");
  return ok();
}

// ============================================================
// serviceSummary（师傅完成订单说明）
// ============================================================

/**
 * serviceSummary trim — 业务规则 #15
 * 可以为空字符串 / undefined，但填了就 trim 首尾空格
 * 返回 { ok, cleaned } — cleaned 是 trim 后的值（空字符串也保留）
 */
export function trimServiceSummary(input: unknown): {
  ok: true;
  cleaned: string;
} {
  const raw = typeof input === "string" ? input : "";
  return { ok: true, cleaned: raw.trim() };
}
