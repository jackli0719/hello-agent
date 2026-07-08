# ADR-015 — v0.3.0 列 P0 风险修复（v0.5.0 节点）

> **状态**：v0.5.0 **完成稿**——ADR-013 列的 18 条 P0 风险中修了 3 条。
>
> **关联**：[ADR-013 账号体系审计](adr-013-account-system-audit.md) ·
> [HARNESS.md](HARNESS.md)（v0.5.x 节点）·
> [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Context

ADR-013 列了 18 条风险（A1-A6 P0 + B1-B7 P1 + C1-C5 P2）。
v0.5.0 修了 3 条 P0：

- **A1** 密码明文存
- **A3** 无登录限流
- **A5** `/customer` 公开下单 → 隐私漏洞

剩余：

- A2 cookie 不签名（修要引入 iron-session，影响面大）
- A4 /customer 下单不创建 User（按需求保留）
- A6 canAccess 前缀漏洞（已安全）
- B1-B7 P1 7 条
- C1-C5 P2 5 条

---

## 实施内容

### A1 密码哈希（bcrypt）

| 维度         | 详情                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| **库**       | `bcryptjs@3.0.3`（纯 JS，无原生编译）                                   |
| **rounds**   | 10（演示足够；线上生产用 12）                                           |
| **改的文件** | `prisma/seed.ts`（hash 三账号） + `src/lib/auth.ts`（`bcrypt.compare`） |
| **迁移策略** | dev 库 `db:reset` 重生；不迁移旧明文账号                                |
| **回滚**     | `git revert` —— seed 重跑会用回明文                                     |

```ts
// src/lib/auth.ts
const passwordOk = await bcrypt.compare(password, user.password);
if (!passwordOk) return null;
```

### A3 登录限流

| 维度       | 详情                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **存储**   | in-memory `Map<ip, AttemptRecord>`（生产换 Redis）                                             |
| **阈值**   | 5 次/分钟                                                                                      |
| **锁定**   | 60 秒                                                                                          |
| **Key**    | IP（从 `x-forwarded-for` / `x-real-ip` 取，dev 退化为 `local`）                                |
| **新文件** | `src/lib/login-rate-limit.ts`                                                                  |
| **接入**   | `app/login/actions.ts` 在 `authenticate` 前后调 `isLocked` / `recordFailure` / `clearAttempts` |

```ts
// 失败一次
const fail = recordFailure(ip);
if (fail.locked) return { ok: false, error: "已锁定 60 秒" };
return { ok: false, error: `还剩 ${fail.attemptsLeft} 次` };

// 成功
clearAttempts(ip);
```

### A5 customer 下单校验

| 维度         | 详情                                              |
| ------------ | ------------------------------------------------- |
| **场景**     | customer 已登录时，下单 phone 必须等于 user.phone |
| **改的文件** | `app/customer/actions.ts`                         |
| **未登录**   | 仍允许（按需求保留 `/customer` 公开下单）         |
| **错误**     | 「已登录账号绑定的手机号是 X，请用该手机号下单」  |

```ts
const currentUser = await getCurrentUser();
if (currentUser?.role === "customer" && currentUser.phone) {
  if (customerPhone !== currentUser.phone) {
    return { ok: false, error: "...", field: "customerPhone" };
  }
}
```

---

## 实施过程（按时序）

1. **A1 bcrypt** — 选 `bcryptjs`（纯 JS）+ rounds=10；seed 改 3 个账号 hash；auth.ts `compare` 替代 `!==`
2. **A3 login rate limit** — 写 `login-rate-limit.ts`（in-memory Map）+ 接 `loginAction`（check before / record on fail / clear on success）
3. **A5 customer phone** — `customerCreateOrderAction` 头部加 `getCurrentUser()` + 校验
4. **验证**：`npm run check` + `test` + `build` + `db:reset`

---

## 测试结果

| 测试项          | 结果                                  |
| --------------- | ------------------------------------- |
| `npm run check` | ✅ TS + paths + spec + process 全过   |
| `npm run test`  | ✅ **246/246 通过**                   |
| `npm run build` | ✅ 22 路由全编译 + Middleware 54.8 kB |
| `db:reset`      | ✅ seed 3 个 bcrypt 哈希账号          |

---

## 剩余风险（ADR-013 的 15 条）

### 🔴 P0 剩余

| #   | 风险                      | 等级      | 工作量             |
| --- | ------------------------- | --------- | ------------------ |
| A2  | cookie 不签名             | 🟠 高     | 2h（iron-session） |
| A4  | /customer 下单不创建 User | 🟢 保留   | — 按需求           |
| A6  | canAccess 前缀漏洞        | 🟢 已安全 | —                  |

### 🟡 P1 剩余

| #   | 风险                             | 工作量                         |
| --- | -------------------------------- | ------------------------------ |
| B1  | 删除 User 后旧 session 仍可用    | 2h（session 表）               |
| B2  | `name` 用作登录账号（`@unique`） | 0.5h                           |
| B3  | 没有 session 失效机制            | 2h                             |
| B4  | 登录跳转 next 没白名单           | 0.5h（**小工作量，建议先做**） |
| B5  | 没 Secure cookie                 | 0.5h（跟随 A2）                |
| B6  | 退出无 CSRF 保护                 | 1h（简易 token）               |
| B7  | role 用 String 而非 enum         | 0.5h                           |

### 🟢 P2 剩余（13 条 ADR-014 + 5 条 ADR-013）

---

## Decisions

- ✅ **bcrypt rounds = 10** —— 演示期够用；生产改 12
- ✅ **bcryptjs 而非 bcrypt** —— 纯 JS，无原生编译问题
- ✅ **in-memory Map 限流** —— 演示期单实例够；生产换 Redis（改 1 行）
- ✅ **5 次/60 秒阈值** —— 演示可见；生产 3 次/15 分钟
- ✅ **IP 取自 x-forwarded-for** —— 兼容 Vercel/Cloudflare
- ✅ **A4 按需求保留** —— 不修
- ✅ **A5 只挡已登录** —— 未登录用户仍可公开下单（按需求）
- ❌ **不做**A2（iron-session 改动大，影响面广，单独 v0.6.0 阶段）
- ❌ **不做**B1/B3（session 表，架构级改动）

---

**关联**：

- [ADR-013 账号体系审计](adr-013-account-system-audit.md) — 18 条风险原始清单
- [HARNESS.md](HARNESS.md) — v0.5.x 节点
- [[o2o-mvp-error-cheatsheet]] — 跨会话风险速查
