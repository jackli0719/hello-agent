# 自我审计反馈：v0.10.0 测试清理 + dev 缓存坑

> **类型**：agent 自我审计（不是用户试用反馈）
> **目的**：把今天两个核心教训沉淀进项目档案，下次不再犯。
> **关联**：[docs/TEST-CHANGELOG.md](TEST-CHANGELOG.md) v0.10.0 段（业务版本号 + 测试变更）

---

## 触及类别（CLAUDE.md 错误卡 8 类）

| 类别                   | 触发的具体错误                                                                               | 严重度 |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------ |
| **类别 1** 需求/范围   | 误把"浏览器 cookie 失效"当代码 bug，浪费 3 轮定位                                            | 🟡 中  |
| **类别 3** 测试方法    | 旧 it() 跑过 = 假装覆盖了"商家过滤"新逻辑，**实际是 prisma IN (undefined) 静默不参与过滤**   | 🟠 高  |
| **类别 4** 流程/工作流 | `rm -rf .next/types` 半清 .next → page.js 引用 + 缺 vendor-chunks/bcryptjs.js 状态错乱 → 500 | 🟠 高  |
| **类别 5** 报告/沟通   | 复现"页面打不开"时用 curl 反复试登录协议 5+ 次，没有第一时间问用户"现象是白屏/转圈/302/500"  | 🟡 中  |

---

## R1（高）：旧测试通过 ≠ 覆盖了新逻辑

### 触发的具体 bug

任务 2 改了 `recommendMastersForOrder` —— 师傅必须归属 `merchantId` + 商家 `status="active"` + 至少有 1 个 `MerchantArea.enabled=true` 且平台区域命中订单地址。

但 `lib/dispatch.test.ts` 旧 it() 全部用 `makeMaster({ skills: [...] })` —— **不传 `merchantId`**。

### 为什么"测试通过"但"没覆盖新逻辑"

```ts
// lib/dispatch.ts filterMastersByArea 内：
const masters = args.masters.filter(
  (m) => m.merchantId !== undefined && merchantIds.has(m.merchantId),
);
```

`merchantId === undefined` 时 → filter 跳过 → master 不出现在推荐 → 测试"不出现"结果跟"被过滤掉"无法区分。

**更阴险的路径**：新代码 `prisma.merchant.findMany({ select: { merchantId: true } })` 返回的 `merchantId` 字段，**类型是 `string | undefined` 但 prisma 不会过滤 undefined**。旧 mock 路径下，`Technician.merchantId` 类型上是 `string | undefined`，传给 prisma `IN (undefined)` —— **prisma 5 + PG 行为是"忽略 undefined"**，等于"没传这个参数" → 测试通过。

### 教训

1. **改业务规则后必须审查"旧测试是否仍能区分新旧逻辑"** —— 不是看"测试通过没"，是看"测试能不能失败"
2. **纯函数测试也要看 mock 完整性** —— `makeMaster` 不传 `merchantId`，等于"这条 it 没在新规则下跑过"
3. **新规则的 it() 必须显式构造"新规则起作用" + "新规则不作用"两个对照场景** —— 只有正向 = 测了个寂寞

### 修法（v0.10.0 实际做了什么）

- `docs/TEST-CHANGELOG.md` 加 v0.10.0 段，列出 DEPRECATED / NEW
- `lib/dispatch.test.ts` `describe("recommendMastersForOrder")` 顶部 banner 说明"旧 it() 不传 merchantId 不覆盖新逻辑"
- 末尾加 2 个新 it()：`[v0.10.0] 商家 status=inactive → 师傅被排除` + `[v0.10.0] MerchantArea.enabled=false → 师傅被排除`
- `src/lib/orders.assign.test.ts` + `orders.transition.test.ts` 头部 banner 说明"本文件不验商家过滤，详见 TEST-CHANGELOG.md"

### 防再犯检查清单

下次改 `recommendMastersForOrder` / `assignOrder` / `createOrder` / `transitionOrder` 任何函数，commit 前跑：

```bash
# 1. 找所有用 makeMaster / makeRule / 类似 mock 工厂的 it()
grep -n "makeMaster" lib/*.test.ts src/lib/*.test.ts

# 2. 每个 it() 检查：mock 是不是覆盖了"新规则起作用"+"新规则不作用"两个场景
# 3. 缺哪个场景就加 it()，不靠"测试通过 = 测了"
```

---

## R2（高）：`rm -rf .next/types` 半清 = 状态错乱 500

### 触发的具体 bug

清掉 `.next/types` 让 `tsc` 重新生成 types（修完 dev-login 端点后的标准操作）→ dev server **继续跑但** page.js 编译引用 `vendor-chunks/bcryptjs`，vendor-chunks 目录里**没有 bcryptjs.js**（只有 @swc / next / zod 3 个 chunk）→ `GET /merchants/M003/edit` 500：

```
Error: Cannot find module './vendor-chunks/bcryptjs.js'
Require stack:
- /Users/.../.next/server/webpack-runtime.js
- /Users/.../.next/server/app/merchants/[id]/edit/page.js
```

