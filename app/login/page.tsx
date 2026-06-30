// 登录页 — [v0.7.1] 修 CSRF「会话已过期」bug
//
// [Next.js 15 限制] RSC 不能写 cookie — 之前 ensureCsrfCookie 在 page 里报
// "Cookies can only be modified in a Server Action or Route Handler"
//
// [修法] csrf cookie 写入移到 middleware（访问 /login 时自动写）
// 这里只读 cookie + 传 prop 给 client form。

import { Suspense } from "react";
import { cookies } from "next/headers";
import { CSRF_COOKIE } from "@/src/lib/csrf-constants";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  // [v0.7.1] 读 csrf cookie（middleware 已写）
  // 注意：page 是 RSC，cookies() 在这里**可读**但不可写
  let csrfToken = "";
  try {
    const c = await cookies();
    csrfToken = c.get(CSRF_COOKIE)?.value ?? "";
  } catch {
    // 脚本上下文（无 request）→ 空字符串
  }

  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f7f8fa",
            color: "#9ca3af",
          }}
        >
          加载中…
        </main>
      }
    >
      <LoginForm csrfToken={csrfToken} />
    </Suspense>
  );
}
