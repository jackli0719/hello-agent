// 登录保护 — [v0.6.0] iron-session 签名/加密 session
//
// 设计：
// - 三种角色：admin / worker / customer
// - User 模型（Prisma）存账号；密码 bcrypt 哈希
// - session 用 iron-session 签名/加密（A256-GCM）
//   - 单一 cookie：o2o_session 存 { userId, role }
//   - httpOnly: 防 XSS 偷 cookie
//   - 30 天过期
//   - 改 cookie role/userId 都被 iron-session 拒绝（签名校验失败）
//
// 不做（按需求）：
// - 不做密码明文（已用 bcrypt 哈希）
// - 不做注册 / 找回密码 / OAuth / 短信验证码
// - 不做 RBAC 权限表（粗粒度按 role 分组）

import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

export const SESSION_COOKIE = "o2o_session";

export type Role = "admin" | "worker" | "customer" | "merchant"; // [任务 18] 商家角色

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 天
};

// ============================================================
// 路径权限矩阵（按角色分组）
// ============================================================

/** 受保护路径（必须登录） */
export const PROTECTED_PATHS = [
  "/dashboard",
  "/orders",
  "/services",
  "/masters",
  "/platform-areas",
  "/merchants",
  "/commission-strategies",
  "/settlements",
  "/merchant-settlements",
  "/master-settlements",
  "/payout-records",
  "/withdraw-requests",
  "/master-withdraw-requests",
  "/finance-ledgers",
  "/dispatch-rules",
  "/activity-logs",
  "/admin",
  "/admin/after-sales", // [任务 21] 售后工单后台
  "/admin/risk-alerts", // [任务 23] 风控预警后台
  "/worker",
  "/merchant-admin", // [任务 18] 商家端后台
  "/customer/orders",
  "/notifications", // [任务 19] 通知中心（仅登录用户；admin 看 ActivityLog）
];

/**
 * 公开路径（不需登录也可访问）
 * 注意：根路径 "/" 不放这里 —— 它 prefix-match 所有路径，会把 PROTECTED 全覆盖成 false
 * 单独在 isProtectedPath 里判断 pathname === "/"
 */
export const PUBLIC_PATHS = ["/login", "/customer"];

/** 各角色登录后默认跳转 */
export const DEFAULT_LANDING: Record<Role, string> = {
  admin: "/dashboard",
  worker: "/worker",
  customer: "/customer/orders",
  merchant: "/merchant-admin", // [任务 18] 商家登录后落商家后台
};

/** 角色可访问的路径前缀 */
export const ROLE_ALLOWED: Record<Role, string[]> = {
  admin: [
    "/dashboard",
    "/orders",
    "/services",
    "/masters",
    "/platform-areas",
    "/merchants",
    "/commission-strategies",
    "/settlements",
    "/merchant-settlements",
    "/master-settlements",
    "/payout-records",
    "/withdraw-requests",
    "/master-withdraw-requests",
    "/finance-ledgers",
    "/dispatch-rules",
    "/activity-logs",
    "/admin",
    "/admin/after-sales", // [任务 21] 售后工单（admin 专属）
    "/admin/risk-alerts", // [任务 23] 风控预警（admin 专属）
    "/merchant-admin", // [任务 18] admin 也能看商家后台（演示/排障）
  ],
  worker: ["/worker", "/master-withdraw-requests", "/notifications"], // [任务 19]
  customer: ["/customer", "/customer/orders", "/notifications"], // [任务 19]
  // [任务 18] merchant 角色只能进商家后台，不能看 admin 后台
  merchant: ["/merchant-admin", "/notifications"], // [任务 19]
};

// ============================================================
// 校验账号（查 DB）
// ============================================================

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
  workerId: string | null;
  // [任务 18] 商家账号绑定 — merchant 角色必填；其他角色 null
  merchantId: string | null;
}

/** iron-session 内容 schema */
export interface SessionData {
  userId?: string;
  role?: Role;
}

/**
 * iron-session 配置 — 必填 SESSION_SECRET（>= 32 字符）
 * dev 默认给一个演示值；生产从 .env 读
 */
