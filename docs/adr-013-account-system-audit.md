# ADR-013 — 账号体系阶段审计 + 风险清单（v0.3.0 节点）

> **状态**：v0.3.0 **完成稿 + 审计稿**——账号体系阶段实施 + 风险全清单。
>
> **关联**：ADR-002（三端共享 + mock 鉴权 → 升级为四端 cookie + 角色分组）·
> [HARNESS.md](HARNESS.md)（v0.3.x 阶段记录）·
> [ARCHITECTURE.md](ARCHITECTURE.md)（User 模型 + 角色权限矩阵）

---

## Context

v0.1.0 ~ v0.2.7 阶段鉴权 = mock 硬编码（`admin / admin123`，`o2o_session=1`）。
v0.3.0 升级为：

1. **User 模型**（Prisma）+ 三角色（admin / worker / customer）
2. **cookie 存 userId + role**（不再是 `"1"`）
3. **middleware 按角色权限分组**
4. **师傅端 / 用户端按登录用户隔离数据**

按需求「不做注册 / 找回密码 / OAuth / 短信验证码 / 复杂 RBAC」——只做最小可用。

---

## 实施内容

### 1. User 模型

```prisma
model User {
  id        String   @id @default(cuid())
  name      String   @unique               // 登录账号：admin / worker1 / customer1
  phone     String?                        // customer/worker 绑手机号
  password  String                         // # MVP: 明文存（按需求）
  role      String                         // admin | worker | customer
  workerId  String?   @unique              // role=worker 时绑 Master.id
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  worker    Master?  @relation(fields: [workerId], references: [id])

  @@index([role])
  @@index([phone])
}
```

### 2. seed 三个测试账号

| name      | password    | role     | phone                     | workerId               |
| --------- | ----------- | -------- | ------------------------- | ---------------------- |
| admin     | admin123    | admin    | null                      | null                   |
| worker1   | worker123   | worker   | MOCK_TECHNICIANS[0].phone | MOCK_TECHNICIANS[0].id |
| customer1 | customer123 | customer | 13900000099               | null                   |

### 3. 角色权限矩阵

| 角色         | 默认跳转           | 可访问路径                                                               |
| ------------ | ------------------ | ------------------------------------------------------------------------ |
| **admin**    | `/dashboard`       | `/dashboard` `/orders` `/services` `/masters` `/dispatch-rules` `/admin` |
| **worker**   | `/worker`          | `/worker` `/worker/orders/[id]`                                          |
| **customer** | `/customer/orders` | `/customer` `/customer/orders`                                           |

未登录访问任何受保护路径 → 302 `/login?next=<原路径>`。

### 4. cookie 机制

```
o2o_session  =  userId     ← cuid
o2o_role     =  role       ← admin | worker | customer
```

两个 cookie 同源、同 maxAge（30 天）、同 COOKIE_OPTIONS（httpOnly + sameSite=lax）。
**不是两 session**——是「同一会话的两个字段」。

### 5. 数据隔离

- **师傅端**：`/worker` 按 `user.workerId` 调 `listOrdersForMaster(workerId)`，自动过滤该师傅订单
- **师傅详情**：`/worker/orders/[id]` 按 `user.workerId` 校验越权（订单不属于该 worker → 404）
- **用户端**：`/customer/orders` 按 `user.phone` 调 `listOrdersForCustomerPhone(phone)`

---

## 审计结果（v0.3.0 实跑）

### 🔴 P0 必修 — 安全/数据正确性

#### A1 · 密码明文存 + 明文比对

- **位置**：`prisma/schema.prisma:90` + `src/lib/auth.ts:96`
- **代码**：`if (user.password !== password) return null;`
- **风险**：数据库泄露 = 所有账号密码直接暴露
- **状态**：演示期接受（schema 标注 `# MVP`）
- **上线前必修**：换 `bcrypt.hash(password, 10)` + `bcrypt.compare`

#### A2 · cookie 不签名

- **位置**：`src/lib/auth.ts:84-92`
- **代码**：`c.set(SESSION_COOKIE, user.id, COOKIE_OPTIONS);`
- **风险**：用户改 cookie `o2o_role=admin` 即获 admin 权限
- **状态**：演示期接受
- **上线前必修**：用 `iron-session` 或 `jose` 库签名/加密

#### A3 · 无登录错误次数限制

- **位置**：`app/login/actions.ts:loginAction`
- **代码**：失败直接 return `{ ok: false, error }`，无任何限流
- **风险**：暴力破解（每秒试 100 次，无锁）
- **状态**：演示期接受
- **上线前必修**：同 IP 5 次/分钟失败锁（用 Redis 或内存计数器）

#### A4 · `/customer` 下单不创建 User

- **位置**：`app/customer/page.tsx`（未改动）
- **状态**：按需求「保留演示便利」/「不做注册」
- **风险**：新客户下单后**没法登录**看自己的订单（UX 断裂）
- **临时方案**：演示场景下让人先 `/customer` 下个单再用 customer1 登录看

#### A5 · `/customer` 公开下单 → 别人可用 customer1 手机号占订单

- **位置**：`app/customer/actions.ts`
- **风险**：演示期 OK；上线就是隐私漏洞（任何人都能下 customer1 名义的订单）
- **上线前必修**：下单时校验 phone 是否对应登录用户（如果登录）

#### A6 · `canAccess` 路径匹配前缀漏洞

- **位置**：`src/lib/auth.ts:isProtectedPath` / `canAccess`
- **代码**：`startsWith(p + "/")`
- **风险**：`/dashboardx` 或 `/workerx` 是否被当合法？
  - `startsWith("/dashboard/")` → `/dashboardx` 不匹配 ✓
  - **实际 OK**，因为 `+ "/"` 防误伤
