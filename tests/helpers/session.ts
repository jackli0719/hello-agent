// [任务 18] 集成测试 session helper — 给 getCurrentUser 注入已登录态
//
// 用法（必须在测试文件**最顶部** import 时调 `mockNextHeaders`）：
//
//   import { mockNextHeaders } from "./session";
//   mockNextHeaders();
//
//   import { getCurrentUser } from "@/src/lib/auth";
//   import { setSessionCookie, clearSessionCookie } from "./session";
//
// 关键：iron-session getServerActionCookie 同步调 cookieHandler.get(name)，
// 不 await。所以 cookies().get() 必须是**同步**函数，value 是已生成的 seal。
// sealData 是 async — 必须在 setSessionCookie 阶段 await 生成，存进 store。
//
// 必须在 import 阶段调 mockNextHeaders（vi.mock hoist）！

import { vi } from "vitest";
import { sealData } from "iron-session";

const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  "dev-only-do-not-use-in-production-32chars-min-aaaa";

const SESSION_COOKIE = "o2o_session";

interface SessionStore {
  userId: string | null;
  role: string | null;
  /** 预先生成的合法 iron-session seal — iron-session 同步调 get 时直接用 */
  seal: string | null;
}

const store: SessionStore = {
  userId: null,
  role: null,
  seal: null,
};

/**
 * 设置测试 session（必须在调 page / action 之前调）
 *
 * @param userId User.id（不是 name）
 * @param role  "admin" | "worker" | "customer" | "merchant"
 */
export async function setSessionCookie(
  userId: string,
  role: string,
): Promise<void> {
  store.userId = userId;
  store.role = role;
  // sealData 异步 — 提前 await 生成 seal 存进 store
  // iron-session 内部 unsealData 时会用同样的 password
  store.seal = await sealData(
    { userId, role },
    { password: SESSION_SECRET, ttl: 60 * 60 * 24 * 30 },
  );
}

/** 清空 session（恢复未登录） */
export function clearSessionCookie(): void {
  store.userId = null;
  store.role = null;
  store.seal = null;
}

/**
 * Mock next/headers — **必须在测试文件最顶部 import 时**调
 *
 * vi.mock 会被 vitest hoist 到该文件所有 import 之前
 */
export function mockNextHeaders(): void {
  vi.mock("next/headers", () => ({
    cookies: async () => ({
      // # spec: iron-session getServerActionCookie 同步调 get(name) — 不 await
      // 所以这里必须同步返回，且 value 是预先生成的 seal
      get: (name: string) => {
        if (name === SESSION_COOKIE && store.seal) {
          return { value: store.seal };
        }
        return undefined;
      },
      set: () => {},
      delete: () => {},
      has: () => false,
      getAll: () => [],
    }),
  }));
}
