# SQLite → PostgreSQL 数据迁移实操手册

> **目的**：一步一步教你把 `prisma/dev.db` 里的数据搬到 PostgreSQL，验完再回滚（如果出问题）。
>
> **什么时候用**：
>
> - 本地首次起 Postgres 想导入老数据
> - 演示版要从 SQLite 升级到 Postgres
> - 验证迁移脚本本身写得对不对
>
> **关联文档**：
>
> - [postgresql-migration.md](postgresql-migration.md) — 阶段 0 评估 + 部署平台选型
> - [DEPLOYMENT.md](DEPLOYMENT.md) — 部署 / 限制

---

## 目录

- [1. 准备](#1-准备)
- [2. 跑迁移](#2-跑迁移)
- [3. 验证](#3-验证)
- [4. 回滚](#4-回滚)
- [5. 常见问题](#5-常见问题)

---

## 1. 准备

### 1.1 你需要什么

- ✅ Node.js 18+ / npm 9+
- ✅ Docker（本地起 Postgres 用）
- ✅ `prisma/dev.db` 存在（SQLite 文件）
- ✅ 已跑过 `npm install`（含 `better-sqlite3`）

### 1.2 起本地 Postgres

```bash
# 端口 5432 如果被占用，改成 5433
docker run -d --name o2o-pg -p 5433:5432 \
  -e POSTGRES_USER=o2o \
  -e POSTGRES_PASSWORD=o2o \
  -e POSTGRES_DB=o2o \
  postgres:16-alpine

# 验证启动
docker exec o2o-pg pg_isready -U o2o
# → /var/run/postgresql:5432 - accepting connections
```

### 1.3 配 `.env`

`prisma/schema.prisma` 现在 datasource 指向 `env("DATABASE_URL")`。本地真值文件 `.env` 已在 `.gitignore` 里。

```bash
# .env
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public"
```

### 1.4 初始化 schema（空库推 migration）

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npx prisma migrate deploy
```

> 这一步把 `prisma/migrations/20260629033757_init/migration.sql` 应用到 Postgres。**只动 schema，不动数据**。

### 1.5（可选）跑一次 seed 当基线

如果 dev.db 丢了或你想从零开始：

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npm run db:seed
# → 5 categories / 8 SKUs / 5 masters / 6 orders / 2 rules
```

---

## 2. 跑迁移

### 2.1 一条命令

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npm run db:migrate:sqlite-to-postgres
```

### 2.2 输出长这样

```
──────────────────────────────────────────────────────────────────────
🔄 SQLite → PostgreSQL 数据迁移
──────────────────────────────────────────────────────────────────────
  源 (SQLite):     /.../prisma/dev.db
  目标 (Postgres): postgresql://o2o:o2o@localhost:5433/o2o?schema=public
──────────────────────────────────────────────────────────────────────
  源数据快照：
    - ServiceCategory: 6 条
    - ServiceSku: 10 条
    - Master: 7 条
    - Order: 10 条
    - DispatchRule: 3 条
──────────────────────────────────────────────────────────────────────
  ⚠️  本脚本只读源数据，绝不删除/修改 SQLite。
  ⚠️  重复跑是安全的（存在则跳过）。
──────────────────────────────────────────────────────────────────────

📦 开始迁移...

[1/5] ServiceCategory
  ServiceCategory: 总 6 · 新增 6 · 跳过 0 · 错 0
[2/5] ServiceSku
  ServiceSku: 总 10 · 新增 10 · 跳过 0 · 错 0
[3/5] Master
  Master: 总 7 · 新增 7 · 跳过 0 · 错 0
[4/5] Order
  Order: 总 10 · 新增 10 · 跳过 0 · 错 0
[5/5] DispatchRule
  DispatchRule: 总 3 · 新增 3 · 跳过 0 · 错 0

🎉 全部数据已迁移到 Postgres。
```

### 2.3 关键不变量

| 不变量                 | 怎么保证                                         |
| ---------------------- | ------------------------------------------------ |
| **源 SQLite 不会被改** | better-sqlite3 用 `readonly: true` 打开          |
| **可以重复跑**         | 全部用「存在则跳过」策略（按 unique 字段查）     |
| **不会丢字段**         | 逐行 `INSERT` 到目标库；字段缺失会立即报错并打印 |
| **DateTime 不会变值**  | ISO 字符串等价比对（脚本里有 normalize 启发式）  |
| **JSON 字符串原样搬**  | 字段类型都是 `String`，不解析                    |

### 2.4 迁移顺序（外键 → 主键）

```
ServiceCategory  →  ServiceSku  →  Master  →  Order  →  DispatchRule
   (无 FK)          (→ Category)  (无 FK)    (→ SKU + Master)  (无 FK)
```

> 顺序由 `prisma/scripts/migrate-sqlite-to-postgres.ts` 写死，不要改。

### 2.5 幂等性

- **Master** 唯一键是 `(name, phone)` 组合（schema 没声明 unique）
- **DispatchRule** 唯一键是 `name`（schema 没声明 unique）
- **ServiceCategory / ServiceSku / Order** 用 schema 声明的 unique 字段

第二次跑会**全部跳过**：

```
[1/5] ServiceCategory
  ServiceCategory: 总 6 · 新增 0 · 跳过 6 · 错 0
...
```

---

## 3. 验证

### 3.1 跑验证脚本

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npm run db:verify-migration
```

### 3.2 输出长这样（成功）

```
📊 对比结果:

  ✓ ServiceCategory: 源 6 / 目标 6
  ✓ ServiceSku: 源 10 / 目标 10
  ✓ Master: 源 7 / 目标 7
  ✓ Order: 源 10 / 目标 10
  ✓ DispatchRule: 源 3 / 目标 3

🎉 全部表数据一致 — 迁移正确。
```

### 3.3 输出长这样（失败）

```
  ✗ Master: 源 7 / 目标 6
    缺失 (1):
      - cmqwe4ss0000550xe44672ips
    字段差异 (1):
      cmqyjwnna0004zjz6k0kxe6fp:
        status: 源="busy" 目标="available"

⚠️  发现差异 — 迁移结果与源不完全一致。
```

退出码 1。

### 3.4 验证脚本比什么

| 字段类型           | 怎么比                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| String             | 字符串相等                                                                   |
| Int / Float        | 数字相等                                                                     |
| Boolean            | SQLite 0/1 vs Postgres boolean 统一为 0/1                                    |
| DateTime           | SQLite Unix timestamp（毫秒/秒）vs Postgres Date 对象，统一为 ISO 字符串再比 |
| 可选字段（`null`） | 两边都 `null` 才算一致                                                       |

### 3.5 跑测试 + check

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npm run test

npm run check
```

期望：222/222 测试通过，目录约定检查通过。

### 3.6（可选）启 dev server 看一眼

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npm run dev
# → http://localhost:3000/orders
# 看订单列表数据是否对得上
```

---

## 4. 回滚

### 4.1 数据本身没动 SQLite

迁移脚本**只读**源 SQLite，迁移失败不会损坏 `prisma/dev.db`。

### 4.2 重置 Postgres 状态

如果 Postgres 迁了一堆东西想重来：

```bash
DATABASE_URL="postgresql://o2o:o2o@localhost:5433/o2o?schema=public" \
  npm run db:reset
# → prisma migrate reset --force
# → 自动 apply migrations + 自动 seed
```

### 4.3 完全销毁 Postgres

```bash
docker rm -f o2o-pg
# 之后 dev.db 还在，schema 还在（Postgres）
# 下次起新容器，按第 1 节从 1.1 重做
```

### 4.4 回滚 schema（万一想回 SQLite）

> ⚠️ **不在迁移流程里**。这是最坏情况。

```diff
 // prisma/schema.prisma
 datasource db {
-  provider = "postgresql"
-  url      = env("DATABASE_URL")
+  provider = "sqlite"
+  url      = "file:./dev.db"
 }
```

```bash
npm run db:reset
# → rm dev.db + db push + seed
```

---

## 5. 常见问题

### Q1: 提示 `the URL must start with the protocol postgresql://`？

**A**: Prisma 5 的 `datasourceUrl` 不能跨 provider 覆盖。本项目源 SQLite 用 `better-sqlite3` 直读，不走 Prisma 跨 provider 路径 —— 应该不会遇到。如果遇到，检查脚本里没用 `new PrismaClient({ datasourceUrl: 'file:...' })`。

### Q2: 验证脚本说「字段差异」但肉眼对比是一样的？

**A**: 八成是 DateTime。SQLite 把 DateTime 存成数字（毫秒/秒），Postgres 存 timestamp。`normalize` 启发式会统一成 ISO 字符串比对 —— 如果还有差异贴出来看。

### Q3: 迁移跑了一半中断了？

**A**: 重跑是安全的。脚本是「逐条 upsert」，中断在哪就从哪续。但**已经迁进去的不会回滚** —— 跑完用 `db:verify-migration` 看看差几条。

### Q4: 我想直接用 `prisma db push` 不行吗？

**A**: `db push` 只动 schema，不动数据。迁数据必须用迁移脚本。两者关系：

- 阶段 1：`prisma migrate dev --name init` 建首个 migration
- 阶段 3：`db:migrate:sqlite-to-postgres` 迁数据
- 阶段 4：`migrate deploy` 在新库上重放

### Q5: 远程 Postgres（Railway / Neon）怎么连？

**A**: 替换 `.env` 里的 `DATABASE_URL` 为远程连接串即可。其余命令一致。

```bash
# .env
DATABASE_URL="postgresql://user:pass@host.railway.app:5432/railway?schema=public"
```

注意：

- 远程连接串带 SSL 参数（`?sslmode=require`），脚本里没特殊处理，Prisma 默认加
- 远程 PG 需要先 `prisma migrate deploy` 应用 schema（不能 `db push`）

### Q6: dev.db 越来越大（演示用乱数据堆积）怎么办？

**A**: 这是 SQLite 的历史包袱。本项目 P1 决策：**保 dev.db**（作迁移源）。如果你想清空它回到 seed 基线：

```bash
# ⚠️ 警告：会删 prisma/dev.db，跑之前先备份
rm prisma/dev.db
DATABASE_URL="file:./prisma/dev.db" npx prisma db push
DATABASE_URL="file:./prisma/dev.db" npm run db:seed
```

> 这是临时方案，**不在 db:reset 流程里**。`db:reset` 现在只重置 Postgres，不动 SQLite。

### Q7: 我能不用 Docker，本机装 PostgreSQL 吗？

**A**: 可以。Mac：`brew install postgresql@16 && brew services start postgresql@16`。`DATABASE_URL` 换成 `postgresql://localhost:5432/o2o?schema=public`。

---

## 附：相关文件

| 文件                                                  | 角色                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `prisma/scripts/migrate-sqlite-to-postgres.ts`        | 数据迁移脚本（ETL）                                                           |
| `prisma/scripts/verify-migration.ts`                  | 验证脚本（对比）                                                              |
| `prisma/migrations/20260629033757_init/migration.sql` | 首版 migration                                                                |
| `prisma/schema.prisma`                                | schema 定义（datasource 改 postgresql）                                       |
| `prisma/dev.db`                                       | 源 SQLite（**保留**）                                                         |
| `prisma/seed.ts`                                      | seed 脚本（无修改）                                                           |
| `.env` / `.env.example`                               | 本地/模板（gitignore / commit）                                               |
| `package.json`                                        | scripts: `db:reset` / `db:migrate:sqlite-to-postgres` / `db:verify-migration` |
| `docs/postgresql-migration.md`                        | 阶段 0 评估 + 部署平台选型                                                    |

---

## 附：决策记录

- ✅ **db:reset 改 Postgres**，保 dev.db（**2026-06-29 决策**）
- ✅ **加 db:verify-migration** 独立验证（不让"迁移脚本通过"信"数据一致"）
- ✅ **dev.db 不在 db:reset 流程** —— 它是迁移源不是开发 DB
- ✅ **better-sqlite3 作 devDep** —— 纯本地工具，不进生产 bundle
- ⏸️ **远程 PG 接入** 等阶段 2 任务
