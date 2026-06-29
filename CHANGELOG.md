# Changelog

O2O 上门服务 MVP 的所有变更记录，按 [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) 规范。
版本语义：[harness 维度 semver] — major = 大改造（上线版），minor = 加新能力（每完成一个 P0），patch = 修复/小改。

---

## [v0.2.0] — 2026-06-29 — harness 评估体系建立

**Tag**：`harness-v0.2.0` · **变更类型**：工程化

### Added

- 新建 `CHANGELOG.md`（业务变更跟踪，Keep a Changelog 1.1.0 规范）
- 新建 `docs/HARNESS.md`（工程化能力评估，每 P0 完成打一节）
- 评估节奏：每完成一个 P0 任务 → 升一个 harness version → 同步更新 CHANGELOG + HARNESS + git tag

### Changed

- `docs/ARCHITECTURE.md`：P0 路线图重写为「2026-06-29 讨论锁定」版本，含 ADR-010「多服务商强隔离架构」

---

## [v0.1.0] — 2026-06-29 — MVP 首版 baseline + P0-1 DB 迁移

**Tag**：`harness-v0.1.0` · **变更类型**：业务 + 工程化大改造

### Added

- `prisma/migrations/20260629033757_init/migration.sql`：初始化 Postgres migration
- `prisma/scripts/`：migration 工具脚本
- `docs/postgresql-migration.md`（24 KB）：Postgres 迁移评估文档（A-J 章节）
- `docs/sqlite-to-postgres-data-migration.md`（11 KB）：SQLite → Postgres 数据迁移实操手册
- `docker-compose.yml`：本地起 Postgres
- `.env.example`：DATABASE_URL 模板
- `scripts/db-start.sh`：DB 启动脚本
- `.editorconfig`：编辑器约定

### Changed

- **数据库引擎**：SQLite → **PostgreSQL**（`prisma/schema.prisma` datasource 改 `postgresql` + `env("DATABASE_URL")`）
- **迁移方式**：`prisma db push` → `prisma migrate deploy`（`migrations/` 目录取代）
- **CI 改造**（`.github/workflows/ci.yml`）：
  - 加 Postgres service container（`postgres:16-alpine`）
  - 步骤增加 `Wait for Postgres` + `Apply migrations`
  - 步骤顺序重排：Apply migrations → Check → Lint → Format check → Test → Build
- `src/lib/worker.test.ts`：测试隔离模式微调（SEED_ORDER_IDS）
- `README.md`：增加相关文档链接
- `.gitignore`：增加 migration lock / 缓存等条目
- `package.json`：依赖更新

### Migration Notes

- **回滚方法**：把 `prisma/schema.prisma` 的 provider 改回 `sqlite` + url 改回 `file:./dev.db` + 删 `migrations/` 即可
- **SQLite 文件留存**：`prisma/dev.db` 保留作回滚兜底
- **环境变量**：本地需要 `.env` 写入 `DATABASE_URL`（参考 `.env.example`）

### Known Risks（v0.1.0 节点）

- `prisma/scripts/` 内容**未经本次 release 验证完成度**
- Postgres 字段类型与 SQLite 兼容性**未 100% 验证**（应在 CI 跑过实际迁移后再确认）
- Seed 数据在 Postgres 上的兼容性（JSON 字段、时间戳精度等）**未量化测试**

---

## [v0.0.0] — 2026-06-29 — 历史节点标记

**Tag**：`harness-v0.0.0` · 标记 git 起点（commit `7c8d81c` 之后 + P0-1 启动之前的状态）

### 上一历史节点

- 第一版 MVP 自评：6.0/10
- harness 第一次自评：3.5/10
- harness 5 项整改后：4.9/10
- （详细节点由 `docs/HARNESS.md` 跟踪）

### 已知历史变更（未详细记录，仅做标记）

- 业务：上线版三端（用户/后台/师傅）+ 演示表现力 + 试运行
- 工程：docs 体系 + 6 文档 + 222 测试 + CI v1 + harness 5 项（git/CI/ESLint+Prettier+husky/test 隔离/coverage）+ 可观测性（logger + metrics + /admin/metrics）
- 4 commit 历史：`daf3744` → `9fa884d` → `884c6de` → `7c8d81c`
