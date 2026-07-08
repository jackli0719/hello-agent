# PostgreSQL 迁移评估

> **目的**：评估 O2O MVP 从 SQLite 迁移到 PostgreSQL 的工作量、风险和方案。
> **当前状态**：**未迁移**。本文档是**评估和准备**，不是执行计划。
> **关联文档**：[README.md](../README.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 目录

- [A. 当前数据库结构](#a-当前数据库结构)
- [B. PostgreSQL 兼容性检查](#b-postgresql-兼容性检查)
- [C. 预计需要修改的地方](#c-预计需要修改的地方)
- [D. Prisma datasource 修改方案](#d-prisma-datasource-修改方案)
- [E. 环境变量设计](#e-环境变量设计)
- [F. 数据迁移步骤](#f-数据迁移步骤)
- [G. 回滚方案](#g-回滚方案)
- [H. 部署影响对比](#h-部署影响对比)
- [I. 推荐方案](#i-推荐方案)
- [J. 风险清单](#j-风险清单)

---

## A. 当前数据库结构

### A.1 引擎信息

- **引擎**：SQLite 3
- **驱动文件**：`prisma/dev.db`（文件即数据库）
- **Prisma 版本**：`5.22.0`（见 `package.json`）
- **迁移方式**：`prisma db push`（**没有 `migrations/` 目录**，历史 schema 变更无版本记录）
- **Seed**：`prisma/seed.ts`（用 `tsx` 执行）

### A.2 模型清单

> 来源：`prisma/schema.prisma`。共 **5 个模型**（注意：没有 `User` / `ActivityLog` —— 用户和操作日志在 MVP 阶段是简化方案）。

| #   | 模型              | 中文     | 关键字段                                                                                                                                                                                         | 关系                                            |
| --- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | `ServiceCategory` | 服务类目 | `categoryCode`(unique) / `name`(unique) / `enabled` / `createdAt`                                                                                                                                | has many `ServiceSku`                           |
| 2   | `ServiceSku`      | 服务 SKU | `skuCode`(unique) / `name` / `categoryId` / `basePrice`(分) / `durationMinutes` / `requiredSkills`(JSON 字符串) / `enabled`                                                                      | belongs to `ServiceCategory` · has many `Order` |
| 3   | `Master`          | 师傅     | `name` / `phone` / `skills`(JSON 字符串) / `rating` / `completedJobs` / `status` / `serviceArea`                                                                                                 | has many `Order`                                |
| 4   | `Order`           | 订单     | `id`(业务订单号) / `customerName` / `customerPhone` / `serviceSkuId?` / `serviceName`(快照) / `masterId?` / `masterName`(快照) / `address` / `scheduledAt` / `amount`(分) / `status` / `remark?` | belongs to `ServiceSku?` + `Master?`            |
| 5   | `DispatchRule`    | 派单规则 | `name` / `priority` / `enabled` / `ruleJson`(JSON 字符串)                                                                                                                                        | —                                               |

### A.3 关键约束与索引

- **唯一约束**：`ServiceCategory.name` / `ServiceCategory.categoryCode` / `ServiceSku.skuCode`
- **索引**：
  - `ServiceSku(categoryId)`
  - `Master(status)`
  - `Order(status)` / `Order(scheduledAt)`
  - `DispatchRule(enabled, priority)`
- **枚举/字符串字段**（用 `String` + 应用层校验，**没有用 Prisma `enum`**）：
  - `Master.status`: `available` | `busy` | `offline`
  - `Order.status`: `pending` | `assigned` | `in_service` | `completed` | `cancelled`

### A.4 JSON 字段（字符串形式）

> ⚠️ 这些字段在 schema 里是 **`String` 类型**，存的是 JSON 序列化后的字符串（不是真正的 JSON 列）。应用层手动 `JSON.parse` / `JSON.stringify`。

| 字段             | 所在模型       | 写入位置                                 | 读取位置               |
| ---------------- | -------------- | ---------------------------------------- | ---------------------- |
| `skills`         | `Master`       | `src/lib/masters.ts` `parseSkillsString` | 同上                   |
| `requiredSkills` | `ServiceSku`   | 同上                                     | 同上                   |
| `ruleJson`       | `DispatchRule` | `app/dispatch-rules/actions.ts`          | `lib/dispatch.ts` 解析 |

### A.5 业务代码耦合情况

```
PrismaClient 引用点（grep 验证）：
- src/lib/db.ts                  ← 单例入口（dev 模式热重载防护）
- src/lib/repos/orders.ts        ← 只 import type，不直接 new
```

**结论**：业务代码**没有**直接调用 SQLite 专有 API（`better-sqlite3` / `sqlite3` / raw SQL）。数据库耦合**只在 schema 层**。

---

## B. PostgreSQL 兼容性检查

### B.1 schema 兼容性矩阵

| 项目                           | SQLite 现状 | PostgreSQL 兼容性               | 风险          |
| ------------------------------ | ----------- | ------------------------------- | ------------- |
| `provider = "sqlite"`          | ✓           | ❌ 必须改 `postgresql`          | 0（单点修改） |
| `url = "file:./dev.db"`        | ✓           | ❌ 必须改 `env("DATABASE_URL")` | 0             |
| `cuid()` 默认值                | ✓           | ✓ Prisma 兼容                   | 0             |
| `String` 字段                  | ✓ TEXT      | ✓ text/varchar                  | 0             |
| `Int` 字段（basePrice/amount） | ✓ INTEGER   | ✓ integer                       | 0             |
| `Float` 字段（rating）         | ✓ REAL      | ✓ double precision              | 0             |
| `Boolean` 字段                 | ✓ 0/1       | ✓ boolean                       | 0             |
| `DateTime` 字段                | ✓ TEXT/REAL | ✓ timestamp(3)                  | 0             |
| `@unique`                      | ✓           | ✓                               | 0             |
| `@@index`                      | ✓           | ✓ B-tree 默认                   | 0             |
| `@default(now())`              | ✓           | ✓                               | 0             |
| `@updatedAt`                   | ✓           | ✓                               | 0             |
| `String?`（可选）              | ✓ NULL      | ✓ NULL                          | 0             |
| 关系（`@relation`）            | ✓           | ✓                               | 0             |

### B.2 已知 SQLite 专有写法检查

- ❌ **未发现** `autoincrement` 关键字（用的是 `@default(cuid())`）—— 兼容
- ❌ **未发现** SQLite 类型注解（`@db.Text` / `@db.Blob`）—— 兼容
- ❌ **未发现** `JSON` 字段类型（用的是 `String` 存 JSON 字符串）—— 兼容
- ❌ **未发现** `Decimal` / `Numeric` 精度问题（金额用 `Int` 分）—— 兼容
- ❌ **未发现** raw SQL 写 SQLite 函数（`strftime` / `datetime`）—— 兼容
- ❌ **未发现** `MATCH` / `LIKE GLOB` 等方言 —— 兼容
- ❌ **未发现** 显式事务模式差异（Prisma 抽象掉了）—— 兼容
- ⚠️ **`@default("[]")`**：SQLite 用 `String` 存 `[]` 字面量；Postgres 同样 OK（text 字段存字面量）
- ⚠️ **大写大小写敏感性**：schema 注释明确说 "SQLite 不支持 `@db.Collate`，应用层是唯一防线"。**Postgres 默认大小写敏感**，但 `categoryCode` / `skuCode` 在应用层 `normalizeCode` 强制大写（`src/lib/codes.ts`）—— 风险 0

### B.3 Prisma 行为差异（迁移后需要重测）

| 行为                      | SQLite            | PostgreSQL            | 业务影响                             |
| ------------------------- | ----------------- | --------------------- | ------------------------------------ |
| 写并发                    | ≈ 1（文件锁）     | 数百                  | 并发派单性能提升                     |
| 事务隔离                  | `Serializable` 弱 | `Read Committed` 默认 | 乐观锁逻辑**可能需要重写**（见 J.2） |
| `updateMany` + where 条件 | OK                | OK                    | 乐观锁**仍然成立**                   |
| `prisma.$transaction`     | 嵌套限制          | 完整                  | 当前代码只用了 flat transaction，OK  |
| 时间戳精度                | 秒级              | 毫秒级                | `scheduledAt` 显示更精确             |
| 字符串排序                | `BINARY`          | `C` / `en_US.UTF-8`   | 当前业务不依赖 sort order            |

---

## C. 预计需要修改的地方

### C.1 必须改（schema 层）

| 文件                              | 修改                                                                                | 风险 |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---- |
| `prisma/schema.prisma`            | `provider` `sqlite` → `postgresql`<br>`url` `file:./dev.db` → `env("DATABASE_URL")` | 0    |
| `.env`（新建）                    | `DATABASE_URL="postgresql://..."`                                                   | 0    |
| `.env.example`（新建）            | 同上（**别把真连接串 commit**）                                                     | 0    |
| `package.json` 的 `db:reset` 脚本 | **可选**改成 `prisma migrate reset`（要 migrations）                                | 中   |
| `.gitignore`                      | 加 `.env`、保留 `dev.db` 忽略                                                       | 0    |

### C.2 应该改（流程层）

| 项                                 | 原因                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| **建立 `prisma/migrations/` 目录** | 当前用 `db push` 无历史版本。生产前**必须**切换到 `migrate dev` / `migrate deploy` |
| **README 部署章节**                | 当前部署文档已经写了大致步骤（`DEPLOYMENT.md` 第 3 节），需要更新更细              |
| **CI 流程**                        | 如果加 GitHub Actions，CI 里要拉 `DATABASE_URL` 跑测试                             |

### C.3 业务代码是否要改

| 类别                               | 答案           | 原因                               |
| ---------------------------------- | -------------- | ---------------------------------- |
| `src/lib/db.ts` 单例               | **不需改**     | `PrismaClient` 构造器不绑 provider |
| `src/lib/repos/*` 仓储             | **不需改**     | 全用 Prisma 抽象 API               |
| `src/lib/orders.ts` 等业务         | **不需改**     | 不接触 dialect-specific 行为       |
| `app/**/actions.ts` server actions | **不需改**     | 同上                               |
| `lib/dispatch.ts` 派单算法         | **不需改**     | 算法与 DB 无关                     |
| `prisma/seed.ts` 种子              | **可能要小调** | 见 C.4                             |
| `vitest.config.ts`                 | **不需改**     | 跑真 DB 即可                       |

### C.4 seed.ts 兼容性检查（建议阶段做一次实测）

> 本任务**不**实际跑 seed，只列可能需要调整的地方。

- ✅ 当前用 `prisma.category.create(...)` 等高层 API —— 跨方言兼容
- ⚠️ **`Date` 字段**：`scheduledAt: new Date(...)` 在 Postgres 里是 timestamp with time zone，时区可能显示不同 —— 用 ISO 字符串更稳
- ⚠️ **JSON 字符串字段**：`JSON.stringify(...)` 在两个 DB 都一样 —— OK
- ⚠️ **批量插入性能**：SQLite 跑 seed 几秒；Postgres 取决于网络延迟，**远程 DB 可能 10-30s** —— 可加分批

---

## D. Prisma datasource 修改方案

### D.1 单点修改（diff 形式）

```diff
 // prisma/schema.prisma
 datasource db {
-  provider = "sqlite"
-  url      = "file:./dev.db"
+  provider = "postgresql"
+  url      = env("DATABASE_URL")
 }
```

### D.2 改完后的本地验证步骤

```bash
# 1. 确认 .env 存在且 DATABASE_URL 指向真 Postgres
cat .env

# 2. 重新生成 client
npx prisma generate

# 3. 本地用 docker 起一个 Postgres（推荐方式）
docker run -d --name o2o-pg -p 5432:5432 \
  -e POSTGRES_USER=o2o -e POSTGRES_PASSWORD=o2o -e POSTGRES_DB=o2o \
  postgres:16-alpine

# 4. 推 schema 到 DB（**不**会建 migration）
DATABASE_URL=postgresql://o2o:o2o@localhost:5432/o2o npx prisma db push

# 5. 灌 seed
DATABASE_URL=postgresql://o2o:o2o@localhost:5432/o2o npm run db:seed

# 6. 跑测试
DATABASE_URL=postgresql://o2o:o2o@localhost:5432/o2o npm run test
```

### D.3 生产部署的正确做法（**先**有 migration）

```bash
# 一次性：建首个 migration（取代 db push）
npx prisma migrate dev --name init

# 提交：prisma/migrations/<timestamp>_init/migration.sql

# 部署时：
DATABASE_URL=<prod-url> npx prisma migrate deploy
```

---

## E. 环境变量设计

### E.1 变量清单

| 变量名                | 必需    | 说明                      | 示例                                                |
| --------------------- | ------- | ------------------------- | --------------------------------------------------- |
| `DATABASE_URL`        | ✅      | Prisma 连接串             | `postgresql://o2o:****@host:5432/o2o?schema=public` |
| `SHADOW_DATABASE_URL` | ⚠️ 推荐 | `migrate dev` 用的影子 DB | `postgresql://o2o:****@host:5432/o2o_shadow`        |

### E.2 文件策略

```
.env                ← 本地真值，gitignore
.env.example        ← 模板，commit（值留空或写占位）
.env.local          ← 备选（Next.js 自动读）
```

### E.3 `.env.example` 模板（建议）

```bash
# ====== PostgreSQL ======
# 本地 docker:
#   docker run -d --name o2o-pg -p 5432:5432 \
#     -e POSTGRES_USER=o2o -e POSTGRES_PASSWORD=o2o -e POSTGRES_DB=o2o \
#     postgres:16-alpine
#
# Neon / Supabase / Railway 都会给一个 postgresql:// 连接串，直接粘上
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public"

# 可选 — Prisma migrate dev 用的影子 DB（避免污染主库）
# 大部分托管服务会自动建一个 schema；本地手动建
SHADOW_DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME_shadow?schema=public"
```

### E.4 平台变量名差异

| 平台     | 环境变量设置入口                                      |
| -------- | ----------------------------------------------------- |
| Vercel   | Project → Settings → Environment Variables            |
| Railway  | Service → Variables → `DATABASE_URL`                  |
| Supabase | 自动注入 `DATABASE_URL` / `DIRECT_URL`（pooler 直连） |
| Neon     | 自动注入 `DATABASE_URL` / `DATABASE_URL_UNPOOLED`     |

---

## F. 数据迁移步骤

> 阶段 2 才执行。本节是**未来执行手册**。

### F.1 阶段化（推荐）

```
[阶段 0] 评估 + 准备         ← 当前位置 ✅
   ↓
[阶段 1] 改 schema + 本地 Postgres 跑通测试
   ↓
[阶段 2] 远程 Postgres 跑通 + 部署平台对接
   ↓
[阶段 3] 旧数据迁移（一次性脚本）
   ↓
[阶段 4] 切流量（双写/灰度/一次性切换）
   ↓
[阶段 5] 下线 SQLite
```

### F.2 旧数据迁移方案（**不**在本任务执行）

| 方案                    | 工具                                    | 适合                 | 风险                        |
| ----------------------- | --------------------------------------- | -------------------- | --------------------------- |
| **A. Prisma 内置 dump** | `prisma db pull` + `db push`            | 表结构简单、数据量小 | ❌ 不保留数据               |
| **B. ETL 脚本**         | 自己写 TS 脚本，SQLite 读 → Postgres 写 | 全场景可控           | ⚠️ 关联顺序要注意           |
| **C. CSV 中转**         | `sqlite> .dump` → 清理 → `psql \copy`   | 演示/小数据          | ⚠️ JSON 字段要小心          |
| **D. `pgloader`**       | 自动化迁移工具                          | 大数据量             | ✅ 推荐（如果数据 > 1k 行） |

**MVP 推荐**：用 **B（ETL 脚本）**。理由：

- 5 个模型、~20 行种子数据
- JSON 字符串字段需要原样搬迁（`pgloader` 可能破坏转义）
- 业务字段命名有特殊含义（`categoryCode` 大小写），可控更重要

### F.3 业务字段映射（迁移时确认）

| SQLite 列                               | Postgres 列               | 注意                                     |
| --------------------------------------- | ------------------------- | ---------------------------------------- |
| `Master.skills` (TEXT JSON 字符串)      | `skills` (text)           | **直接搬**——不要让 Prisma 当 JSON 列解析 |
| `ServiceSku.requiredSkills` (TEXT "[]") | `requiredSkills` (text)   | 同上                                     |
| `DispatchRule.ruleJson` (TEXT JSON)     | `ruleJson` (text)         | 同上                                     |
| `Order.scheduledAt` (timestamp)         | `scheduledAt` (timestamp) | 时区差异要测                             |
| 全部 `createdAt` / `updatedAt`          | 同上                      | 同上                                     |

---

## G. 回滚方案

> 迁移出问题时，怎么快速回到 SQLite。

### G.1 阶段化回滚点

| 阶段                     | 回滚手段                       | RTO（恢复时间目标） |
| ------------------------ | ------------------------------ | ------------------- |
| 阶段 1 之前              | 不动 SQLite                    | N/A                 |
| 阶段 1（schema 改了）    | `git revert` + 重新 `db:reset` | 5 分钟              |
| 阶段 2（远程 DB 接好了） | **不可逆**（远程 DB 已有数据） | N/A                 |
| 阶段 3-5（数据已迁）     | 见 G.2                         | 30 分钟 - 数小时    |

### G.2 切流量后的回滚（阶段 5）

```
[故障] Postgres 服务异常
   ↓
[1] 平台把 DATABASE_URL 改回 SQLite 路径
[2] git revert schema 的 provider 改动
[3] prisma db push 重建 SQLite schema
[4] ETL 脚本反向搬最近的数据
   ↓
[恢复] 切回 SQLite
```

**简化方案（推荐）**：

- 阶段 3-4 期间**双写**：SQLite + Postgres 同时写
- 阶段 5（切流量）前**保留 SQLite 24h**，出故障直接切回去

### G.3 数据回滚（最坏情况）

如果 Postgres 数据损坏但要恢复：

1. 远程 DB 的 **PITR（point-in-time recovery）**（Neon / Supabase / Railway 都支持）
2. 或者从 **手动备份**（`pg_dump` 定期跑）恢复

---

## H. 部署影响对比

### H.1 Vercel

| 维度                  | 评估                                                     |
| --------------------- | -------------------------------------------------------- |
| **是否支持 SQLite**   | ❌ **不支持**（无持久化文件系统）                        |
| **PostgreSQL 支持**   | ✅ 必须外接 DB                                           |
| **推荐 DB**           | Neon / Supabase / Vercel Postgres（Vercel 自家）         |
| **DATABASE_URL 注入** | ✅ 平台自动读 env                                        |
| **Prisma 兼容**       | ✅ 需注意 **Edge Runtime** 限制（Postgres adapter 推荐） |
| **冷启动**            | ⚠️ 需 Prisma Accelerate 或 pgBouncer 池化                |
| **价格**              | Free tier 可用；Hobby $20/月起                           |
| **适合场景**          | 演示 / 短链接分享 / SEO 站点                             |
| **不适合**            | 持久服务（无 serverful 实例）                            |

**关键限制**：Vercel 是 serverless，**Prisma Client 每次冷启动要重连**。要解决：

- 用 [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)（同生态）
- 或用 Prisma Accelerate（连接池）
- 或用 Supabase Pooler

### H.2 Railway

| 维度                  | 评估                                              |
| --------------------- | ------------------------------------------------- |
| **是否支持 SQLite**   | ⚠️ 临时支持（实例重启会丢）                       |
| **PostgreSQL 支持**   | ✅ **Railway 自带 Postgres 插件**（一键）         |
| **DATABASE_URL 注入** | ✅ 自动注入到 service env                         |
| **Prisma 兼容**       | ✅ 标准连接                                       |
| **冷启动**            | ✅ 无（long-running container）                   |
| **价格**              | **$5/月起**（含 $5 用量） · Postgres 插件按用量计 |
| **适合场景**          | **个人项目 / MVP / 低流量** ← **本项目首选**      |
| **不适合**            | 大流量、需要读副本的场景                          |

**亮点**：

- ✅ 一键起 Postgres（含 `DATABASE_URL` 自动注入）
- ✅ 与 Next.js 同平台部署（一个 git push 就上线）
- ✅ 不用管 serverless 冷启动
- ✅ 便宜的 $5 计划足够 MVP 演示 + 小流量

### H.3 Supabase

| 维度                  | 评估                                                        |
| --------------------- | ----------------------------------------------------------- |
| **是否支持 SQLite**   | ❌ 不支持                                                   |
| **PostgreSQL 支持**   | ✅ **Supabase = Postgres + Auth + Storage + Realtime**      |
| **DATABASE_URL 注入** | ✅ 自动（`DATABASE_URL` 直连 + `DIRECT_URL` 池化）          |
| **Prisma 兼容**       | ⚠️ **需要用 pooler URL**（`?pgbouncer=true`），否则连接数爆 |
| **冷启动**            | ✅ DB 一直在线                                              |
| **价格**              | Free tier 500MB · Pro $25/月                                |
| **适合场景**          | 未来要加 **Auth / Storage / Realtime**（订单状态推送）      |
| **不适合**            | 纯 DB 需求（杀鸡用牛刀）                                    |

**注意点**：

- ⚠️ Prisma + Supabase 必须用 **Supavisor / pgBouncer** 做连接池（否则 serverless 函数会爆连接数）
- ✅ 配套能力（鉴权、文件存储、Realtime）以后做用户端 / 师傅端推送很合适

### H.4 Neon

| 维度                  | 评估                                                    |
| --------------------- | ------------------------------------------------------- |
| **是否支持 SQLite**   | ❌ 不支持                                               |
| **PostgreSQL 支持**   | ✅ **Neon = 专为 serverless 设计的 Postgres**           |
| **DATABASE_URL 注入** | ✅ 自动（pooled + direct 两个 URL）                     |
| **Prisma 兼容**       | ✅ 完美（**Prisma 官方推荐 serverless 搭档**）          |
| **冷启动**            | ✅ **< 1s**（compute auto-suspend）                     |
| **价格**              | Free tier 0.5GB · Launch $19/月                         |
| **适合场景**          | **Vercel / 任何 serverless 部署** ← **Vercel 用户首选** |
| **不适合**            | 写密集型（auto-suspend 后冷启动有 ~500ms 延迟）         |

**亮点**：

- ✅ 与 Vercel 集成最丝滑（Vercel Marketplace 一键装）
- ✅ Branching 功能（每个 PR 一个独立 DB 分支）
- ✅ Free tier 足够 MVP 演示

### H.5 对比表

| 维度               | Vercel + Neon | Vercel + Supabase        | Railway        | Vercel + Vercel Postgres |
| ------------------ | ------------- | ------------------------ | -------------- | ------------------------ |
| 部署复杂度         | 🟢 最低       | 🟡 中（要配 pooler）     | 🟢 最低        | 🟢 最低                  |
| 价格               | Free 可用     | Free 可用                | **$5/月起**    | Free 可用                |
| 长期扩展           | 🟢 强         | 🟢 强                    | 🟡 中          | 🟢 强                    |
| 配套能力           | ❌ 仅 DB      | 🟢 Auth+Storage+Realtime | 🟡 有 Redis/PG | ❌ 仅 DB                 |
| 冷启动             | < 1s          | < 1s                     | 无             | < 1s                     |
| 国内访问           | ❌ 慢         | ❌ 慢                    | 🟡 中          | ❌ 慢                    |
| **适合本项目 MVP** | ⭐⭐⭐⭐      | ⭐⭐⭐                   | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐                 |

---

## I. 推荐方案

### I.1 推荐：**Railway**

针对本项目（个人项目 · 预算低 · 部署简单 · Prisma 友好）：

> **首选：Railway**

### I.2 推荐理由

| 需求            | Railway 怎么满足                                                         |
| --------------- | ------------------------------------------------------------------------ |
| **个人项目**    | ✅ 一个 dashboard 管 Next.js + Postgres，不用拼多平台                    |
| **预算低**      | ✅ **$5/月**起步（$5 plan 含 $5 用量，Next.js + Postgres 共享预算）      |
| **部署简单**    | ✅ `git push` 自动部署；Postgres 插件**一键**建，自动注入 `DATABASE_URL` |
| **Prisma 友好** | ✅ 标准 PostgreSQL 连接，无 serverless 冷启动、无连接池问题              |
| **MVP 演示**    | ✅ 有持久卷（不像 Vercel 函数级隔离），DB 连接稳定                       |
| **未来扩展**    | 🟡 中等（流量大了再迁到 Vercel + Neon 也方便——schema 一样）              |

### I.3 不推荐 Supabase / Neon 的原因

- **Supabase**：杀鸡用牛刀。本项目**当前没有 Auth/Storage/Realtime 需求**；且 Prisma + Supabase 必须配 pooler，对个人项目是额外负担。**未来**如果做用户登录 / 文件上传 / 订单实时推送，再考虑迁 Supabase。
- **Neon**：很强，但搭配 Vercel 才是最佳（自动 branch + serverless 优化）。本项目 MVP 阶段不需要 serverless 冷启动优化；**未来**如果迁 Vercel 部署，再考虑 Neon。

### I.4 推荐的部署架构

```
┌──────────────────┐
│   Railway App    │
│   (Next.js)      │ ← git push 自动部署
│                  │
│   DATABASE_URL ──┼──────────────┐
└──────────────────┘              │
                                  ↓
                       ┌──────────────────┐
                       │ Railway Postgres │ ← 一键创建
                       │  (PostgreSQL 16) │    自动注入 env
                       └──────────────────┘
```

### I.5 实施 checklist（**未来执行用，本任务不动**）

```
[ ] 阶段 0（当前）：完成本评估文档
[ ] 阶段 1：
    [ ] 改 prisma/schema.prisma datasource
    [ ] 本地 docker 起 Postgres，跑测试
    [ ] npm run check 通过
[ ] 阶段 2：
    [ ] Railway 建项目 + Postgres 插件
    [ ] 配置环境变量
    [ ] 首次 prisma migrate deploy 建表
    [ ] 跑 seed
[ ] 阶段 3：
    [ ] ETL 脚本：SQLite → Postgres（仅当需要历史数据）
[ ] 阶段 4：
    [ ] 切流量观察
    [ ] 保留 SQLite 24h 应急
[ ] 阶段 5：
    [ ] 删除 dev.db 提交
```

---

## J. 风险清单

### J.1 迁移本身的风险

| #   | 风险                                        | 等级  | 缓解                                                 |
| --- | ------------------------------------------- | ----- | ---------------------------------------------------- |
| 1   | **JSON 字符串字段被 Postgres 当 JSON 解析** | 🟢 低 | schema 明确是 `String` 不是 `Json`；ETL 脚本原样搬迁 |
| 2   | **业务编码大小写敏感性**                    | 🟢 低 | 应用层 `normalizeCode` 强制大写（已有防御）          |
| 3   | **时区差异**（`scheduledAt` / `createdAt`） | 🟡 中 | 用 UTC 存储；前端按用户时区显示                      |
| 4   | **乐观锁 / 事务语义差异**                   | 🟡 中 | 重测 `assignOrder` 并发场景（见 J.2）                |
| 5   | **seed 脚本报错**                           | 🟡 中 | 阶段 1 实际跑一次确认                                |
| 6   | **本地无 Postgres 环境**                    | 🟢 低 | docker run 一行解决                                  |
| 7   | **DATABASE_URL 泄漏到 git**                 | 🟡 中 | `.gitignore` 加 `.env`；`.env.example` commit 但留空 |
| 8   | **生产环境 `migrate deploy` 失败**          | 🟠 高 | **先在 staging 跑通**；保留 7 天内 pg_dump 备份      |

### J.2 重点测试场景（阶段 1 必须覆盖）

迁移到 Postgres 后，**强烈建议**重跑这些测试（来自 `vitest.config.ts` 端到端测试）：

1. **并发派单**（`assignOrder`）—— 验证 `updateMany + status` 乐观锁在 Postgres 下行为一致
2. **事务完整性**（订单派单 + 师傅 status 变化）—— 验证 rollback 正确
3. **JSON 字段读写**（`Master.skills` / `DispatchRule.ruleJson`）—— 验证字符串往返
4. **唯一约束**（`categoryCode` / `skuCode`）—— 验证大小写一致
5. **`@updatedAt` 触发**（Order 状态切换时）—— 验证 Prisma 行为

### J.3 部署平台特有风险

| 平台     | 风险                                                  |
| -------- | ----------------------------------------------------- |
| Vercel   | serverless 冷启动 / Prisma 连接数爆 → 必须配 pooler   |
| Railway  | 实例重启少，但 **$5 plan 用完会停机**（不会自动加钱） |
| Supabase | 不用 pooler 会爆连接数；pooler 配置容易出错           |
| Neon     | auto-suspend 冷启动 500ms；写密集场景不友好           |

### J.4 业务风险（不归 DB 迁移管，但要知道）

- 订单数据迁丢：影响业务可追溯性 → 必须先 `pg_dump` 再切
- 派单规则 JSON 不兼容：影响线上派单 → ETL 后人工抽 5 条对比
- 用户会话（如果有 cookie/session）：不在 DB，但部署平台重启会丢 cookie 签名密钥 → 用平台 env 管理

---

## 附录 A：相关文件清单

| 文件                           | 角色           | 本任务是否改动                      |
| ------------------------------ | -------------- | ----------------------------------- |
| `prisma/schema.prisma`         | schema 定义    | ❌ 不动（**只在文档里**演示 diff）  |
| `prisma/seed.ts`               | 种子脚本       | ❌ 不动                             |
| `prisma/dev.db`                | SQLite 文件    | ❌ 不动                             |
| `src/lib/db.ts`                | Prisma 单例    | ❌ 不动（已确认无 SQLite 专有代码） |
| `src/lib/repos/*`              | 仓储层         | ❌ 不动                             |
| `app/**/actions.ts`            | server actions | ❌ 不动                             |
| `lib/dispatch.ts`              | 派单算法       | ❌ 不动                             |
| `package.json`                 | 脚本           | ❌ 不动                             |
| `.gitignore`                   | 忽略规则       | ❌ 不动（建议未来加 `.env`）        |
| `.env`                         | 本地变量       | ❌ 不存在，**不创建**               |
| `docs/postgresql-migration.md` | **本文档**     | ✅ 新建                             |
| `README.md`                    | 项目说明       | ✅ 加本文档链接                     |

---

## 附录 B：决策记录

> 这些是本评估阶段的决策，不是迁移执行决策。

- ✅ **不实际跑 Postgres**（本任务明确禁止）
- ✅ **不改 schema**（本任务明确禁止）
- ✅ **不改业务代码**（已确认无需改）
- ✅ **不创建 `.env`**（避免误 commit）
- ✅ **不创建 `migrations/` 目录**（属阶段 1 动作）
- ✅ **推荐 Railway 而非 Supabase/Neon**（理由见 I.3）