function getSessionOptions() {
  const password =
    process.env.SESSION_SECRET ??
    "dev-only-do-not-use-in-production-32chars-min-aaaa";
  if (password.length < 32) {
    throw new Error("SESSION_SECRET 长度不足 32 字符 — 见 .env.example");
  }
  return {
    password,
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: process.env.NODE_ENV === "production", // [v0.6.0] B5: production 强制 secure
      maxAge: 60 * 60 * 24 * 30, // 30 天
    },
  };
}

/**
 * 校验账号 + 返回用户信息
 * - 支持 username 或 phone 登录
 * - [v0.5.0] 密码 bcrypt 哈希比对（修 ADR-013 A1 P0）
 */
export async function authenticate(
  account: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  // 同时按 name 或 phone 查（演示便利）
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ name: account }, { phone: account }],
    },
  });
  if (!user) return null;
  // bcrypt 哈希比对
  const passwordOk = await bcrypt.compare(password, user.password);
  if (!passwordOk) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role as Role,
    phone: user.phone,
    workerId: user.workerId,
    // [任务 18] 商家账号 merchantId 从 User 表读
    merchantId: user.merchantId,
  };
}

// ============================================================
// Session 读写（[v0.6.0] iron-session 替换裸 cookie）
// ============================================================

/**
 * 取 iron-session 实例 — 在 server action / route handler / server component 内调用
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const c = await cookies();
  return getIronSession<SessionData>(c, getSessionOptions());
}

/** 从 session 取当前用户（userId 反查 DB） */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await getSession();
  if (!session.userId || !session.role) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role as Role,
    phone: user.phone,
    workerId: user.workerId,
    // [任务 18] 商家账号 merchantId 从 User 表读
    merchantId: user.merchantId,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return !!user;
}

// ============================================================
// 路径权限判断
// ============================================================

/**
 * 是否受保护路径：
 * - 先看 PROTECTED_PATHS（受保护优先 — 即使前缀跟 PUBLIC 撞车）
 * - 再看 PUBLIC_PATHS（仅当不受保护时才判断是否公开）
 *
 * 关键：/customer/orders 必须在 PROTECTED_PATHS 里，否则 PUBLIC 的 /customer 前缀
 *      会把它覆盖成「公开」（prefix 匹配漏洞）。
 */
export function isProtectedPath(pathname: string): boolean {
  // 1. 根路径永远放行（首页 + 静态入口）
  if (pathname === "/") return false;

  // 2. 受保护优先（精确 + 前缀匹配）
  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isProtected) return true;

  // 3. 不受保护：默认放行（白名单模式 — 未列入 = 公开）
  return false;
}

/** 给定路径 + 当前角色，是否可访问 */
export function canAccess(role: Role | null, pathname: string): boolean {
  if (!role) return false;
  const allowed = ROLE_ALLOWED[role];
  return allowed.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ============================================================
// [任务 18] 商家端 helper — merchantId 强制从 session 读，禁止 form 入参
// ============================================================

/**
 * RSC / Server Action 入口守卫：必须是登录用户 + role=merchant + merchantId 非空。
 *
 * 不接受任何 form 参数。merchantId 只从 session.userId 反查的 User.merchantId 来。
 *
 * 返回结构：{ user, merchantId }
 * - user : 当前账号（用于审计日志 / 模板展示）
 * - merchantId : 强绑的商家业务编码（M001/M002/M003），所有查询 SQL 都强制带这个
 */
export interface RequireMerchantResult {
  user: AuthenticatedUser;
  merchantId: string;
}

/**
 * 检查当前用户是 merchant 角色且绑定了非空 merchantId。
 * 失败 throw — 调用方在 page.tsx 用 try/catch redirect。
 *
 * 关键：merchantId 形参**不存在** — 永远从 session 读。CLAUDE.md P0-6 越权防控。
 */
export async function requireMerchant(): Promise<RequireMerchantResult> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  if (user.role !== "merchant") {
    throw new Error("FORBIDDEN_NOT_MERCHANT");
  }
  if (!user.merchantId) {
    // merchant 角色必须有 merchantId（防 orphan 账号）
    throw new Error("MERCHANT_NOT_BOUND_TO_MERCHANT_ID");
  }
  return { user, merchantId: user.merchantId };
}
