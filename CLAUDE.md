# CLAUDE.md — O2O MVP 项目工作规则

> 本文件给 Claude 看的「如何在 O2O MVP 项目里干活」的速查。
> 规则按优先级 P0 > P1 > P2 > P3 分层。**P0 不可妥协**。
> 具体案例 / 反例 / 历史教训 → `docs/FEEDBACK.md` + `~/.claude/.../memory/o2o-mvp-error-cheatsheet.md`（每次新会话先扫一遍 cheatsheet）。

---

## 核心执行原则：**先问 + 排优先级 + 不猜**

遇到新阶段 / 模糊指令 / 多个可选方向时——**先问**（问前**排优先级**），**不猜**。

- **先问** = 触发 AskUserQuestion；不替用户做决定
- **排优先级** = P0（必修）/ P1（建议修）/ P2（可选）；让用户从 P0 挑起
- **不猜** = 没把握不自己定；如果非要定，主动暴露「我决定不做什么」+ 理由 + 风险

返工成本 > 问一句的成本。

---

## P0 — 不可妥协（不遵守 = 一定会再犯）

### P0-0：风险驱动决策（每个阶段必走）

每阶段结束 / 修 bug 任务前：**列风险 → 排优先级 → 选必修 → 问用户**。

模板：列 5-10 条 → 按 P0/P1/P2 分级 → AskUserQuestion 让用户挑（给 2-3 选项）→ 选了才动手。**用户选完才动，不猜**。

### P0-1：DB 迁移先行

改 `prisma/schema.prisma` / `lib/mock-data.ts` / `prisma/seed.ts` → **立刻** `npm run db:reset` → 等「seed 完成」→ 再继续。

### P0-2：测试断言 = 规格，不是现状

写 `expect(X).toBe(Y)` 前必须能回答：「Y 是业务想要的，不是当前代码碰巧输出的吗？」

- 测规格 → `// # spec: <业务语义>`
- 测现状 → `// # documents current behavior`
- **存疑默认当「测规格」**

存疑默认当「测规格」 — 别让「通过」变成「现状确认」。每加一个 it() 必加 `# spec:` 或 `# documents:` 注释（husky lint:spec 强制）。

### P0-3：路径/入口双重验证

改 routing 入口前 → 先 `curl localhost:3000/<path>` 看 HTML 字段名 + 组件，再动。

- 改 `app/` 之前：先 curl 确认实际入口（**Next.js 只认根 `app/`，不认 `src/app/`**）
- 改 prisma client 之前：先 `npx prisma generate` 确认 mtime 更新
- **Next.js 15+ `cookies()` 是 async**——必须 `await`
- **`@/*` 解析到项目根 `./`** — 但项目有 2 个 `lib/`：
  - `lib/foo.ts` = 演示期遗留（订单/师傅/services 共用）
  - `src/lib/foo.ts` = 新业务代码（auth, codes, masters, services, orders, queries, dispatch-rules）
  - 新业务放 `src/lib/`，import 用 `@/src/lib/foo`

`npm run lint:paths` 自动检查目录约定。

### P0-4：业务逻辑简化即 bug

MVP 简化时「先这样」是 bug 的最大温床。每次「先不释放师傅 / 先不校验 / 先不级联」反问：

- 这是真的不需要？
- 还是「等真实业务规则」？→ `# MVP: <原因>` 注释
- 还是「我懒得做」？→ 写下一阶段必做项

### P0-5：改 demo 数据 / seed 文件 → 必跑 `npm run test`

触发（满足任一即触发）：

- 改 `prisma/seed.ts` / `prisma/seed-demo.ts` / `lib/mock-data.ts` / `scripts/_*-factory.ts`
- 改师傅 ID（删/加/改名）
- 改订单 ID 格式
- 改 SKU / 品类 code 前缀

执行：**commit 前必跑**（husky pre-commit 已强制）。不能用 baseline「上次过了」当借口 — 实际跑了 + 贴断言才算。

**反例**：v0.9.2 commit msg 写「check + test + build 全过」 — 没贴断言 + 实际没跑 → 72 测试挂。

**修复手段**（已落地）：husky pre-commit 跑 npm run test + memory cheatsheet 类别 8e。

### P0-6：新增后台页 → 权限矩阵同步

触发（满足任一即触发）：

- 新增 / 修改后台页面路由（如 `app/<admin-page>/page.tsx`）
- 新增导航入口（`components/AppNav.tsx`）
- 新增登录后跳转目标

必须同时检查 / 更新：

1. `src/lib/auth.ts`：`PROTECTED_PATHS` + `ROLE_ALLOWED.admin`
2. `src/lib/auth.test.ts`：`isProtectedPath(path)` + `canAccess("admin", path)`
3. `middleware.test.ts`：未登录访问新路径 → `/login?next=...`
4. 页面守卫：用 `getCurrentUser()` 查真实用户，非 admin 才跳 `DEFAULT_LANDING`

**禁止**：middleware 只凭 Fe26 cookie 存在把 `/login` 自动跳 `/dashboard`。seed / 测试会重建 `User`，旧 cookie 可能变成 stale session。

---

## P1 — 强烈建议（不遵守 = 多次踩坑）

### P1-1：删文件顺序 = 先删引用方再删实现

先删 `.test.ts` / import → 再删实现。删实现前先 `grep -rn "from.*\./<file>"`。

