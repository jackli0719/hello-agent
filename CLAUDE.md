# CLAUDE.md — O2O MVP 项目工作规则

> 本文件给 Claude 看的「如何在 O2O MVP 项目里干活」的速查。
> 规则按优先级 P0 > P1 > P2 > P3 分层。**P0 不可妥协**。

---

## 核心执行原则：**先问 + 排优先级 + 不猜**

**所有具体规则都从属于这一条**。遇到新阶段、模糊指令、多个可选方向时——**先问**（问前先**排优先级**），**不猜**。

- **先问** = 触发 AskUserQuestion；不替用户做决定
- **排优先级** = P0（必修）/ P1（建议修）/ P2（可选）；让用户从 P0 挑起
- **不猜** = 没有把握的方向不自己定；如果非要定，主动暴露「我决定不做什么」+ 理由 + 风险

反例：埋头猜 → 做完发现不是用户要的 → 返工。**返工成本 > 问一句的成本**。

---

## P0 — 不可妥协（不遵守 = 一定会再犯）

### P0-0：风险驱动决策（每个阶段必走）

**每个新阶段结束 / 每个修 bug 任务前，列风险 → 排优先级 → 选必修 → 问用户。**

流程：

1. **列** — 把发现的风险全部列出来（5-10 条常见）
2. **排** — 按 P0/P1/P2 分级：
   - **P0**：影响功能 / 业务正确性 → **必修**
   - **P1**：影响使用 / 演示体验 → **建议修**
   - **P2**：锦上添花 → **可选**
3. **选** — 用 AskUserQuestion 让用户挑（给 2-3 个选项：「做 #1」「做 #1+#2」「按顺序全做」）
4. **做** — 用户选完才动手，不猜

反例：埋头修完才发现顺序不对 / 用户其实只要 #1。

### P0-1：DB 迁移先行

**改 schema 或 mock-data → 立刻 `npm run db:reset` → 再写代码。**

触发：动了 `prisma/schema.prisma`、`lib/mock-data.ts`、`prisma/seed.ts`。
执行：

1. 改完文件
2. **立刻** `npm run db:reset`
3. 等看到「seed 完成」
4. 再继续写代码

### P0-2：测试断言 = 规格，不是现状

**写 `expect(X).toBe(Y)` 前必须能回答：「Y 是业务想要的，不是当前代码碰巧输出的吗？」**

- 测规格：注释 `# spec: <业务语义>`
- 测现状：注释 `# documents current behavior`
- **存疑时默认当「测规格」**，别让「通过」变成「现状确认」

**反例**：之前写过「in_service → completed 后 master 保持 busy」当测试断言，把 MVP 简化当业务规格了——**这是 bug**。

### P0-3：路径/入口双重验证

**改 routing 入口前，先 `curl localhost:3000/<path>` 看 HTML 用的字段名和组件，再动。**

- 改 `app/` 之前：先 curl 确认实际入口在哪（**Next.js 只认根目录 `app/`，不认 `src/app/`**）
- 改 Next.js middleware 之前：必须放**根目录 `middleware.ts`**，不认 `src/middleware.ts`
- 改 prisma client 之前：先 `npx prisma generate`，确认磁盘文件 mtime 更新
- **Next.js 15+ `cookies()` 是 async**——必须 `await`，否则类型错 + 运行时 NoSuchStoreError
- **`@/*` 解析到项目根 `./`**——但项目有 2 个 `lib/`：
  - `lib/foo.ts` = 演示期遗留（订单/师傅/services 共用）
  - `src/lib/foo.ts` = 新业务代码（auth, codes, masters, services, orders, queries, dispatch-rules）
  - 新业务代码放 `src/lib/`，import 用 `@/src/lib/foo`

**反例**：本项目踩过 **3 次** `src/app/` 路径坑（订单新建 / 师傅新增 / 服务品类）。`npm run lint:paths` 自动检查，会拦下。

### P0-4：业务逻辑简化即 bug

**MVP 简化时「先这样」是 bug 的最大温床。** 每次决定「先不释放师傅」「先不校验」「先不级联」时反问：

- 这是真的不需要？
- 还是「等真实业务规则定义清楚」？→ 用注释标记 `# MVP: <原因>`
- 还是「我懒得做」？→ 写下来作为下一阶段必做项

**反例**：

- `available` checkbox 简化了 → 实际把 busy 师傅错误覆盖成 available
- 「完成订单不释放师傅」简化了 → 师傅接不了新单
- 新 SKU 默认 `requiredSkills=[]` 简化了 → 派单匹配不到

---

## P1 — 强烈建议（不遵守 = 多次踩坑）

### P1-1：删文件顺序 = 先删 .test.ts 再删 .ts

**永远先删引用方（test / import），再删被引用方（实现）。**

删实现前先 `grep -rn "from.*\./<file>"`，把引用方先删完。

