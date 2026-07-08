# 测试变更记录（Test Changelog）

> 记录**测试**何时被弃用 / 替换 / 标注。**业务代码变更在 git log + ADR，业务代码版本号不变；本文档只追踪"测试"的历史状态。**
>
> 命名约定：
>
> - `[v0.x.y DEPRECATED]` — 测试已不反映当前业务逻辑，但代码还在（注释 + skip 标记）。原因 + 替代测试位置
> - `[v0.x.y SUPERSEDED]` — 被同文件内另一个 it() 替代（行号写明）
> - `[v0.x.y NEW]` — 新增测试覆盖新逻辑

---

## v0.10.0 — 平台合作模式底座（任务 2：MerchantArea + Master.merchantId）

**业务代码变更**：

- `Master.merchantId` 必填 FK（v0.10.0 引入）
- `MerchantArea` 模型（多对多 + 唯一约束）
- `recommendMastersForOrder` 过滤规则新增：商家 `status="active"` + 商家至少一个 `MerchantArea.enabled=true` 且 platformArea 命中订单地址
- `bindMerchantArea` 校验 `merchant.status="active" + platformArea.enabled=true`

**测试影响盘点**（任务 2 完成时）：

### DEPRECATED — 不再反映新逻辑

| 文件                                                                              | it()                                                                                                                | 原因                                                                                                                                                                                  | 替代                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `lib/dispatch.test.ts` 行 124, 144, 186, 207-208, 231-237, 259-261, 278, 296, 317 | 所有 `makeMaster()` 没传 `merchantId` 的 it()                                                                       | `recommendMastersForOrder` 现在按 `master.merchantId` 过滤；不传 `merchantId` 时 merchant 字段为 undefined，**prisma IN (undefined) 等价于不参与过滤** → 测试通过但没真正覆盖商家过滤 | 见下方 `[v0.10.0 NEW]` 新增 it() |
| `lib/dispatch.test.ts` 行 336-405                                                 | `makeMaster({ id: "M1", ..., merchantId: "MERCHANT-1" })` + `merchantAreas: [makeMerchantArea()]` — 已传 merchantId | **不算 deprecated**，但**只覆盖了"1 个商家绑定 1 个区域"的简单路径**；不覆盖「商家多区域 + 平台区域 enabled=false 排除」                                                              | 后续 v0.10.x 补                  |

### NEW — 补覆盖

| 文件                   | it()                                                           | 覆盖什么                                         |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `lib/dispatch.test.ts` | 新增「商家 status=inactive 时该商家师傅被排除」                | `master.merchant.status=inactive` → 不出现在推荐 |
| `lib/dispatch.test.ts` | 新增「商家所有 MerchantArea enabled=false 时该商家师傅被排除」 | 平台区域启用状态参与派单                         |
| `lib/dispatch.test.ts` | 新增「订单地址不在任何商家平台区域时该商家师傅被排除」         | 区域感知过滤                                     |

### 实际处理（v0.10.0 commit）

- **不改 it() 业务逻辑**，仅在以下位置加 banner 注释：
  - `lib/dispatch.test.ts` — `makeMaster` 工厂函数 + `describe("recommendMastersForOrder")` 顶部
  - `src/lib/orders.assign.test.ts` — 文件头部说明商家过滤在 dispatch.test.ts 覆盖
  - `src/lib/orders.transition.test.ts` — 文件头部说明 transitionOrder 不查商家
- **新加 2 个 it()** 在 `lib/dispatch.test.ts` 末尾（v0.10.0 起）：
  - `[v0.10.0] 商家 status=inactive → 旗下师傅不出现在推荐` — 覆盖 `merchant.status` 过滤
  - `[v0.10.0] 商家所有 MerchantArea.enabled=false → 师傅不出现在推荐` — 覆盖 MerchantArea.enabled 过滤
- 复跑 `npm run test` 全过 (320+ passed)
- 故意**不**用 `it.skip()` 标记旧 it() —— 旧 it() 测试的还是合法的"基础派单规则"，只是不直接验"商家过滤"；保留它们 = 这些核心规则还受回归保护

---

## v0.9.x — 历史弃用（按版号）

### [v0.9.2] seed-demo 重整

| 弃用                                    | 替换                |
| --------------------------------------- | ------------------- |
| 5 师傅（T001-T005）                     | 4 师傅（T001-T004） |
| `dispatch.test.ts` 用 `T005` 的所有测试 | 改用 `T004`         |

- 涉及文件：`src/lib/orders.assign.test.ts` 行 10-15（resetMasterStatuses map 移除 T005）
- 涉及文件：`src/lib/orders.transition.test.ts` 行 9（注释）
- 涉及文件：`app/orders/actions.test.ts` 行 105（注释）
- 涉及文件：`src/lib/services.test.ts` 行 373（注释 3 个品类）

### [v0.9.0] 业务规则 #14 — 所有 cancel 必填 cancelReason

| 弃用                             | 替换                               |
| -------------------------------- | ---------------------------------- |
| 旧规则：只 `in_service` 必填原因 | 新规则：所有 cancel 状态都必填原因 |

- 涉及文件：`src/lib/orders.transition.test.ts`（行 67, 103）
- 涉及文件：`src/lib/orders-cancel.test.ts`（行 173, 190, 377, 402）
- 涉及文件：`app/orders/actions.test.ts`（行 346, 359）

### [v0.9.4] 鉴权 / CSRF 收口（v0.9.8 完整体）

- `app/orders/actions.test.ts` 行 21-22 + 行 379：mock 鉴权默认 admin；权限失败路径测试在 v0.9.8 组 5
- `src/lib/auth-helpers.test.ts` 行 1：组 1 鉴权/CSRF helper 底座
- `app/worker/actions.test.ts` 行 1 + `src/lib/orders-internal-remark.test.ts` 行 1-2：组 5 鉴权失败路径

### [v0.7.x] CSRF 漏调用系列（修 v0.7.2 logout 漏 CSRF bug 防回归）

- `src/lib/orders-internal-remark.test.ts` 行 102, 105：缺 `_csrf` → 拒绝（v0.7.6 漏 CSRF 同类 bug）
- `src/lib/logout-csrf.test.ts`：v0.7.2 修 logout 漏 CSRF
- `src/lib/orders-cancel.test.ts` 行 479, 499：v0.7.9 修"活动日志在脚本上下文被 getSession 吞"

### [v0.7.6 / v0.7.7 / v0.7.9] 修同类 bug

- `src/lib/orders-cancel.test.ts` 行 1：v0.7.9 取消订单规则
- `src/lib/orders-internal-remark.test.ts` 行 1-2：v0.7.7 R5 InternalRemarkForm 缺单测
- ADR：`docs/adr-017-logout-csrf-convention.md`

---

## 维护约定

**每个 commit 引入"业务规则变更"时**，必须：

1. 在本文件加新一段 `[v0.x.y] 业务规则名`
2. 列出本规则影响到的测试 it() + 文件:行号
3. 标注是 DEPRECATED（旧测试已不反映新逻辑，需 skip）/ SUPERSEDED（同文件新 it 替代）/ NEW（新加 it 覆盖新逻辑）
4. **不删旧测试代码**，仅 `it.skip()` + 注释 + 本文件记录
5. 提交后 `npm run test` 全过 = 验证完成
