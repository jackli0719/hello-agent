// CSRF 共享常量 — 拆出来避免 client component 引入 next/headers
// （csrf.ts 用 next/headers 的 cookies()，不能 import 到 client）

export const CSRF_COOKIE = "o2o_csrf";
export const CSRF_FORM_FIELD = "_csrf";