### 根因

- `src/lib/auth.ts` 顶层 `import bcrypt from "bcryptjs"`，被 `getCurrentUser` + middleware 拉进所有 RSC
- webpack 把 `bcryptjs` / `iron-session` / `iron-webcrypto` / `cookie` / `uncrypto` 切成独立 vendor chunk
- dev 跑过 `npm run build` 留下混合产物（`.next/BUILD_ID` 存在但 server 目录是 dev 编译出来的）
- 我 `rm -rf .next/types` **只清了 types 目录**，没清 `server/vendor-chunks/` → dev 增量编译时发现"已有这些 chunk 引用但不重新生成"
- 触发条件：dev 跑了几天 + 中途加过 page + 中途 `rm -rf .next/types`

### 教训

1. **`.next` 状态错乱的本质 = "page.js 引用" vs "vendor-chunks 文件"不一致**
2. **半清 `.next` 比不清更糟** —— webpack 不会重新生成已存在的 chunk 引用
3. **唯一安全修法**：`pkill -f "next dev" && rm -rf .next && npm run dev`
4. **判断是不是这个 bug 的快速方法**：`ls .next/server/vendor-chunks/` 数文件，少于 5 个 = 状态错乱

### 防再犯检查清单

任何时候 `npm run check` 报 `.next/types/.../route.ts` 引用不存在的 module：

```bash
# 立即执行（不犹豫）
pkill -f "next dev" && rm -rf .next && nohup npm run dev > /tmp/dev-server.log 2>&1 &
sleep 10
curl -I http://localhost:3000/login  # 必须 200
ls .next/server/vendor-chunks/ | wc -l  # 必须 ≥ 5
```

**不要**只 `rm -rf .next/types` —— 这是过去的错误做法。

---

## R3（中）："页面打不开" = 5 种现象，先问再复现

### 触发的具体 bug

用户报"商家管理 / 平台合作区域页面打不开"。我立刻 curl 复现 → 307 跳 /login → 反复试 server action 协议 5+ 次拿不到 session → 最终发现"用临时端点 seal cookie 后页面 200"。

**用户实际现象 = "登录后访问 /merchants 跳回 /login"**。根因 = 浏览器 cookie 失效，跟代码无关。

### 教训

`AskUserQuestion` 是廉价的。复现路径不对 = 浪费时间 + 制造假 bug。

5 种"打不开"现象对应 5 种修法：

| 现象                | 修法                                   |
| ------------------- | -------------------------------------- |
| 白屏 + console 红字 | 读 stacktrace，定位 React 错误边界     |
| 一直转圈            | 看 dev server log 卡在哪编译           |
| 跳 /login 跳不出去  | 看 cookie：F12 → Application → Cookies |
| 404 / 500 错误页    | 直接读状态码 + 响应体                  |
| OOM / 卡死          | 重启 dev server                        |

### 防再犯检查清单

复现前先问用户：

> "为了精准复现'页面打不开'，请帮我看下具体现象？" + 5 选 1 + "你登录用的什么账号？"

不要自己脑补、不要反复重试。

---

## R4（中）：测试通过 ≠ 测了规格（P0-2 强化）

CLAUDE.md 已有 P0-2「测试断言 = 规格，不是现状」。今天的 Bug 2（`按 createdAt 时间范围过滤（今天）` 跨日失败）是它的具体案例：

测试代码：

```ts
const today = new Date();
today.setHours(0, 0, 0, 0); // 本地时区 0:00 = UTC 16:00 前一天
// ...
expect(r.totalCount).toBeGreaterThan(0); // 假设 seed 跑在今天
```

**这条断言测的是"测试当天"而不是"今天"**。**测了"现状"而不是"规格"**。

### 修法

不写"假设 seed 跑在今天"。写"用第一条订单的真实 createdAt 作锚"：

```ts
const first = await prisma.order.findFirst({ orderBy: { createdAt: "asc" } });
if (!first) return;
const anchor = new Date(first.createdAt);
anchor.setHours(0, 0, 0, 0);
// ... 用 anchor 测
```

**用真实数据当锚，不假设"seed 跑在某个时间"**。

---

## 总结：v0.10.0 触发的 4 个教训

| #   | 教训                            | 修法                                   |
| --- | ------------------------------- | -------------------------------------- |
| R1  | 旧 it() 通过 ≠ 覆盖新逻辑       | docs/TEST-CHANGELOG.md + 新增对照 it() |
| R2  | `rm -rf .next/types` 半清 = 500 | 全清 .next + 重启 dev                  |
| R3  | "打不开"先问不猜                | 5 选 1 AskUserQuestion                 |
| R4  | 测规格不测现状                  | 用真实数据当时间锚                     |

**下一个 v0.10.x commit 之前**：

1. `npm run check` + `npm run test` + `npm run build` 三件套
2. 重启 dev server + 浏览器实测 /merchants /platform-areas /merchants/[id]/edit 3 个页面
3. docs/TEST-CHANGELOG.md 同步更新（如有测试变更）

**不 commit 直到三件套 + 浏览器实测都过**。
