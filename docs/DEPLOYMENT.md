# 部署 / 运行指南

> 本文档说明第一版 MVP 的本地运行方式、PostgreSQL 配置，以及 Vercel/线上部署时的关键限制。
> 本项目当前默认面向本地演示：数据库是 Docker PostgreSQL，线上部署需要替换为托管 PostgreSQL 和生产密钥。

---

## 1. 本地运行

### 1.1 环境要求

- **Node.js**：18.18+ 或 20+（Next.js 15 要求）
- **npm**：9+（或 pnpm / yarn 自行适配）
- **Docker**：用于本地 PostgreSQL
- **磁盘**：约 500 MB（含 node_modules）

### 1.2 一键启动（首次）

```bash
# 1. 克隆 / 解压项目
cd <project-dir>

# 2. 安装依赖
npm install

# 3. 准备本地环境
cp .env.example .env

# 4. 启动 PostgreSQL + 应用 migrations + 灌种子数据
npm run db:start

# 5. 启动 dev server
npm run dev
# → http://localhost:3000
```

### 1.3 常用命令

| 命令                  | 作用                                       | 何时用                  |
| --------------------- | ------------------------------------------ | ----------------------- |
| `npm run dev`         | 启动开发 server（带热重载）                | 日常开发                |
| `npm run build`       | 生产构建（生成 .next/）                    | 部署前 / 验证可构建     |
| `npm run start`       | 启动生产 server                            | 本地预览 prod           |
| `npm run verify`      | DB + check + format + test + build + smoke | 提交前 / agent 验证     |
| `npm run check`       | TypeScript + 目录/spec/process 检查        | CI / 提交前             |
| `npm run test:unit`   | 快速纯逻辑单测                             | 小改动快速反馈          |
| `npm run test`        | 跑 Vitest 集成测试（含 DB 前置检查）       | CI / 提交前             |
| `npm run smoke:pages` | 页面 smoke                                 | 构建后验证入口          |
| `npm run db:start`    | 启动 PostgreSQL + migrate + seed           | 本地开发                |
| `npm run db:reset`    | 重置当前 PostgreSQL schema + seed          | 演示搞乱了想重来        |
| `npm run db:seed`     | 只灌种子数据                               | 想保留测试数据再补 seed |
| `npm run db:generate` | 重新生成 Prisma Client                     | 改了 schema 后          |

### 1.4 验证项目状态

```bash
npm run verify
# 应完成：db:start + check + format:check + 281 tests + build + smoke:pages
```

如果有任何失败，请先把本地环境修好再继续。

---

## 2. PostgreSQL 配置

当前 `prisma/schema.prisma` 已使用 PostgreSQL。默认本地配置来自 `.env.example`：

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public"
SESSION_SECRET="CHANGE_ME_TO_RANDOM_32_CHARS_MIN_LENGTH_xxxxxxxxxxxxx"
```

本地容器由 `docker-compose.yml` 提供，容器内 5432 映射到宿主机 5433。

线上部署时，把 `DATABASE_URL` 替换为 Neon / Supabase / Vercel Postgres / Railway 等托管 PostgreSQL 的连接串，并把 `SESSION_SECRET` 换成 32+ 字符随机密钥。

### 初始化 / 更新 schema

```bash
npm run db:start           # 本地：启动容器 + migrate deploy + seed
npm run db:migrate:deploy  # 部署：应用 migration
```

---

## 3. Vercel / 线上部署

### 4.1 关键限制

**Vercel 是无服务器（serverless）架构**，每个函数调用可能在不同实例：

- 必须使用托管 PostgreSQL，不能依赖本地 Docker 容器
- 必须配置 `DATABASE_URL` 和生产 `SESSION_SECRET`
- Prisma Client 单例模式已在 `src/lib/db.ts` 实现，适配 serverless 冷启动

### 4.2 推荐方案

如果要在 Vercel 部署（线上试用）：

1. **创建托管 PostgreSQL** — 用 Neon / Supabase / Vercel Postgres / Railway
2. **设置环境变量** `DATABASE_URL` 指向外部 DB
3. **设置环境变量** `SESSION_SECRET` 为 32+ 字符随机串
4. **部署前执行** `npm run db:migrate:deploy`
5. **部署后执行** `npm run verify` 或至少 `npm run check && npm run test`

### 4.3 替代方案

如果想**快速让多人试用**（不写生产代码）：

- **ngrok / Cloudflare Tunnel**：本地 dev server 暴露到公网
- **Docker + 公网 DB**：应用容器 + 外部 PostgreSQL
- **Railway / Render**：应用服务 + 托管 PostgreSQL

---

## 5. 第一版 MVP 不包含的部署功能

明确**不在第一版范围内**：

- ❌ Vercel 自动部署配置
- ❌ 应用 Dockerfile
- ❌ 生产 secrets manager
- ❌ 日志聚合（Sentry / LogRocket）
- ❌ 监控告警（Prometheus / Datadog）
- ❌ 备份策略（定时 snapshot）
- ❌ HTTPS / 域名 / SSL 证书
- ❌ 限流 / 防爬 / WAF
- ❌ OAuth / SSO

这些都应该在「线上试用」阶段补齐，**不是当前任务范围**。

---

## 6. 反馈渠道

试用过程中遇到问题：

- 看 [docs/FEEDBACK.md](FEEDBACK.md) 提交反馈模板
- 或直接看 [docs/DEMO.md](DEMO.md) 跑完整演示链路
