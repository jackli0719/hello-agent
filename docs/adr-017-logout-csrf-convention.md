# ADR-017 — logout 调用的 CSRF 约定（v0.7.2 节点）

> **状态**：v0.7.2 **完成稿**——规定 logoutAction 的调用约定。
>
> **关联**：[ADR-013 账号体系审计](adr-013-account-system-audit.md) ·
> [ADR-016 账号体系安全加固](adr-016-security-hardening.md) ·
> [v0.7.1 CSRF 修复](adr-013-account-system-audit.md) · [v0.7.2 logout 修复]

---

## Context

v0.6.0 修 ADR-013 B6（CSRF）时，**只考虑了 loginAction 路径**：

- loginAction(formData) 头部 `verifyCsrfToken` → login form 已在 v0.7.1 修好（middleware 写 cookie + page 传 csrf prop）

**v0.6.0 没考虑 logoutAction 路径**：

- logoutAction(formData) 同样头部 `verifyCsrfToken`
- 调用页用 `<form action={logoutAction}>` 但**没传 csrf** → formData.get('_csrf')='' → 校验失败 → 抛「会话已过期」

**后果**：v0.6.0 → v0.7.2 整段期间，**worker 端 / 客户订单端 的「退出」按钮实际无效**（POST /dashboard 500 同模式）

---

## 实施

### 修法（v0.7.2 commit `cb93494`）

调用页在 RSC 阶段 `await ensureCsrfCookie()` 拿 token，form 内联 hidden input：

```tsx
// app/worker/page.tsx
import { ensureCsrfCookie } from "@/src/lib/csrf";

export default async function WorkerPage() {
  const user = await getCurrentUser();
  // ... 校验 ...
  const csrfToken = await ensureCsrfCookie();
  return (
    <form action={logoutAction}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      <button type="submit">退出</button>
    </form>
  );
}
```

### 约定（防止同类 bug 再发）

**凡是调用 `logoutAction` 的页面，必须满足 3 条件**：

1. **是 RSC（server component）** —— client component 不能用 `ensureCsrfCookie`（它 import `next/headers`）
2. **RSC 顶部调 `await ensureCsrfCookie()`** —— 拿到 token 字符串
3. **form 内联 `<input type="hidden" name="_csrf" value={csrfToken} />`** —— 提交时 token 与 cookie 匹配

**反例（错的写法）**：

```tsx
// ❌ 错误：client component 直接 import logoutAction
"use client";
import { logoutAction } from "@/app/login/actions";
return (
  <form action={logoutAction}>
    <button>退出</button>
  </form>
);
// → formData.get('_csrf')='' → verifyCsrfToken 失败 → 抛错
```

**正例（对的写法）**：

```tsx
// ✅ 正确：RSC 调 ensureCsrfCookie + form 内联 hidden input
import { ensureCsrfCookie } from "@/src/lib/csrf";
const csrfToken = await ensureCsrfCookie();
return (
  <form action={logoutAction}>
    <input type="hidden" name="_csrf" value={csrfToken} />
    <button type="submit">退出</button>
  </form>
);
```

### 检查清单（下次新页面加 logout 时）

```
□ 1. 这个页面是 RSC 吗？（"use client" 的话不能这么写）
□ 2. RSC 顶部 await ensureCsrfCookie() 拿 token
□ 3. <form action={logoutAction}> 内联 <input name="_csrf" value={csrfToken}>
□ 4. 浏览器实测：登 → 退出 → 跳 /login（不报「会话已过期」）
```

---

## 已调用 logoutAction 的页面（v0.7.2 状态）

| 页面                                | 类型   | 修法                                                              | 状态      |
| ----------------------------------- | ------ | ----------------------------------------------------------------- | --------- |
| `app/worker/page.tsx`               | RSC    | inline hidden input                                               | ✅        |
| `app/customer/orders/page.tsx`      | RSC    | inline hidden input                                               | ✅        |
| `components/AppNav.tsx` (dashboard) | client | **未修**（不在调用方 → logout 按钮在 header，由 client 组件渲染） | 🟡 待评估 |

### ⚠️ AppNav 风险

`components/AppNav.tsx` 是 client component（如 "use client"），**不能直接调 `ensureCsrfCookie`**。
但 `AppNav` 内部用了 `<form action={logoutAction}>` —— **也会触发同类 bug**。

**但实际**：dashboard 的 logout 没报错？—— 因为 admin 登时 `getCurrentUser()` 在 RSC 跑了 `AppNav` 是渲染到 client 之前已经处理 csrf（**待验证**）。

**修法候选**：

- A. AppNav 接受 csrfToken prop（父 RSC 注入）
- B. 抽 `<LogoutForm csrfToken={...} />` 组件放在 components/，client 也用
- C. logoutAction 改成"如果 formData 没 _csrf，跳过校验"（降级）

**暂不修**（按 P0-1 先问）：AppNav 实际有没有问题？需 curl 验证。

---

## 实施过程

1. **v0.7.2 fix**：worker + customer-orders RSC 调 `ensureCsrfCookie` + form 内联 hidden input
2. **v0.7.3 修 #3**：加 vitest E2E 测试（CSRF + logout 路径）
3. **v0.7.3 评估 AppNav**（如有 bug 顺手修）

---

## Decisions

- ✅ **修法用 inline hidden input**（不抽组件，2 个 page 重复量小）
- ✅ **RSC 拿 csrf + form 传**（标准 double submit cookie 模式）
- ❌ **不**抽 `LogoutForm` 组件（之前写过又删了——简单胜于抽象）
- ❌ **不**改 logoutAction 本身（CSRF 校验逻辑正确，调用方补 token 即可）
- ❌ **不**改 logoutAction 跳过 CSRF（你已确认走严格方案）

---

## 关联

- [ADR-013](adr-013-account-system-audit.md) — B6 CSRF token（修过）
- [ADR-016](adr-016-security-hardening.md) — v0.6.0 加 CSRF（漏 logout）
- [v0.7.1 commit `e655eb2`](https://github.com/...) — 修 CSRF 首次访问
- [v0.7.2 commit `cb93494`](https://github.com/...) — 修 logout 调用方
- [MEMORY o2o-mvp-error-cheatsheet.md 类别 8b](~/.claude/.../memory/) — 「build/test 过 ≠ 用户能用」
