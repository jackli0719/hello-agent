// 鉴权 / CSRF 守卫 — [v0.9.4] P0 PR 前权限收口
//
// 设计：
// - 提供 3 个守卫函数供 server action 头部调用：
//   1. requireAdmin() — 后台管理类 action 强制 admin 角色
//   2. requireWorker() — 师傅类 action 强制 worker 角色 + 有 workerId
//   3. requireCsrf(formData) — FormData 类 action 强制 csrf token
// - 失败统一返回 { ok: false, category: "validation", error }，跟现有 action 错误结构一致
// - 不抛错（避免 redirect 异常吞错）
//
// 为什么放独立文件：
// - 跟 getCurrentUser/getSession 区分（auth.ts 是 session 读写，本文件是守卫）
// - 14 个 action 共用，避免每文件重写
// - 集中放测试入口（src/lib/auth-helpers.test.ts）

import { getCurrentUser, type AuthenticatedUser, type Role } from "./auth";
import { verifyCsrfToken, CSRF_FORM_FIELD } from "./csrf";

// ============================================================
// 统一守卫返回格式
// ============================================================

export type GuardOk<T> = { ok: true; user: T };
export type GuardFail = { ok: false; category: "validation"; error: string };
export type GuardResult<T> = GuardOk<T> | GuardFail;

/** 守卫失败时构造错误返回 */
function guardFail(error: string): GuardFail {
  return { ok: false, category: "validation", error };
}

// ============================================================
// 角色守卫
// ============================================================

/**
 * 要求当前用户是 admin（后台管理类 action）
 *
 * 用法：
 * ```ts
 * const auth = await requireAdmin();
 * if (!auth.ok) return auth;  // 直接返给前端
 * // auth.user 已窄化为 AuthenticatedUser
 * ```
 */
export async function requireAdmin(): Promise<GuardResult<AuthenticatedUser>> {
  const user = await getCurrentUser();
  if (!user) return guardFail("请重新登录后再操作");
  if (user.role !== "admin") {
    return guardFail("仅管理员可执行此操作");
  }
  return { ok: true, user };
}

/**
 * 要求当前用户是 worker 且已绑定到具体师傅
 *
 * 用法：worker 类 action（开始服务 / 完成服务 / 取消订单）头部调用
 */
export async function requireWorker(): Promise<GuardResult<AuthenticatedUser>> {
  const user = await getCurrentUser();
  if (!user) return guardFail("请重新登录后再操作");
  if (user.role !== "worker") {
    return guardFail("仅师傅可执行此操作");
  }
  if (!user.workerId) {
    return guardFail("当前账号未绑定师傅，无法操作");
  }
  return { ok: true, user };
}

/**
 * 要求当前角色符合列表（用于「customer 也能调但要校验」之类场景）
 *
 * @example
 *   const auth = await requireRole(["customer", "admin"]);
 */
export async function requireRole(
  roles: Role[],
): Promise<GuardResult<AuthenticatedUser>> {
  const user = await getCurrentUser();
  if (!user) return guardFail("请重新登录后再操作");
  if (!roles.includes(user.role)) {
    return guardFail(`仅 ${roles.join(" / ")} 可执行此操作`);
  }
  return { ok: true, user };
}

/**
 * [任务 18] 要求当前用户是 merchant 角色 + 绑定了非空 merchantId
 *
 * 商家端 action 强制守卫（提现申请 / 邀请码启停 / 重新生成）。
 * - 不接受 form 入参 — merchantId 永远从 session 读（CLAUDE.md P0-6 越权防控）
 * - admin 角色不允许走商家端 action（演示期 admin 看 /merchant-admin 只读，写操作只商家）
 * - merchant 角色但 merchantId=null：挡（orphan 账号）
 */
export async function requireMerchant(): Promise<
  GuardResult<AuthenticatedUser & { merchantId: string }>
> {
  const user = await getCurrentUser();
  if (!user) return guardFail("请重新登录后再操作");
  if (user.role !== "merchant") {
    return guardFail("仅商家账号可执行此操作");
  }
  if (!user.merchantId) {
    return guardFail("当前商家账号未绑定 merchantId");
  }
  return { ok: true, user: user as AuthenticatedUser & { merchantId: string } };
}

// ============================================================
// CSRF 守卫
// ============================================================

/**
 * 要求 formData 含正确 _csrf token
 *
 * 用法：所有 FormData 类 server action 头部
 * ```ts
 * const csrf = await requireCsrf(formData);
 * if (!csrf.ok) return csrf;
 * ```
 *
 * # MVP: 只挡显式 FormData；非 FormData 参数的 action（assignOrderAction 等）
 *       暂不在此函数范围内（v0.9.7 评估是否改造）
 */
export async function requireCsrf(
  formData: FormData,
): Promise<GuardOk<null> | GuardFail> {
  const token = formData.get(CSRF_FORM_FIELD);
  const formToken = typeof token === "string" ? token : null;
  const ok = await verifyCsrfToken(formToken);
  if (!ok) {
    return guardFail("会话已过期，请刷新页面后重试");
  }
  return { ok: true, user: null };
}
