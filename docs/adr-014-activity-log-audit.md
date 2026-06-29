# ADR-014 — Activity Log 活动日志阶段审计（v0.4.0 节点）

> **状态**：v0.4.0 **完成稿 + 审计稿**——活动日志阶段实施 + 风险清单。
>
> **关联**：ADR-013（账号体系）·
> [HARNESS.md](HARNESS.md)（v0.4.x 阶段记录）·
> [ARCHITECTURE.md](ARCHITECTURE.md)（数据模型 + Dashboard 模块）

---

## Context

v0.1.0 ~ v0.3.0 阶段**无操作日志**——出问题只能靠 `logger.ts` 看单点 info/error，没有跨动作追溯链路。

v0.4.0 升级为「核心业务动作写库 + Dashboard 最近动态展示」。

按需求：

- ✅ 最小可用，不做复杂审计
- ✅ Dashboard 展示最近 20 条
- ❌ 不做搜索 / 筛选 / 导出 / 删除
- ❌ 不做通知中心 / 推送

---

## 实施内容

### 1. ActivityLog 模型

```prisma
model ActivityLog {
  id         String   @id @default(cuid())
  actorId    String?               // 操作人 User.id（可空 = system）
  actorName  String                // 冗余：避免 User 删除后日志失名
  actorRole  String                // admin | worker | customer | system
  action     String                // order_created / order_assigned / ...
  targetType String                // order / master / serviceSku / dispatchRule
  targetId   String                // 对象 id
  message    String                // 人类可读文案
  metadata   String   @default("{}")  // JSON 字符串（可空）
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([targetType, targetId])
  @@index([actorId])
}
```

### 2. 工具函数

```ts
// src/lib/activity-log.ts
createActivityLog({
  action, targetType, targetId, message, metadata?,
  actorId?, actorName?, actorRole?,  // 不传则从 session 取
})
```

**关键不变量**：

- 失败 `try/catch` 吞掉 → **不影响主业务**（实测验证：脚本上下文调 `getSession()` 报错时，订单生命周期仍正常完成）
- metadata 默认 `"{}"`
- actor 默认从 `getSession()` 取，未登录 → `actorRole=system`

### 3. 埋点动作清单

| action                                                                      | 触发位置                                                                                        | 角色             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| `order_created`                                                             | `app/orders/actions.ts:createOrderAction` + `app/customer/actions.ts:customerCreateOrderAction` | admin / customer |
| `order_assigned`                                                            | `app/orders/actions.ts:assignOrderAction`                                                       | admin            |
| `service_started`                                                           | `runTransition(nextStatus='in_service')`                                                        | worker           |
| `order_completed`                                                           | `runTransition(nextStatus='completed')`                                                         | worker           |
| `order_canceled`                                                            | `cancelDispatchAction` + `runTransition(nextStatus='cancelled')`                                | admin / worker   |
| `master_created` / `master_updated`                                         | `app/masters/actions.ts`                                                                        | admin            |
| `service_sku_created` / `service_sku_updated`                               | `app/services/actions.ts`                                                                       | admin            |
| `dispatch_rule_created` / `dispatch_rule_updated` / `dispatch_rule_toggled` | `app/dispatch-rules/actions.ts`                                                                 | admin            |

### 4. Dashboard「最近动态」

`/dashboard` 末尾新增区块：

- 读最近 20 条 `ActivityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })`
- 字段：时间 / 角色徽标 / 操作人名 / message
- 角色颜色：admin 蓝 / worker 绿 / customer 橙 / system 灰
- 空态：「暂无操作日志」

### 5. Seed 示例

seed 加 5 条 system 角色的初始化日志（service_sku_created / master_created / order_created / order_assigned / dispatch_rule_created），让 Dashboard 启动就有内容看。

---

## 实施过程（按时序）

1. 风险分类（R1-R10，按 P0-0）
2. **P0-1 DB 迁移先行** —— schema 加 ActivityLog → `prisma migrate dev --name add_activity_log --create-only`
3. seed 加 `activityLog.deleteMany()` + 5 条 system 示例
4. 写 `src/lib/activity-log.ts`（try/catch + getSession + listRecentActivityLogs）
5. 改 `TransitionOrderResult` 暴露 `fromStatus` + `masterName`（给 activity-log 用）
6. 埋点 5 个订单动作
7. 埋点 6 个配置动作（master/sku/rule）
8. Dashboard 加「最近动态」区块
9. `prisma generate` + `npm run db:reset` + `npm run check` + `npm run test` + `npm run build`
10. 实测验证：4 个核心动作生成日志（脚本模拟）

---

## 测试结果

| 测试项                   | 结果                                                |
| ------------------------ | --------------------------------------------------- |
| `npm run check`          | ✅ TS + paths + spec + process 全过                 |
| `npm run test`           | ✅ **238/238 通过**（无新增测试）                   |
| `npm run build`          | ✅ 22 路由全编译                                    |
| E2E 模拟（4 个订单动作） | ✅ 4 条日志写入，总 9 条                            |
| 日志失败不影响主流程     | ✅ 脚本上下文 `getSession()` 报错时吞掉，订单仍完成 |

