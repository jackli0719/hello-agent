// 业务编码生成 / 校验 — 纯函数，无 DB 依赖。
//
// 用于：
// - seed.ts 启动时校验硬编码的 categoryCode / skuCode 格式正确
// - 将来「新建类目 / SKU」的 UI / API 校验编码格式
// - 任何要往 DB 写编码的地方都先过这里

// 编码规则（业务约定）：
// - 只允许大写字母、数字、连字符
// - 长度 2-32 字符
// - 必须以字母开头
const CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,31}$/;

// [任务 18] 邀请码规则（与 codes 不同）：
// - 8 字符，大写字母 + 数字（不强制以字母开头，避免生成时 I/O 拒）
// - 演示期商家重新生成邀请码用 — 不走 CODE_PATTERN
// # MVP: Math.random 碰撞概率 = 36^8 = 2.8 万亿分之一，演示期安全
export const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_PATTERN = /^[A-Z0-9]{8}$/;

/**
 * 生成 8 字符大写字母数字邀请码
 *
 * 与 isValidInviteCode 配套使用：
 *   const code = generateInviteCode();
 *   if (!isValidInviteCode(code)) throw new Error("生成异常，重试");
 */
export function generateInviteCode(): string {
  // 36 字符 base36 = 0-9 + A-Z；toUpperCase 已是 uppercase
  // slice(2) 跳过 "0." 前缀
  let s = Math.random().toString(36).slice(2).toUpperCase();
  // 不足 8 位补 0（边界；极罕见但兜底）
  while (s.length < INVITE_CODE_LENGTH) s += "0";
  return s.slice(0, INVITE_CODE_LENGTH);
}

export function isValidInviteCode(code: string): boolean {
  return INVITE_CODE_PATTERN.test(code);
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/**
 * 把自由文本（中文类目名 / SKU 名）规范化成候选业务编码。
 *
 * 规则：
 * - 提取 ASCII 字母 + 数字
 * - 字母统一大写
 * - 非字母数字替换成 "-"
 * - 去掉首尾 "-"
 * - 长度截到 32
 * - 不抛错，但可能返回空字符串（如果输入没一个有效字符）
 *
 * 这是「建议值」，最终是否唯一还得调用方查 DB。
 */
export function suggestCode(input: string): string {
  // 输入中只要有「非 ASCII 字符」（中文 / 全角空格 / emoji 等），
  // 直接返回空 —— 不试图把混合输入「猜」成编码。
  // 这样上层 normalize 时能发现异常（normalize 后空 = 不合法）。
  if (/[^\x00-\x7f]/.test(input)) return "";
  let s = input
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toUpperCase()
    .replace(/^-+|-+$/g, "");
  if (s.length > 32) s = s.slice(0, 32);
  return s;
}

/**
 * 校验编码并抛错 — 给 seed / 内部调用方用。
 * 用户 UI 应当用 isValidCode 给出友好提示，不抛错。
 */
export function assertValidCode(code: string, label = "code"): void {
  if (!isValidCode(code)) {
    throw new Error(
      `${label} 格式不合法：${JSON.stringify(code)}（必须以字母开头，只含大写字母数字连字符，长度 2-32）`,
    );
  }
}

/**
 * 把任意用户输入强制规范化为合规编码。
 *
 * 应用层防线：所有写入路径（form action、API、seed）都应先过这里，
 * 这样大小写、非法字符、过长输入都不会污染 DB。
 *
 * 返回值可能是空字符串（输入完全是不可规范化的内容如「中文」），调用方
 * 需要用 isValidCode 二次校验。
 *
 * 配套 DB 防线：schema 字段加 @db.Collate("NOCASE") —— 即使应用层漏过，
 * DB unique 约束也会拦下小写变体。
 */
export function normalizeCode(input: string): string {
  return suggestCode(input);
}
