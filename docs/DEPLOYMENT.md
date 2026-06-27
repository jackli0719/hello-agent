# 部署 / 运行指南

> 本文档说明第一版 MVP 的本地运行方式、SQLite 的局限性、PostgreSQL 迁移建议，以及 Vercel 部署时的关键限制。
> 本项目**当前不包含线上部署所需的配置**（数据库连接、环境变量、CI/CD 等）—— 只用于本地演示。

---

## 1. 本地运行

### 1.1 环境要求

- **Node.js**：18.18+ 或 20+（Next.js 15 要求）
- **npm**：9+（或 pnpm / yarn 自行适配）
- **磁盘**：约 500 MB（含 node_modules）

### 1.2 一键启动（首次）

```bash
# 1. 克隆 / 解压项目
cd <project-dir>

# 2. 安装依赖
npm install

# 3. 初始化数据库 + 灌种子数据
npm run db:reset
# 等价于：rm dev.db → prisma db push → tsx seed.ts

# 4. 启动 dev server
npm run dev
# → http://localhost:3000
```

### 1.3 常用命令

| 命令 | 作用 | 何时用 |
|---|---|---|
| `npm run dev` | 启动开发 server（带热重载） | 日常开发 |
| `npm run build` | 生产构建（生成 .next/） | 部署前 / 验证可构建 |
| `npm run start` | 启动生产 server | 本地预览 prod |
| `npm run check` | TypeScript + 目录约定检查 | CI / 提交前 |
| `npm run test` | 跑 Vitest 单元 + 端到端测试 | CI / 提交前 |
| `npm run db:reset` | 删库重建 + 重新 seed | 演示搞乱了想重来 |
| `npm run db:push` | 同步 schema → DB | 改了 `prisma/schema.prisma` |
| `npm run db:seed` | 只灌种子数据 | 想保留测试数据再补 seed |
| `npm run db:generate` | 重新生成 Prisma Client | 改了 schema 后 |

### 1.4 验证项目状态

```bash
npm run check    # 应输出：✅ 目录约定检查通过
npm run test     # 应输出：Tests 222 passed (222)
npm run build    # 应输出：✓ Compiled successfully + 18 个路由
```

如果有任何失败，请先把本地环境修好再继续。

---

## 2. SQLite 的局限性（重要）

本项目第一版用 **SQLite**（`prisma/dev.db` 文件即数据库）—— 选 SQLite 是因为：
- 本地零配置，开箱即用
- 文件即数据库，便于 demo 演示和重置（`db:reset` 一键重建）
- Prisma 5 兼容性好

**但 SQLite 不适合线上生产**：
- ❌ **不支持并发写**：单文件锁，写并发 ≈ 1
- ❌ **没有用户/权限**：演示版可以，生产版需要 DB 层鉴权
- ❌ **没有备份机制**：删了 `dev.db` = 全没了
- ❌ **不适合复杂查询**：JSON / 全文检索能力弱
- ❌ **不适合多机部署**：文件锁让水平扩展失败

**生产建议**：迁移到 **PostgreSQL**（详见第 3 节）。

---

## 3. 迁移到 PostgreSQL（如果需要）

迁移路径（**仅说明，不在第一版范围内**）：

### 3.1 改 schema datasource

`prisma/schema.prisma`：

```diff
 datasource db {
-  provider = "sqlite"
-  url      = "file:./dev.db"
+  provider = "postgresql"
+  url      = env("DATABASE_URL")
 }
```

### 3.2 环境变量

新建 `.env`（或部署平台的环境变量）：

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"
```

### 3.3 重新初始化

```bash
npx prisma migrate deploy    # 应用 migration（生产推荐）
# 或：
npx prisma db push           # 快速同步 schema（dev / demo 用）
```

### 3.4 迁移注意事项

- ⚠️ `Order.remark` 字段在 SQLite 是 `TEXT NULL`，Postgres 也是 `TEXT NULL`，无差异
- ⚠️ seed 数据可能要按 Postgres 习惯调整（如时间字段、JSON 字段）
- ⚠️ 测试要重新跑过（vitest 用真 DB）
- ⚠️ 并发场景要重点测（SQLite 的乐观锁逻辑在 Postgres 也 OK，但写并发差异大）

---

## 4. Vercel 部署（⚠️ SQLite 不支持）

### 4.1 关键限制

**Vercel 是无服务器（serverless）架构**，每个函数调用可能在不同实例：

- ❌ **SQLite 文件系统不持久** — `prisma/dev.db` 在每次部署后会被覆盖，演示版数据全丢
- ❌ **多实例并发写** — 文件锁 + 跨实例不可见
- ❌ **不能写本地文件** — Vercel 只读文件系统（除了 `/tmp`）

### 4.2 推荐方案

如果要在 Vercel 部署（线上试用）：

1. **迁移到 PostgreSQL** — 用 Neon / Supabase / Vercel Postgres / PlanetScale
2. **设置环境变量** `DATABASE_URL` 指向外部 DB
3. **prisma 配置** — 参考第 3 节
4. **server actions 用 `revalidatePath`** — 当前已实现，✅ 兼容
5. **考虑无服务器冷启动** — Prisma Client 单例模式已实现（`src/lib/db.ts`），✅ 兼容

### 4.3 替代方案

如果想**快速让多人试用**（不写生产代码）：

- **ngrok / Cloudflare Tunnel**：本地 dev server 暴露到公网
- **Docker + 公网 DB**：docker-compose 起服务 + 外部 Postgres
- **Railway / Render**：直接支持 SQLite 文件持久化（注意：实例重启仍会丢）

---

## 5. 第一版 MVP 不包含的部署功能

明确**不在第一版范围内**：

- ❌ CI/CD 配置（GitHub Actions / Vercel 自动部署）
- ❌ Dockerfile / docker-compose
- ❌ 环境变量管理（dotenv-cli / secrets manager）
- ❌ 日志聚合（Sentry / LogRocket）
- ❌ 监控告警（Prometheus / Datadog）
- ❌ 备份策略（定时 snapshot）
- ❌ HTTPS / 域名 / SSL 证书
- ❌ 限流 / 防爬 / WAF
- ❌ 真实登录体系（OAuth / SSO）

这些都应该在「线上试用」阶段补齐，**不是当前任务范围**。

---

## 6. 反馈渠道

试用过程中遇到问题：
- 看 [docs/FEEDBACK.md](FEEDBACK.md) 提交反馈模板
- 或直接看 [docs/DEMO.md](DEMO.md) 跑完整演示链路