// 登录保护 — [账号阶段] 2026-06-29 引入。
//
// 设计：
// - 三种角色：admin / worker / customer
// - User 模型（Prisma）存账号；MVP 阶段密码明文（按需求）
// - cookie：o2o_session 存 userId，o2o_role 存 role
//   - httpOnly: 防 XSS 偷 cookie
//   - 30 天过期
//
// 不做（按需求）：
// - 不做密码哈希（MVP 接受）
// - 不做注册 / 找回密码 / OAuth / 短信验证码
// - 不做 RBAC 权限表（粗粒度按 role 分组）
// - 不签名 cookie（dev 演示接受；生产建议 JWT）

import { cookies } from "next/headers";
import { prisma } from "./db";

export const SESSION_COOKIE = "o2o_session";
export const ROLE_COOKIE = "o2o_role";

export type Role = "admin" | "worker" | "customer";

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
  "/dispatch-rules",
  "/admin",
  "/worker",
  "/customer/orders",
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
};

/** 角色可访问的路径前缀 */
export const ROLE_ALLOWED: Record<Role, string[]> = {
  admin: [
    "/dashboard",
    "/orders",
    "/services",
    "/masters",
    "/dispatch-rules",
    "/admin",
  ],
  worker: ["/worker"],
  customer: ["/customer", "/customer/orders"],
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
}

/**
 * 校验账号 + 返回用户信息
 * - 支持 username 或 phone 登录
 * - 明文比对（按需求 — MVP）
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
  if (user.password !== password) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role as Role,
    phone: user.phone,
    workerId: user.workerId,
  };
}

// ============================================================
// 服务端读 cookie（用于 server component / server action）
// ============================================================

export async function getSession(): Promise<AuthenticatedUser | null> {
  const c = await cookies();
  const userId = c.get(SESSION_COOKIE)?.value;
  const role = c.get(ROLE_COOKIE)?.value as Role | undefined;
  if (!userId || !role) return null;
  // 不再查 DB（cookie 已存必要信息；演示期信任 cookie 内容）
  return {
    id: userId,
    name: "", // cookie 没存 name；如需要查 DB
    role,
    phone: null,
    workerId: null,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const s = await getSession();
  return s !== null;
}

/** 完整读取（含 name / phone / workerId）— 供页面用 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const s = await getSession();
  if (!s) return null;
  const user = await prisma.user.findUnique({ where: { id: s.id } });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role as Role,
    phone: user.phone,
    workerId: user.workerId,
  };
}

// ============================================================
// 路径权限判断
// ============================================================

export function isProtectedPath(pathname: string): boolean {
  // 1. 根路径永远放行（首页 + 静态入口）
  if (pathname === "/") return false;

  // 2. 受保护优先（精确 + 前缀匹配）
  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isProtected) return true;

  // 3. 不受保护：默认放行（白名单模式 — 未列入 = 公开）
  // ⚠️ 反例：如果用黑名单模式（默认需登录），就把这里改成 return true
  // 当前：白名单模式（PROTECTED_PATHS 没列 = 放行）
  return false;
}

/** 给定路径 + 当前角色，是否可访问 */
export function canAccess(role: Role | null, pathname: string): boolean {
  if (!role) return false;
  const allowed = ROLE_ALLOWED[role];
  return allowed.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
