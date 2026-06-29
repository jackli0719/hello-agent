# O2O 上门服务 MVP · 系统架构文档

> **本文件给接手开发者 / 架构师看**：讲清楚第一版 MVP 的架构设计、关键决策、未来扩展方向。
>
> 不重复 README.md（怎么跑）、DEMO.md（怎么演示）、DEPLOYMENT.md（怎么部署）—— 那边讲「How to use」，本文讲「How it works」和「Why so」。

---

## 目录

1. [项目定位](#1-项目定位)
2. [技术栈选型](#2-技术栈选型)
3. [系统架构](#3-系统架构)
4. [数据模型](#4-数据模型)
5. [关键流程](#5-关键流程)
6. [业务规则一栏](#6-业务规则一栏)
7. [工程化约定](#7-工程化约定)
8. [ADR — 架构决策记录](#8-adr--架构决策记录)
9. [已知遗留与未来需求](#9-已知遗留与未来需求)
10. [阶段路线图](#10-阶段路线图)

---

## 1. 项目定位

**第一版 MVP** 是 O2O 上门服务平台的最小业务闭环：客户下单 → 后台派单 → 师傅履约 → 状态实时同步。

**目标人群**（按业务价值排序）：

1. **上门服务团队管理员**（家政/家电清洗/维修/母婴/应急）—— 验证业务可不可行
2. **新加入的开发者** —— 跑通 MVP 代码、改业务规则、加新功能
3. **投资/上级演示** —— 看「是不是个可演示的产品」

**非目标**（明确不做）：

- ❌ 不是 SaaS 产品（无多租户、无计费、无运营控制台）
- ❌ 不直接对接支付 / 通知 / 地图
- ❌ 不做真实登录（演示版硬编码）
- ❌ 不保证线上部署安全（SQLite 演示用）

---

## 2. 技术栈选型

| 层                       | 选型                         | 理由                                                                                               | 备选                                             |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **框架**                 | Next.js 15（App Router）     | RSC + Server Actions 一站式；演示期单仓库即三端                                                    | Remix、纯 React + Express                        |
| **语言**                 | TypeScript 5（strict）       | 全栈类型安全；业务规则（状态机）类型签名兜底                                                       | JavaScript（更松但易错）                         |
| **ORM**                  | Prisma 5                     | 类型安全的 SQL；migration 工具齐全                                                                 | Drizzle（更接近 SQL）、TypeORM                   |
| **数据库（dev）**        | PostgreSQL 16 (docker)       | `db:start` 启 docker container；schema 用 `prisma migrate deploy`；真值 = mock-data.ts via seed.ts | SQLite dev.db（历史快照，**见 ADR-011 补充节**） |
| **数据库（演示用兜底）** | SQLite `prisma/dev.db`       | **v0.2.3 起降级为历史快照**——不是真值。回滚方法：见 ARCHITECTURE [§3.2 目录约定]                   | —                                                |
| **样式**                 | 内联 `style` 属性            | 零依赖、零配置；演示阶段不加 Tailwind 避免膨胀                                                     | Tailwind CSS（生产再上）                         |
| **测试**                 | Vitest                       | v0.2.3 起跑真实 Postgres（CI 也跑 PG service）                                                     | Jest（更老、配置繁琐）                           |
| **日志**                 | 自研 JSON 结构化日志         | 演示阶段不需要接入 ELK；埋点够用即可                                                               | Pino、Winston                                    |
| **指标**                 | 自研 in-process 计数器       | 演示阶段不需要 Prom 导出；够看即可                                                                 | prom-client、OpenTelemetry                       |
| **CI**                   | GitHub Actions               | 跟代码仓库一起                                                                                     | CircleCI、GitLab CI                              |
| **Lint**                 | ESLint v9 + Prettier + husky | pre-commit 卡 lint + format                                                                        | Biome（更快但生态新）                            |

**选型原则**：MVP 阶段任何引入需要 5+ 分钟配置的依赖都先不做，等真要用再补。

---

## 3. 系统架构

### 3.1 分层

```
┌─────────────────────────────────────────────────────────┐
│ 客户端（浏览器）— 桌面 / 移动浏览器                         │
└─────────────────────────────────────────────────────────┘
              │ HTTP（同源 cookie 共享）
              ▼
┌─────────────────────────────────────────────────────────┐
│ Next.js 15 (App Router)                                  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ middleware  │  │  app/*/page  │  │ app/*/actions  │  │
│  │ (路由保护)   │  │  (RSC 页面)   │  │ (Server Actions)│  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                          │                    │         │
│                          └──── src/lib/ ──────┘         │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 业务层（src/lib/）                                       │
│                                                         │
│  orders.ts          ← 业务逻辑（派单 / 状态流转）           │
│  dispatch-rules.ts  ← 派单规则 CRUD                       │
│  services.ts        ← 服务 / SKU CRUD                    │
│  masters.ts         ← 师傅 CRUD + parseSkillsString       │
│  queries.ts         ← 页面级组装（跨表 join + 推荐）        │
│  auth.ts            ← cookie session                      │
│  codes.ts           ← 业务编码 normalize / validate        │
│  logger.ts          ← JSON 结构化日志                      │
│  metrics.ts         ← 业务指标计数器                       │
│  repos/*.ts         ← Prisma 原子操作（单表）              │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ Prisma Client（globalThis 单例）                          │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ PostgreSQL 16（docker:5433）— 真值（mock-data.ts + seed.ts）│
│ SQLite（prisma/dev.db）— 历史快照，**仅作回滚兜底**        │
└─────────────────────────────────────────────────────────┘
```

### 3.2 目录约定（**关键**）

**`@/*` 解析到项目根 `./`**——但项目有 2 个 `lib/`：

| 目录          | 用途              | 导入               | 说明                                                                                                    |
| ------------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js 路由      | `@/app/...`        | **唯一**入口，不写 `src/app/`                                                                           |
| `components/` | 客户端 React 组件 | `@/components/...` | 项目根级，不是 `src/components/`                                                                        |
| `src/lib/`    | **新业务代码**    | `@/src/lib/...`    | auth / codes / masters / services / orders / queries / dispatch-rules / worker / customer / repos/ / db |
| `lib/`        | 演示期遗留        | `@/lib/...`        | `dispatch.ts`（派单匹配纯函数） + `types.ts` + `mock-data.ts`                                           |

**为什么有 2 个 lib/**：

- `lib/dispatch.ts` 是早期示范遗留的纯函数（被 `src/lib/orders.ts` 引用）
- 演示期保兼容；**新业务逻辑一律放 `src/lib/`**

**强制检查**：`npm run lint:paths` 自动跑 `scripts/check-paths.js` 拦下 `src/app/` / `src/components/` 等错误写法。本项目之前踩过 **3 次** `src/app/` 路径坑（订单新建 / 师傅新增 / 服务品类），都是被这个脚本救下的。

### 3.3 三端角色与入口

| 端           | 入口                                                                                  | 是否需登录                       | 鉴权方式                                     |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------- |
| **客户**     | `/customer`、`/customer/orders`                                                       | 否（演示版）                     | 无                                           |
| **后台管理** | `/dashboard`、`/orders`、`/services`、`/masters`、`/dispatch-rules`、`/admin/metrics` | 是                               | cookie `o2o_session` + 硬编码 admin/admin123 |
| **师傅**     | `/worker`、`/worker/orders/[id]`                                                      | 否（演示版用 `?masterId=` 参数） | 无                                           |

**保护机制**：`middleware.ts`（根目录，**不是** `src/middleware.ts`）检查 `PROTECTED_PATHS`，未登录跳 `/login`。

**iframe 演示**：`/demo` 用 3 个 iframe 同源加载三端，cookie 自动共享，只登录一次。

---

## 4. 数据模型

详见 `prisma/schema.prisma`（带完整注释）。下面是 6 张表的核心要点（**[v0.3.0]** 新增 `User` 表）：

### 4.1 关系图

```
ServiceCategory 1 ──── N ServiceSku
                            │
                            │  N
                            ▼
                          Order N ──── 1 Master ──── 0..1 User (worker 账号)
                            │            ▲              │
                            │            │              │ (冗余快照 serviceName / masterName)
                            ▼            │              │
                       DispatchRule       │            1:1 (role=worker)
                       (间接：ruleJson.   │
                        match.skuId       │
                        |categoryId)      │
                                          ▼
                                       User (admin / customer)
```

**[v0.3.0]** `User` 表新增：

- `User.workerId → Master.id`（role=worker 时一对一）
- `Master.user → User?`（反向关系）

### 4.2 字段要点

| 表                  | 关键字段                                                              | 设计决策                                                               |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **ServiceCategory** | `categoryCode`（业务编码）                                            | 大写字母+数字+连字符，应用层强制（`src/lib/codes.ts`）                 |
| **ServiceSku**      | `basePrice`（分）、`durationMinutes`、`requiredSkills`（JSON 字符串） | 金额用「分」避浮点；时长写死 60 分钟按需求                             |
| **Master**          | `skills`（JSON 字符串）、`status`、`serviceArea`（自由文本）          | `status` UI 不暴露（系统自动管）；`serviceArea` 字段已存但匹配逻辑没做 |
| **Order**           | `id`（业务号 `O+YYYYMMDD+xxxx`）、`amount`（分）、`status`            | `serviceName`/`masterName` **冗余快照**，防止 SKU/师傅改名影响历史     |
| **DispatchRule**    | `ruleJson`（JSON：`{match, requiredSkills}`）                         | UI 字段（skuCode/categoryCode）→ repo 层反查 ID 写入                   |
| **[v0.3.0] User**   | `name`（unique）、`role`、`workerId?`、`phone?`                       | 密码明文存（# MVP）；三角色：admin/worker/customer                     |

### 4.3 核心约束

- **`skuCode` / `categoryCode`** 业务编码：应用层强制大写（`normalizeCode`）；SQLite 不支持 `@db.Collate`，**应用层是唯一防线**
- **`Order.amount`** 单位：**分**（避免浮点）
- **`Order.status`** 终态：`completed` / `cancelled`
- **`Master.status`** 系统自动管：`available ↔ busy`，`offline` 是预留
- **业务订单号**：`O + YYYYMMDD + 4位顺序号`，同日并发生成靠 unique 约束 + 重试兜底（`createOrder` 最多重试 5 次）

---

## 5. 关键流程

### 5.1 订单创建（`createOrder`）

```
用户提交表单
    ↓
app/orders/actions.ts (server action)
    ↓
src/lib/orders.ts: validateCreateOrderInput   ← 业务校验（trim + 正则 + 长度）
    ↓
normalizeCode(skuCode / categoryCode)        ← 大小写 / 非法字符规范化
    ↓
prisma.serviceSku.findUnique → 检查 enabled + 配对校验（skuCode 与 categoryCode）
    ↓
generateNextOrderId()                        ← 读 count + 1
    ↓
prisma.order.create（带 unique 兜底 + 重试）
    ↓
logInfo + incrementCounter(ORDER_CREATE_SUCCESS)
    ↓
revalidatePath('/orders') + '/customer'
    ↓
返回 { ok: true, orderId }
```

**关键设计**：

- **服务端独立校验**：客户端传 `masterId` 会被忽略，assignOrder 自己重新算一次推荐
- **订单号生成**：先乐观算 `count+1`，撞 unique 就 +1 重试（MAX_RETRIES=5）

### 5.2 派单（`assignOrder`）

```
后台点「派给他」（前端传 masterId）
    ↓
assignOrder(orderId, masterId)
    ↓
1. 加载订单 + 师傅 → 校验存在 + 状态
   - order.status === "pending"
   - master.status === "available"
    ↓
2. 重新调 recommendMastersForOrder —— 服务端独立校验
   - 前端可以被改包，服务端不信任
    ↓
3. 事务：
   tx.order.updateMany(where: { id, status: "pending" }, data: { assigned })
        ↓ count === 0  →  抛错（被并发抢走）
   tx.master.updateMany(where: { id, status: "available" }, data: "busy")
    ↓
4. 埋点 ORDER_ASSIGN_SUCCESS
    ↓
revalidatePath 多端刷新
```

**乐观锁防并发**：`updateMany + status='pending'` 条件 → 抢单失败的请求返回 `{ ok: false, category: "validation", error: "已被抢走" }`

### 5.3 状态流转（`transitionOrder`）

```
当前状态 → nextStatus 合法性校验（ALLOWED_TRANSITIONS）
    ↓
事务：
  tx.order.updateMany(where: { id, status: order.status }, data: { nextStatus })
        ↓ count === 0  →  抛错（被并发改了状态）
  if (cancelled|completed && masterId):
    tx.master.updateMany(where: { id: masterId, status: "busy" }, data: "available")
    ↓
埋点 + revalidatePath
```

**合法流转表**：

```
pending   → cancelled
assigned  → in_service | cancelled
in_service → completed | cancelled
（completed / cancelled 是终态）
```

---

## 6. 业务规则一栏

| 规则                                                                       | 实现位置                                                                    | 说明                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| 客户姓名 ≤ 50 字、地址 ≤ 200 字、备注 ≤ 500 字                             | `orders.ts: validateCreateOrderInput`                                       | 防御性卡长度                                      |
| 手机号 `/^1\d{10}$/`                                                       | `orders.ts: validateCreateOrderInput`                                       | MVP 固定 11 位 1 开头                             |
| `serviceArea` 是自由文本                                                   | `Master.serviceArea` schema                                                 | **字段有，匹配逻辑没做**（见遗留）                |
| `status` 系统自动管                                                        | `assignOrder` / `transitionOrder`                                           | UI 不暴露 `status` 编辑入口                       |
| 派单先 `skuId` 命中规则 → 兜底 `categoryId`                                | `lib/dispatch.ts: recommendMastersForOrder`                                 | 同类型多条规则按 priority desc，再 id 字典序      |
| 师傅必须 available，技能必须覆盖 requiredSkills                            | `lib/dispatch.ts: coversAll`                                                | 覆盖定义：skills ⊇ requiredSkills（every 都包含） |
| 候选按 rating 降序                                                         | `lib/dispatch.ts: recommendMastersForOrder`                                 | 评分相同由 id 稳定排序兜底                        |
| 金额单位是分                                                               | `prisma: Order.amount`，`orders.ts: createOrder` `Math.round(amount * 100)` | 表单输入元，写库转分                              |
| 推荐失败的订单允许后台人工派单（简化为「没有匹配的派单规则，请人工指派」） | `dispatch.ts`                                                               | UI 显示空候选 + 人工按钮（按 `masterId` 直传）    |
| 状态机终态不可逆                                                           | `orders.ts: ALLOWED_TRANSITIONS`                                            | completed / cancelled 不在表里 = 终态             |
| SKU 不可删除（仅 enabled 切换）                                            | `services.ts`                                                               | 按需求                                            |
| 订单号同日 `O+YYYYMMDD+xxxx`，并发靠 unique + 重试                         | `orders.ts: generateNextOrderId`                                            | 5 次重试兜底                                      |

---

## 7. 工程化约定

### 7.1 命令矩阵

| 命令                     | 作用                          | 何时用               |
| ------------------------ | ----------------------------- | -------------------- |
| `npm run dev`            | dev server + 热重载           | 日常开发             |
| `npm run build`          | 生产构建到 `.next/`           | 部署前 / 验证可构建  |
| `npm run check`          | `tsc --noEmit` + `lint:paths` | CI / 提交前          |
| `npm run test`           | Vitest 单元 + 端到端          | CI / 提交前          |
| `npm run test:coverage`  | 输出 coverage 报告            | 评估测试覆盖率       |
| `npm run lint:paths`     | 单独跑目录检查                | 防 `src/app/` 等踩坑 |
| `npm run format`         | Prettier 写入                 | 本地手动             |
| `npm run db:reset`       | 删库重建 + seed               | 演示搞乱回种子       |
| `npm run db:migrate:dev` | prisma migrate dev            | 生产前迁移用         |
| `npm run db:studio`      | Prisma Studio 可视化          | 调试 DB              |

### 7.2 测试策略

**222 个自动化测试**（截至 2026-06），分层如下：

| 类型                   | 文件示例                                                                                       | 特点                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **业务逻辑纯函数**     | `lib/dispatch.test.ts`、`src/lib/orders.test.ts`、`src/lib/codes.test.ts`                      | 无 DB 依赖、断言具体规格                                        |
| **事务/集成测试**      | `src/lib/orders.assign.test.ts`、`src/lib/orders.transition.test.ts`、`src/lib/worker.test.ts` | 连真实 Postgres；`vitest.config.ts` 关 `fileParallelism` 防污染 |
| **Server Action 测试** | `src/lib/orders.actions.test.ts`、`app/orders/actions.test.ts`                                 | 调 action 端到端                                                |
| **辅助**               | `repos/orders.test.ts`（单表原子操作）、`dispatch-rules.test.ts`                               |                                                                 |

**测试隔离**：每个测试 `beforeEach` / `afterEach` 调 `resetMasterStatuses` + `resetOrder` 清状态。`src/lib/worker.test.ts` 用 `SEED_ORDER_IDS` + `deleteMany` + `resetMastersToSeed` 三步兜底。

**测试断言 = 规格**（CLAUDE.md P0-2）：注释 `# spec: <业务语义>` vs `# documents current behavior`，存疑时默认前者。

### 7.3 提交拦截（husky + lint-staged）

```
pre-commit
  → ts/tsx/js/jsx: prettier --write + eslint --fix
  → json/md:     prettier --write
```

**lint:paths** + **pre-commit** + **CI** 三道关卡兜住质量问题。

### 7.4 可观测性

| 项             | 实现                                               | 展示                        |
| -------------- | -------------------------------------------------- | --------------------------- |
| **结构化日志** | `src/lib/logger.ts`（JSON：info / error / metric） | dev server stdout           |
| **业务指标**   | `src/lib/metrics.ts`（in-process 计数器）          | `/admin/metrics` 页内嵌     |
| **错误堆栈**   | Next.js 默认错误边界                               | 浏览器 console + server log |

**埋点关键路径**：订单创建成功/失败、派单成功/失败、状态流转成功/失败（按目标状态分维度）。

### 7.5 风格约定

- **TypeScript 5 strict**：全栈类型安全，不允许 `any`（必要时 `unknown`）
- **Zod 解析外部输入**：ruleJson 用 `z.object().preprocess()` 宽松解析（坏数据不直接 reject）
- **Prisma 单例**：`globalThis` 防止 dev hot reload 泄露连接
- **内联 CSS**：MVP 阶段演示用，避免 Tailwind 体积/配置成本
- **中文注释**：业务理由写中文，技术细节写英文
- **改 schema 必跑 db:reset**：CLAUDE.md P0-1

---

## 8. ADR — 架构决策记录

> 这些是 MVP 阶段拍板的关键决策。半年后回来不必再问「为什么这么写」。

### ADR-001：SQLite 作开发期数据存储

**Context**：开发体验优先，零配置即可演示。

**Decision**：用 SQLite 文件 `prisma/dev.db`，datasource 配 `file:./dev.db`。

**Consequences**：

- ✅ `npm run db:reset` 一键删库重建
- ✅ fileParallelism 关掉避免测试脏
- ❌ 不能水平扩展，不能跑云上，必须迁 Postgres
- ❌ 写并发 ≈ 1，乐观锁更复杂场景可能撞

**上线条件**：迁 PostgreSQL（`prisma/schema.prisma` 改 `provider` 即可，业务逻辑不变）。

---

### ADR-010：多服务商强隔离架构（**2026-06-29 新增**）

**Context**：师傅都存在于服务商（Provider）下面。服务商是「加盟 / 外包公司」，自带师傅、自接单、自结算。平台是中心调度。

**Decision**：

1. **数据模型加 `Provider` model**，所有 Master / Order 加 `providerId` 外键
2. **Repository 层强过滤**：所有 Master / Order 查询自动 `where: { providerId: currentProviderId }`
3. **认证多加 `ProviderAdmin` 角色**（在 `User.role` enum）
4. **品牌同品牌**（客户看到全是平台品牌）—— 隔离是数据层，品牌是 UI 层，正交
5. **服务商停用** → 该 provider 下所有师傅自动不可派单
6. **结算账户 `SettlementAccount` model** 提前到 P0-6.5 做（合并进 P0-3 支付节奏）

**Consequences**：

- ✅ 后续要扩 SaaS 多租户**架构已就位**，只补 admin 上层
- ✅ 「按服务商看报表 / 服务商互相竞争」直接支持
- ⚠️ **所有现存查询**都要加 `providerId` 过滤，是大面积改造
- ⚠️ seed 数据重写：所有师傅拆到不同 provider 下
- ⚠️ 派单规则涉及「按 provider 过滤」还是「全平台共享」—— P0-5 决策点

**为什么不隔离到 row level security**：MVP 不上 Postgres RLS（要先做 P0-1），应用层强过滤已够。

**与既有决策的关系**：

- ADR-002 「三端共享 + mock 鉴权」= 「上线前改」，现在扩展为四端（加 ProviderAdmin）
- ADR-003 「派单规则显式」= 升级版，混合模式仍要支持 provider 维度
- L8「多租户」= 已从 P2 提前到 P0-6 部分实现

---

### ADR-002：三端共用 1 个 Next.js 项目 + 三端免登录

**Context**：演示期重点是「业务闭环跑通」，不是「安全」。

**Decision**：单仓单进程；客户/师傅端用 mock（演示 URL 参数），仅后台要 cookie 登录。

**Consequences**：

- ✅ 单端口（同源 cookie，iframe demo 共享 session）
- ✅ 部署便宜，单 Next.js 进程
- ❌ 客户改 URL `?customerId=` 就能看别下单——演示版接受
- ❌ 必须迁到真实鉴权（手机号验证码 / 师傅工号）才能上线

---

### ADR-003：派单推荐用「规则显式」而非「自动匹配」

**Context**：MVP 先解决「有结构化的规则系统」，不追求智能派单。

**Decision**：`DispatchRule` 表存 `{match: {skuId|categoryId}, requiredSkills}`，按规则匹配师傅。

**Consequences**：

- ✅ 运营可手动配（不需开发改代码）
- ✅ 规则优先级可控（priority + 字典序兜底）
- ❌ 规则数量随 SKU × 类别 × 技能需求**爆炸**
- ❌ 没有「价格分层 / 服务区域 / 距离」等约束（未来需求，见遗留）

**未来选项**：

- A. 全显式（精细规则）：运营可控，维护成本高
- B. 全自动（数据驱动）：零配置，黑盒
- C. **混合（推荐）**：基础匹配自动 + 例外规则

---

### ADR-004：订单号同日并发用「重试兜底」而非「分布式锁」

**Context**：`O+YYYYMMDD+xxxx` 业务号需要当日唯一。

**Decision**：先乐观算 `count+1`，unique 撞了 +1 重试，最多 5 次。

**Consequences**：

- ✅ 无外部依赖、零配置
- ✅ 99% 场景一次成功
- ⚠️ 极端并发（5 次都撞号）→ 转业务错误返回「订单号生成失败」
- 实际生产应该用 DB sequence（Postgres `serial`）或 Redis 计数器

---

### ADR-005：`Order.status` 和 `Master.status` 用「应用层有限状态机」

**Context**：SQLite 不支持 enum / check 约束。

**Decision**：`ALLOWED_TRANSITIONS` 表 + `transitionOrder` 校验 + 事务里 `updateMany + status 条件` 乐观锁。

**Consequences**：

- ✅ 编译期类型 + 运行期校验双保险
- ✅ 终态防重复操作（completed/cancelled 不在表里 = 不可逆）
- ⚠️ 改合法流转需要改代码（不像 enum 配置）
- 复杂度合适（MVP 只有 4 个状态）

---

### ADR-006：「完成订单」释放师傅回 available（**修正**）

**Context**：早期代码「完成订单」不改师傅状态（MVP 取舍，源头 `src/lib/orders.ts` 注释）。

**Decision**：修改后 `completed` 时也释放师傅回 `available`（见 `transitionOrder` 619-627 行）。

**Consequences**：

- ✅ 师傅完成一单后能接下一单
- ✅ 业务语义对齐「师傅做完应该还能接别的」
- ⚠️ 历史文档 / 注释里残留的「保持 busy」表述需要清理（本 ADR 是更新源）

**Why this matters**：CLAUDE.md P0-4 「业务逻辑简化即 bug」案例之一。

---

### ADR-007：server actions + revalidatePath 替代 REST API

**Context**：演示期无需对外提供 REST。

**Decision**：所有写操作走 server actions（`app/*/actions.ts`），读操作走 RSC。

**Consequences**：

- ✅ 同源 cookie 自动传，无需额外鉴权代码
- ✅ `revalidatePath('/orders')` 一行代码三端同步
- ❌ 跨域 / 外部客户端不友好（需导出 API 时再补 Route Handlers）

---

### ADR-008：`serviceArea` 字段先建后用

**Context**：未来做「服务区域」匹配需要这个字段，MVP 阶段先存上。

**Decision**：`Master.serviceArea` 字段已建（自由文本），UI 有输入框，匹配逻辑**未做**。

**Consequences**：

- ✅ 未来实现「按区域筛选」不用改 schema（不用做 db:migrate）
- ⚠️ 当前完全是个空字段（派单匹配不读它）
- 强烈不推荐用此字段做「demo 显示」以外的事

---

### ADR-009：业务编码强制大写在应用层

**Context**：SQLite 不支持 `@db.Collate`，`skuCode='clean'` 和 `skuCode='CLEAN'` 视为不同值。

**Decision**：所有写入路径都先过 `src/lib/codes.ts: normalizeCode` 强制转大写。

**Consequences**：

- ✅ 唯一防线集中在一处
- ✅ `seed.ts` 用 `assertValidCode` 校验硬编码编码
- ❌ 应用层漏过的就会污染 DB
- ⚠️ 迁 Postgres 时务必加 `@db.Collate("NOCASE")` 双保险

---

## 9. 已知遗留与未来需求

### 9.1 已知遗留（MVP 故意没做）

> 这一节是给下一个开发者的「雷区地图」—— 别踩。

| #   | 项                             | 状态          | 备注                     |
| --- | ------------------------------ | ------------- | ------------------------ |
| L1  | 客户/师傅端真实登录            | 未做          | 演示版硬编码             |
| L2  | 支付（订单金额只展示）         | 未做          | 演示版不结算             |
| L3  | 短信/通知                      | 未做          | 状态变化无推送           |
| L4  | 地图/距离计算                  | 未做          | `serviceArea` 字段空跑   |
| L5  | 删除操作（品类/SKU/师傅/规则） | 禁止          | 仅 enabled 切换代替      |
| L6  | SQLite → PostgreSQL 迁移       | 未做          | 见 ADR-001               |
| L7  | 完整错误上报（Sentry）         | 未做          | dev 靠 console           |
| L8  | 多租户 / 商家端                | 不在 MVP 范围 | 单租户                   |
| L9  | 评价系统                       | 未做          | `Master.rating` 字段空跑 |
| L10 | 财务结算 / 师傅提现            | 未做          | 暂无                     |

### 9.2 已知 Bug（已修但可能在历史分支残留）

| #   | 项                                                            | 修复                                                |
| --- | ------------------------------------------------------------- | --------------------------------------------------- |
| B1  | `available` checkbox 简化为「师傅必 available」时错误覆盖状态 | 已恢复「只覆盖 enabled」语义，详情看 git log        |
| B2  | 「完成订单不释放师傅」                                        | 已修（ADR-006）                                     |
| B3  | 新 SKU 默认 `requiredSkills=[]`                               | 已有 schema 默认值，仍需 UI 层 `defaultSkills` 提示 |

### 9.3 未来需求（非 MVP 范围）

> 用户讨论过的、明确「不在第一版做」的扩展点。

#### F1：真实派单规则（多维度匹配）

**业务背景**：当前只匹配「技能 + 状态 + 类目兜底」，无法处理：

- **价格分层**：高端师傅不接低价单
- **服务区域**：浦东师傅不接浦西单
- **能力 / 等级**：「金牌月嫂」「持证电工」不只靠 requiredSkills 匹配
- **距离 / 覆盖网络**：3 公里内派单

**架构选项**（已讨论，未决）：

- A. 全显式规则（运营配，规则量爆炸）
- B. 全自动匹配（黑盒，无法干预特殊场景）
- C. **混合**：基础匹配（技能/区域/状态自动算）+ 例外规则（业务定制）

**前置数据**：订单侧需描述「期望区域 / 期望等级 / 特殊要求」；师傅侧需描述「可接距离 / 服务价格段 / 资质证书」

#### F2：真实认证体系

- 客户：手机号 + 验证码（第三方登录可选）
- 师傅：工号 + 密码（**隶属于服务商**）
- 服务商管理员（ProviderAdmin）：服务商后台账号
- 平台管理员：多账号 + 角色权限
- **服务商强隔离**：每个 ProviderAdmin 只能看自己服务商下的师傅 / 订单 / 账单

**注**：服务商管理是 P0-6（架构级改动），认证和隔离两块的设计要联动拍板。

#### F3：支付 + 价格计算

- 集成微信支付 / 支付宝
- 价格计算引擎（基础价 + 时长调整 + 加项 + 优惠）
- 退款流程

#### F4：通知 + 推送

- 微信通知 / 短信 / App Push
- WebSocket 实时状态推送（替代现在的 revalidatePath 轮询）

#### F5：地址地图

- 高德 / 百度地图 SDK
- 地址解析
- 距离计算 + 服务区可视化

#### F6：评价 + 客服

- 客户评价订单 / 师傅
- 客服工单系统
- 投诉 + 退款流程

#### F7：数据看板

- 营收 / 师傅绩效 / 品类热度
- 漏斗分析（浏览→下单→成交）

#### F8：合规 / 安全

- HTTPS + 域名 + SSL 证书
- 密码哈希 + 加盐（替换硬编码）
- 数据脱敏
- 个保法 / GDPR 合规（数据删除、用户授权）

---

## 10. 阶段路线图（**2026-06-29 讨论锁定**）

**讨论结论（不动代码，先固化路线）**：上线最小集 = P0（6 项）+ P1 选 1 项。
**时长假设**：agent 工作量（按 AI Agent 执行小时估算）。

### 🥇 P0 — 上线前必修（不可妥协）

总工作量 **~ 46.3 h agent**（关键路径串行），含 6 项：

| #   | 任务                                                                       | 工作量 | ADR / F          | 依赖 |
| --- | -------------------------------------------------------------------------- | ------ | ---------------- | ---- |
| 1   | **数据库 SQLite → PostgreSQL 迁移**                                        | 3.4 h  | ADR-001          | —    |
| 2   | **服务商管理**（架构级新增）                                               | 11.2 h | ADR-010          | 1    |
| 3   | **真实认证体系**（含 ProviderAdmin 角色）                                  | 7.1 h  | ADR-002, F2      | 1, 2 |
| 4   | **支付集成**（微信 / 支付宝 + 价格引擎 + SettlementAccount）               | 8.3 h  | F3               | 2, 3 |
| 5   | **真实派单规则**（区域 + 价格段 + 距离 + 等级 + 超时降级 + provider 过滤） | 9.0 h  | ADR-003 升级, F1 | 2, 3 |
| 6   | **通知系统**（短信 + 微信 + WebSocket/SSE + provider 维度）                | 7.3 h  | F4               | 2-5  |

**依赖顺序**（关键路径）：

```
P0-1 DB迁移 [3.4h]
  └→ P0-6 服务商 [11.2h]   ←── 架构级新增：Master.providerId + Order.providerId
       ├→ P0-2 认证 [7.1h]   ←── 加 ProviderAdmin 角色
       │   ├→ P0-4 派单规则 [9.0h]   ←── 强隔离过滤
       │   └→ P0-3 支付 [8.3h]       ←── 合并 SettlementAccount
       └→ P0-5 通知 [7.3h]   ←── 多 provider 维度
```

**串行关键路径总时长**（最长链）：3.4 + 11.2 + 7.1 + 9.0 + 7.3 = **38.0 h**（P0-3 支付可与 P0-4 并行，加班省 ~2h）

**总日历估算**：按 1 工程日 = 6h agent 工作 + 缓冲，**约 12-14 工程日 ≈ 2.5-3 周**

### 🥈 P1 — 上线后立刻补（讨论锁定：B）

6. ~~评价 + 客服工单（F6）~~
7. **师傅提现 UI**（P0-6 已做 `SettlementAccount` 后端，剩 UI 3.5h）
8. 业务大盘 + 漏斗分析（F7）
9. 地址地图（高德 SDK，F5）
10. 客户 / 师傅小程序 + 师傅 App

### 🥉 P2 — 长期演进

11. 多租户 SaaS 化（**注意**：P0-6 已经是简化多租户，此处是更深度）
12. 链路追踪 + 性能监控（F8 + Sentry/OTel）
13. 灰度发布 + A/B 测试
14. 合规审计（个保法，F8）
15. 国际化 / 多语言

### 🔮 已冻结（不在第一版范围）

- 商家端 SaaS 化
- 完整 BI 系统
- 移动 App 原生开发

### 关键 P0 风险（**讨论讨论后确定**）

- 🔴 **R1** P0-5 派单规则的设计哲学（混合 / 全显式 / 全自动——上一轮讨论推荐**混合**，**待最终签字**）
- 🔴 **R2** 客户手机号存储（明文 / 加密 / 假名化——**待最终签字**）
- 🔴 **R3** 支付通道：agent 阶段必须留 mock 接口（**决策**）
- 🔴 **R4** WebSocket 在 serverless 不行：P0-6 要 SSE / 长轮询方案（**决策**）
- 🟡 **R5** 抽佣模型（P0-3 兼带）
- 🟡 **R6** 评价双向 / 单向（P1）
- 🟡 **R7** 通知模板文案（PM）

### 品牌决策（讨论锁定）

- ✅ **同品牌**：服务商只是「运营划分」，客户看到全是平台品牌，最简；上线后再考虑分品牌
- 与 P0-6 强隔离**正交**：隔离是数据 / 权限层，品牌是 UI / 文案层

---

## 附录

### A. 相关文件索引

- 业务代码：`src/lib/`（按目录约定）
- 测试代码：`*.test.ts`（共 14 个测试文件、222 测试）
- 数据库 schema：`prisma/schema.prisma`（带完整注释）
- 入口页：`app/page.tsx` + `app/layout.tsx`（全局导航）
- 三栏演示：`app/demo/page.tsx` + `app/demo/RefreshAllButton.tsx`
- 业务指标：`app/admin/metrics/page.tsx`
- 工作规则：`CLAUDE.md`（项目内速查）

### B. 文档导航

- [README.md](../README.md) — 30s hook + 5 分钟快速上手 + FAQ
- [docs/DEMO.md](DEMO.md) — 4 步演示脚本 + 验收打勾
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — 部署 / SQLite 限制 / Postgres 迁移
- [docs/HARNESS.md](HARNESS.md) — 工程化能力评估（HARNESS 自评 + 节点历史）
- [docs/FEEDBACK.md](FEEDBACK.md) — 试用反馈模板
- [docs/adr-012-simplification-audit.md](adr-012-simplification-audit.md) — v0.2.7 简化即 bug 系统审计
- [docs/adr-013-account-system-audit.md](adr-013-account-system-audit.md) — v0.3.0 账号体系 + 18 条风险审计
- [docs/postgresql-migration.md](postgresql-migration.md) — SQLite → PostgreSQL 迁移评估
- [docs/sqlite-to-postgres-data-migration.md](sqlite-to-postgres-data-migration.md) — 数据迁移实操手册
- **本文档** — 系统架构 + ADR + 路线图
