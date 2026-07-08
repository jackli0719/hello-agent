# ADR-016 — 账号体系安全加固（v0.6.0 节点）

> **状态**：v0.6.0 **完成稿**——A2 cookie 签名 + B4 next 白名单 + B6 CSRF token。
>
> **关联**：[ADR-013 账号体系审计](adr-013-account-system-audit.md) ·
> [ADR-015 v0.5.0 修 A1+A3+A5](adr-015-p0-risk-fixes.md) ·
> [HARNESS.md](HARNESS.md)

---

## Context

ADR-013 列了 18 条风险。v0.5.0 修了 A1+A3+A5 三条 P0。
v0.6.0 继续修 **A2 P0** + **B4 + B6 P1**。

剩余：

- A4 按需求保留
- A6 已安全
- B1/B3 session 表（架构级）
- B2/B5/B7 P1（次要）
- C1-C5 P2

---

## 实施内容

### A2 cookie 签名（iron-session）— 修 ADR-013 A2 P0

| 维度                | 详情                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **库**              | `iron-session@8.0.4`（A256-GCM + 32 字节 secret）                                                                      |
| **session 内容**    | `{ userId, role }` 单一 cookie（替代之前的 `o2o_session` + `o2o_role` 双 cookie）                                      |
| **secret**          | `.env` 存 `SESSION_SECRET=32+ 字符`；dev 用 placeholder，生产 `openssl rand -hex 32`                                   |
| **secure**          | `NODE_ENV=production` 时强制 `secure: true`（B5 顺手做）                                                               |
| **改的文件**        | `src/lib/auth.ts`（getSession 改 iron-session API）+ `app/login/actions.ts`（save/destroy）+ `middleware.ts`（简化版） |
| **middleware 简化** | Edge runtime 兼容问题，middleware 只判断「cookie 存在」；完整解密在 RSC 走 getSession                                  |

```ts
// auth.ts
const session = await getSession();
session.userId = user.id;
session.role = role;
await session.save(); // 签名 + 加密 → 写 o2o_session cookie
```

### B4 next 白名单 — 修 ADR-013 B4 P1

| 维度         | 详情                                      |
| ------------ | ----------------------------------------- |
| **场景**     | 登录跳转 `?next=//evil.com` open redirect |
| **校验**     | `startsWith("/")` 且 `!startsWith("//")`  |
| **改的文件** | `app/login/actions.ts`                    |

```ts
if (nextParam) {
  if (!nextParam.startsWith("/") || nextParam.startsWith("//")) {
    target = DEFAULT_LANDING[role];
  } else if (!canAccess(role, nextParam)) {
    target = DEFAULT_LANDING[role];
  }
}
```

### B6 CSRF token — 修 ADR-013 B6 P1

| 维度          | 详情                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **模式**      | double submit cookie                                                  |
| **库**        | `node:crypto.randomBytes(32)`                                         |
| **cookie**    | `o2o_csrf`（非 httpOnly，client JS 可读）                             |
| **form 字段** | `_csrf`                                                               |
| **新文件**    | `src/lib/csrf.ts` + `src/lib/csrf-constants.ts`（拆常量给 client 用） |
| **接入**      | `loginAction` + `logoutAction` 头部 `verifyCsrfToken`                 |
| **同源策略**  | SameSite=lax 隐式覆盖，不另做 Origin 校验                             |

```ts
// 校验
const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
if (!(await verifyCsrfToken(csrfToken))) {
  return { ok: false, error: "会话已过期" };
}
```

### B5 Secure cookie（顺手）

`getSessionOptions().cookieOptions.secure = process.env.NODE_ENV === "production"`，dev 跑 HTTP 不报错，prod 强制 HTTPS-only。

---

## 实施过程（按时序）

1. **B4 next 白名单**（0.5h）— 改 `loginAction` 加 2 行校验
2. **B6 CSRF token**（1h）— 写 `csrf.ts` + `csrf-constants.ts`；接入 login/logout；client login page 读 cookie + form hidden input
3. **A2 iron-session**（2h）— install + 改 auth.ts + 改 actions + middleware 简化 + .env 配 secret
4. 修 build 错误（client 引 next/headers → 拆 csrf-constants）
5. 修 ESLint（setState in effect → queueMicrotask）
6. 修测试（getSession API 变 IronSession → 调 userId）
7. **验证**：`check` + `test` + `build`

---

## 测试结果

| 测试项          | 结果                            |
| --------------- | ------------------------------- |
| `npm run check` | ✅ TS + paths + spec + process  |
| `npm run test`  | ✅ **246/246 通过**             |
| `npm run build` | ✅ 22 路由 + Middleware 54.7 kB |
| `db:reset`      | ✅ seed 3 个 bcrypt 哈希账号    |

---

## 剩余风险（ADR-013 + ADR-014）

### 🔴 P0 剩余

| #   | 风险                      | 等级          |
| --- | ------------------------- | ------------- |
| A4  | /customer 下单不创建 User | 🟢 按需求保留 |
| A6  | canAccess 前缀漏洞        | 🟢 已安全     |

### 🟡 P1 剩余

| #   | 风险                          | 工作量           |
| --- | ----------------------------- | ---------------- |
| B1  | 删除 User 后旧 session 仍可用 | 2h（session 表） |
| B2  | name 用作登录账号（@unique）  | 0.5h             |
| B3  | 没有 session 失效机制         | 2h               |
| B7  | role 用 String 而非 enum      | 0.5h             |

### 🟢 P2 剩余（13 条 ADR-014 + 5 条 ADR-013）

---

## Decisions

- ✅ **iron-session 而非手写 JWT** — 库封装好加密/签名/版本管理
- ✅ **单一 session cookie**（之前是 o2o_session + o2o_role 两个）— 简化
- ✅ **middleware 简化**（只判 cookie 存在）— 完整解密靠 RSC
- ✅ **CSRF double submit**（非 per-session token）— 演示够用
- ✅ **csrf-constants 拆文件**（避开 client 引 next/headers）
- ✅ **B5 secure 跟随 NODE_ENV**（dev 不强制）
- ✅ **B4 双层校验**（startsWith + canAccess）
- ❌ **不**做 B1/B3（架构级）
- ❌ **不**做 per-session CSRF token（演示用 cookie token 足够）

---

**关联**：

- [ADR-013](adr-013-account-system-audit.md) — 18 条风险原始清单
- [ADR-015](adr-015-p0-risk-fixes.md) — v0.5.0 修 A1+A3+A5
- [HARNESS.md](HARNESS.md) — v0.6.x 节点