- **状态**：已安全（验证过）

---

### 🟡 P1 建议修 — 可用性/合规

#### B1 · 删除 User 后旧 session 仍可用

- **位置**：`middleware.ts:8-13`
- **代码**：只读 cookie，不查 DB 校验 User 是否仍存在
- **风险**：离职员工被禁用账号后还能登录
- **临时方案**：演示期接受
- **建议**：middleware 解析 userId 后查 DB 一次（性能成本可接受）

#### B2 · `name` 用作登录账号（`@unique`）

- **位置**：`prisma/schema.prisma:86`
- **风险**：重名用户无法注册
- **上线建议**：换 phone 或 email 作登录账号

#### B3 · 没有 session 失效机制

- **位置**：同上
- **风险**：改了密码后旧 cookie 仍能登
- **建议**：DB 加 session 表 / cookie 加 version 字段

#### B4 · 登录跳转 next 没白名单

- **位置**：`app/login/actions.ts:24-28`
- **代码**：`const nextParam = String(formData.get("next") ?? "");`
- **风险**：恶意链接 `/login?next=//evil.com` 会让用户登后跳外站
- **已加 canAccess 防跨角色**，但同角色内可任意跳
- **建议**：next 只接受相对路径（`startsWith("/")` 且不含 `//`）

#### B5 · 没 Secure cookie

- **位置**：`src/lib/auth.ts:COOKIE_OPTIONS`
- **代码**：未设 `secure: true`
- **风险**：HTTP 站 cookie 可被网络读取
- **dev 跑 HTTP 故意不开**，生产部署前必须开

#### B6 · 退出无 CSRF 保护

- **位置**：`app/login/actions.ts:logoutAction`
- **风险**：恶意页面 form 提交能让你退出
- **建议**：CSRF token（生产前必做）

#### B7 · role 用 String 而非 enum

- **位置**：`prisma/schema.prisma:91`
- **风险**：应用层无类型约束；写错 role 不会报错
- **项目惯例**：所有 status 字段都用 String + 应用层校验（ADR-005），一致
- **建议**：维持现状；TS 类型兜底

---

### 🟢 P2 可选 — 技术债

#### C1 · 两个 cookie 合成一个 JSON cookie

- **位置**：`src/lib/auth.ts:SESSION_COOKIE + ROLE_COOKIE`
- **建议**：合并 `o2o_session` = JSON `{userId, role}`，更原子
- **不修原因**：当前实现简单可用

#### C2 · 没登录日志

- **位置**：auth flow
- **风险**：出事查不到谁登过 / 失败几次
- **建议**：加 logger.ts 埋点（login.success / login.failed）

#### C3 · 没并发登录控制

- **风险**：同一账号多设备登录没限制
- **建议**：DB 加 session 表 + 列表展示

#### C4 · 没 IP 异常检测

- **风险**：异地登录无感知
- **建议**：登录记录 IP，异常时发通知

#### C5 · `/customer/orders` 只按 phone 过滤

- **位置**：`app/customer/orders/page.tsx`
- **风险**：别人改你下单时填的电话 → 看不到你的订单
- **演示期可接受**（订单创建时也按 phone 存）
- **上线建议**：Order 加 `userId` 字段，强制关联

---

## 上线前必修清单（按 A1-A5 排序）

| #   | 项                                | 工作量估计 |
| --- | --------------------------------- | ---------- |
| 1   | 密码哈希（bcrypt）                | 0.5h       |
| 2   | cookie 签名/加密（iron-session）  | 1h         |
| 3   | 登录限流（Redis 或内存）          | 1h         |
| 4   | `/customer` 下单绑定登录用户      | 1h         |
| 5   | session 失效机制（DB session 表） | 2h         |
| 6   | next 路径白名单                   | 0.5h       |
| 7   | Secure cookie + CSRF token        | 1h         |

总计 ~7h agent 工作量（按 AI Agent 估算）。

---

## Decisions（决策记录）

- ✅ **用两个 cookie 而非 JSON cookie**——简单、httpOnly 单值
- ✅ **用 `name` 作登录账号**——演示便利；上线前换 phone
- ✅ **role 用 String 而非 enum**——跨方言 + 项目惯例
- ✅ **不支持多角色同账号**——User.role 是单值
- ✅ **`/customer` 保留公开**——按需求
- ✅ **师傅端按 workerId 强隔离**——worker1 只能看自己订单
- ✅ **用户端按 phone 强过滤**——演示期可接受
- ❌ **不做**注册 / 找回密码 / OAuth / 短信验证码 / 复杂 RBAC（按需求）
- ❌ **不做**密码哈希（按需求 #MVP）
- ❌ **不重构**已有业务代码（按需求）

---

## How to apply

**新会话接手账号体系工作时**：

1. 读本 ADR → 知道做了啥 + 风险在哪
2. 修任何 A1-A5 项前 → **先做 ADR-014 单独记录**（避免小改动也写在 ADR-013 找不到）
3. 加新角色 / 改权限矩阵 → 改 `ROLE_ALLOWED` + `canAccess` + 补测试

---

**关联**：

- [ARCHITECTURE.md §4 数据模型](ARCHITECTURE.md) — User 模型 + 关系图
- [HARNESS.md §v0.3.x 阶段](HARNESS.md) — 实施过程
- [[o2o-mvp-error-cheatsheet]] — 跨会话风险速查（已同步本 ADR）