### P1-2：进度汇报分「实现」「验证」「未验证」「决策」4 段

每段**贴关键断言**（CLAUDE.md 错误卡类 5 教训：口头「通过」不算）。模板：

- **改了哪些文件**：列举
- **跑了什么测试**：贴断言（`21 passed (21) / 283 passed (284)`）
- **验证了什么场景**：端到端步骤 + 实际观察值
- **还没验证的**：明确列出（不掩盖）
- **我决定不做什么**：非显然决策主动说 + 理由 + 风险

### P1-3：用户说模糊词 → 先问，不猜

「继续」「做一下」「修一下」→ 复述「你是说做 #N 吗？」或给 2-3 选项让用户选。

---

## P2 — 建议（不遵守 = 慢慢积累技术债）

### P2-1：复述需求再开始

新阶段前用一句话复述需求 + 标号列出，确认理解再动手。

### P2-2：代码注释风格统一

中文项目用中文注释；新组件顶部说明「为什么写」「替代了什么」「MVP 边界」。

### P2-3：决策回报要主动暴露

非显然决策在汇报里说「我决定不做什么」+ 理由 + 风险。**等用户问才说 = 报喜不报忧**。

---

## P3 — 推荐（加分项）

### P3-1：每完成 1-3 个原子步骤 sync 用户

不闷头做完一轮才汇报。

### P3-2：失败时暴露假设

不确定的决策显式说出来，别事后解释。

---

## 项目速查

### 命令

| 命令                 | 作用                                                    |
| -------------------- | ------------------------------------------------------- |
| `npm run dev`        | 启动 dev server                                         |
| `npm run check`      | TS + 目录约定 + spec + process（**lint:paths 自动跑**） |
| `npm run lint:paths` | 单独跑目录检查（防 `src/app/` / 根 lib 误用）           |
| `npm run test`       | 单元 + 端到端测试（**husky pre-commit 强制跑**）        |
| `npm run db:reset`   | 删库重建 + 重新 seed                                    |
| `npm run db:seed`    | 只灌**基础**种子                                        |
| `npm run seed:demo`  | 一键重置**完整**演示数据（v0.9.2 加）                   |

### 目录约定（**关键**）

- `app/` — Next.js 路由（**唯一**，不写 `src/app/`）
- `components/` — 客户端 React 组件（项目根级，不用 `src/components/`）
- `lib/` — 演示期遗留的纯函数 + 类型（兼容代码，**不写新业务到这里**）
- `src/lib/` — 新业务代码
- `src/lib/orders.ts` — `createOrder` / `assignOrder` / `transitionOrder`
- `src/lib/repos/` — DB 原子操作层
- `src/lib/queries.ts` — 页面级组装
- `src/lib/actions/` — 旧的 server actions（dispatch-order / release-order）
- `app/orders/actions.ts` — 订单 server actions（createOrderAction / assignOrderAction / startServiceAction / completeOrderAction / cancelOrderAction / cancelDispatchAction）
- `app/masters/actions.ts` / `app/services/actions.ts` — 师傅 / 服务 server actions
- `src/lib/codes.ts` — 业务编码生成/校验
- `src/lib/masters.ts` — 师傅业务 + parseSkillsString / skillsToString
- `src/lib/services.ts` — 服务业务

### 状态流转

```
pending → assigned → in_service → completed
   │         │           │
   └──── 取消 ──┴──── 取消 ────┘
              ↓
          cancelled
```

- 派单：`assignOrder`（事务：order + master status busy）+ **乐观锁防并发抢单**
- 完成 / 取消：`transitionOrder` / `releaseMaster` 释放师傅
- 所有 transition 用乐观锁（`updateMany` + status 条件）

### 业务编码

- `categoryCode` / `skuCode` 应用层强制大写（`normalizeCode`）
- SQLite 不支持 `@db.Collate`，靠应用层是唯一防线
- `assertValidCode` + `normalizeCode` 在 `src/lib/codes.ts` 集中管理

### 测试

- 单元测试：`lib/dispatch.test.ts`, `lib/codes.test.ts`, `src/lib/orders.test.ts`
- 端到端测试：连真实 SQLite（`vitest.config.ts` 关了 `fileParallelism` 避免污染）
- 业务逻辑纯函数测试 vs action / repository 测试分开文件
- **每个测试用 `beforeEach` / `afterEach` reset 相关 DB 状态**（`resetMasterStatuses` + `resetOrder`）

### 已知遗留 / 下阶段 TODO

- 「删除品类 / 删除 SKU」「删除师傅」：当前禁止
- 「订单完成 / 取消」以外的 status 流转：completed / cancelled 是终态
- 服务 SKU 编码 / 类目不能改
- 服务 SKU 时长字段硬编码 60 分钟
- 首页汇总「待派单」「服务中」是简化算法（`createdAt` desc 第一笔 pending）

### 相关文档（具体案例 / 反例 / 历史教训）

- **新会话必扫**：`~/.claude/.../memory/o2o-mvp-error-cheatsheet.md`（8 类错误卡）
- 项目：`docs/DEMO.md` `docs/BETA_CHECKLIST.md` `docs/ROADMAP.md` `docs/KNOWN_ISSUES.md`
- Agent 自我审计：`docs/FEEDBACK.md` `docs/FEEDBACK-self-csrf-bug-series.md`