---

## 审计结果（v0.4.0 实跑）

### 🔴 P0 必修

#### A1 · `TransitionOrderResult` 暴露字段给 activity-log 用

- **位置**：`src/lib/orders.ts:548-555`（`fromStatus` + `masterName` 加到 ok:true 分支）
- **风险**：原类型只暴露 `orderId` + `nextStatus`，埋点拿不到 `masterName` → 改了返回类型
- **影响范围**：仅类型扩展，运行时行为不变
- **状态**：✅ 已加（v0.4.0）

#### A2 · ActivityLog.metadata 用 String 跨方言

- **位置**：`prisma/schema.prisma:ActivityLog.metadata`
- **风险**：SQLite/Postgres 都支持 text → 无问题
- **状态**：✅ 已验证

### 🟡 P1 建议修

#### B1 · `getSession()` 在脚本上下文调用失败

- **症状**：从 Prisma 脚本（非 Next.js）调 `createActivityLog` → 内部 `getSession()` 调 `cookies()` 报 NoSuchStoreError
- **缓解**：`try/catch` 吞掉（已实现）
- **影响**：日志**不会写入**（actor fallback 为 system），但**主业务不受影响**
- **建议**：未来加「actor 显式传入」API（已支持）+ 「从 request headers 推 actor」中间件

#### B2 · `createActivityLog` 在 action 里 `await`

- **位置**：所有 server action 里 `await createActivityLog(...)`
- **风险**：fire-and-forget 更高效，但 await 也能保证「写完再返回」（数据一致性）
- **当前**：await —— 简单可靠
- **建议**：高并发场景可改 `void createActivityLog(...)` 不阻塞主流程

#### B3 · Dashboard 读 20 条日志可能慢

- **位置**：`app/dashboard/page.tsx:listRecentActivityLogs(20)`
- **缓解**：已加 `@@index([createdAt])` —— 20 条查询 < 5ms
- **建议**：> 1 万条考虑分页 + 归档表

#### B4 · seed 创建的 system 日志和真实日志混合

- **影响**：Dashboard 展示时无法区分「系统初始化」vs「真实操作」
- **建议**：未来加 `source: "seed" | "runtime"` 字段过滤

#### B5 · 取消订单分散在两个 action 都埋点

- **位置**：`cancelDispatchAction` + `runTransition(cancelled)`
- **风险**：同一订单可能被两个 action 触发 → **会有 2 条 `order_canceled` 日志**
- **当前**：接受（双日志 = 双追溯）
- **建议**：未来合并或加 `source` 字段

### 🟢 P2 可选

#### C1 · 角色用 String（项目惯例）

- **与 ADR-013 B7 一致**

#### C2 · 没有日志归档/删除

- **风险**：1 年后日志表可能 100 万条
- **建议**：cron job 删 1 年前的

#### C3 · 没有按对象/时间筛选

- **按需求不做**

#### C4 · metadata JSON 字段没类型校验

- **建议**：Zod schema 校验（演示期不做）

#### C5 · 没有 IP/UA 记录

- **建议**：加 `metadata.ip` / `metadata.ua`（生产前补）

---

## 上线前必修清单

| #   | 项                       | 工作量估计 |
| --- | ------------------------ | ---------- |
| 1   | 角色 enum（替代 String） | 0.5h       |
| 2   | metadata Zod 校验        | 0.5h       |
| 3   | 日志归档 cron            | 1h         |
| 4   | IP / UA 记录             | 0.5h       |
| 5   | fire-and-forget 改造     | 1h         |

总计 ~3.5h agent 工作量。

---

## Decisions

- ✅ **ActivityLog.metadata 用 String** —— 跨方言兼容
- ✅ **actorId 可空** —— 支持 system 行为（seed / 定时任务）
- ✅ **actorName 冗余存** —— User 删除后日志不失名
- ✅ **`createActivityLog` 失败吞掉** —— 不影响主业务
- ✅ **Dashboard 一次读 20 条** —— 用 `@@index([createdAt])` 保证性能
- ✅ **TransitionOrderResult 扩展字段** —— 类型扩展，运行时不变
- ✅ **取消订单允许双日志** —— 不同 action 不同语义都保留
- ❌ **不做**日志搜索/筛选/导出/删除（按需求）
- ❌ **不做**角色 enum（项目惯例用 String + TS 类型）
- ❌ **不做**日志归档（演示期不需要）

---

**关联**：

- [ARCHITECTURE.md §3.1 分层](ARCHITECTURE.md) — ActivityLog 在业务层
- [HARNESS.md §v0.4.x](HARNESS.md) — 实施过程 + 节点评分
- [ADR-013](adr-013-account-system-audit.md) — 上一阶段审计
- [[o2o-mvp-error-cheatsheet]] — 已同步本 ADR