**反例**：删 `src/lib/actions/create-order.ts` 时先删了 .ts，但 .test.ts 还有 import。

### P1-2：进度汇报分「实现」「验证」「未验证」「决策」

汇报模板：

- **改了哪些文件**：列举
- **跑了什么测试**：xxx → xxx 结果（贴关键断言）
- **验证了什么场景**：端到端步骤 + 实际观察值
- **还没验证的**：明确列出（不掩盖）
- **我决定不做什么**：非显然决策要主动说 + 理由 + 风险

### P1-3：用户说模糊词 → 先问，不猜

「继续」「做一下」「修一下」—— **先复述**：「你是说做 #N 吗？」或给 2-3 个选项让用户选。

---

## P2 — 建议（不遵守 = 慢慢积累技术债）

### P2-1：复述需求再开始

新阶段开始前用一句话复述需求 + 标号列出，确认理解再动手。

**反例**：服务品类阶段没确认「pending_dispatch / canceled 是用户写错还是 schema 错」就自己决定不改 schema——后来才意识到是用户写错。

### P2-2：代码注释风格统一

中文项目用中文注释；新组件顶部说明「为什么写」「替代了什么」「MVP 边界」。

### P2-3：决策回报要主动暴露

非显然决策必须在汇报里说「我决定不做什么」+ 理由 + 风险。**等用户问才说 = 报喜不报忧**。

---

## P3 — 推荐（加分项）

### P3-1：每完成 1-3 个原子步骤 sync 用户

不闷头做完一轮才汇报。

### P3-2：失败时暴露假设

不确定某决策时把假设显式说出来。

---

## 项目速查

### 命令

- `npm run dev` — 启动 dev server
- `npm run check` — TypeScript + 目录约定检查（**自动跑 lint:paths**）
- `npm run lint:paths` — 单独跑目录检查
- `npm run test` — 单元 + 端到端测试
- `npm run db:reset` — 删库重建 + 重新 seed
- `npm run db:seed` — 只灌种子数据

### 目录约定（**关键**）

- `app/` — Next.js 路由（**唯一**，不写 `src/app/`）
- `components/` — 客户端 React 组件（项目根级，不用 `src/components/`）
- `lib/` — 演示期遗留的纯函数 + 类型（兼容代码，不写新业务到这里）
- `src/lib/orders.ts` — 订单业务逻辑（createOrder / assignOrder / transitionOrder）
- `src/lib/repos/` — DB 原子操作层
- `src/lib/queries.ts` — 页面级组装（跨表查询）
- `src/lib/actions/` — 旧的 server actions（dispatch-order / release-order）
- `app/orders/actions.ts` — 订单相关的 server actions（createOrderAction / assignOrderAction / startServiceAction / completeOrderAction / cancelOrderAction / cancelDispatchAction）
- `app/masters/actions.ts` — 师傅 server actions
- `app/services/actions.ts` — 服务品类 / SKU server actions
- `src/lib/codes.ts` — 业务编码生成/校验（categoryCode / skuCode）
- `src/lib/masters.ts` — 师傅业务逻辑 + parseSkillsString / skillsToString
- `src/lib/services.ts` — 服务业务逻辑

### 状态流转

```
pending → assigned → in_service → completed
   │         │           │
   └──── 取消 ──┴──── 取消 ────┘
              ↓
          cancelled
```

- 派单：assignOrder（事务：order + master status busy）+ **乐观锁防并发抢单**
- 完成订单：transitionOrder 释放师傅回 available
- 取消订单 / 取消派单：transitionOrder / releaseMaster 释放师傅
- **所有 transition 用乐观锁**（updateMany + status 条件）

### 业务编码

- categoryCode / skuCode 在应用层强制大写（normalizeCode）
- SQLite 不支持 @db.Collate，靠应用层是唯一防线
- `assertValidCode` + `normalizeCode` 在 `src/lib/codes.ts` 集中管理

### 测试

- 单元测试：`lib/dispatch.test.ts`, `lib/codes.test.ts`, `src/lib/orders.test.ts`
- 端到端测试：连真实 SQLite（注意 `vitest.config.ts` 关了 `fileParallelism` 避免污染）
- 业务逻辑纯函数测试 vs action / repository 测试分开文件
- **每个测试用 `beforeEach` / `afterEach` reset 相关 DB 状态**（`resetMasterStatuses` + `resetOrder`）

### 已知遗留 / 下阶段 TODO

- 「删除品类 / 删除 SKU」：当前禁止，需求范围没要
- 「删除师傅」：同上
- 「订单完成 / 取消」以外的 status 流转：completed / cancelled 是终态
- 服务 SKU 编码 / 类目不能改：按需求
- 服务 SKU 时长字段写死 60 分钟：按需求
- 首页汇总「待派单」「服务中」是简化算法（`createdAt` desc 排序第一笔 pending），不是真正按业务优先级
