# O2O MVP 已知限制（v0.9.2）

> **本清单列出当前 MVP 故意没做的功能 / 限制**。试用者看到「怎么没有 X？」时来这里查。
> 下一阶段路线图见 [docs/ROADMAP.md](ROADMAP.md)，试用反馈模板见 [docs/FEEDBACK.md](FEEDBACK.md)。

---

## 当前 MVP 已实现的核心能力

✅ 三端完整演示闭环（用户下单 → 后台派单 → 师傅服务 → 用户查询）
✅ Activity Log 操作日志（11 个动作埋点 + Dashboard 最近动态 + /activity-logs 筛选）
✅ 订单筛选 / 搜索 / 分页（按状态 / SKU / 时间范围 / 关键词）
✅ 师傅端订单按状态分组（待服务 / 服务中 / 已完成 / 已取消）
✅ 用户端订单详情页
✅ 订单备注（用户下单备注）+ 内部备注（admin 内部备注）+ 服务完成说明（师傅填）
✅ 取消订单规则（所有状态必填 cancelReason）
✅ Demo 数据初始化 / 一键重置（npm run seed:demo）
✅ 基础数据校验（12 个 validation 函数集中化）

---

## 已知限制（故意没做）

### 1. ~~当前没有真实支付~~ [部分解决 2026-07-03]

- **现状（[任务 X] 支付下单闭环）**：
  - ✅ **Order.payStatus 字段已加**（unpaid / paid / refunded），migration `20260703061943_add_pay_status`
  - ✅ **模拟支付** — 客户在 `/customer/orders/[id]` 点「立即支付」（演示用按钮，不接真实微信/支付宝）
  - ✅ **派单守门** — `assignOrder` 校验 `payStatus === "paid"`，未支付订单会拒绝派单（验收点）
  - ✅ **业务规则**：`status=pending + payStatus=unpaid` = 待支付；`status=pending + payStatus=paid` = 待派单
  - ❌ **真实支付** — 不接微信/支付宝/银联，演示期
  - ❌ **退款** — schema 预留 `refunded` 字段，本次不做退款 UI
  - ❌ **支付时间窗**（30 分钟未付自动关闭）— 不在 MVP 范围
- **影响**：演示闭环完整，但**任何人都能点「立即支付」**，没有真钱流动
- **真实场景差异**：美团 / 58 等都有真实支付 + 退款 + 资金分账
- **下一阶段**：见 [ROADMAP.md P2-1](ROADMAP.md#p2--体验优化中期)

### 2. 当前没有短信验证码

- **现状**：登录只用账号 + 密码，无短信验证；客户查询订单也只用手机号
- **影响**：账号安全性低（密码泄露即丢号）；客户手机号真实性无法保证
- **真实场景差异**：所有真实 O2O 平台都有短信验证码 + 通知
- **下一阶段**：见 [ROADMAP.md P2-2](ROADMAP.md#p2--体验优化中期)

### 3. 当前没有地图定位

- **现状**：师傅服务范围用字符串（"上海, 苏州"），派单推荐只按技能匹配
- **影响**：师傅实际能不能接单（距离 / 交通）不知道；客户也不知道师傅具体位置
- **真实场景差异**：O2O 平台都集成高德 / 百度地图 + 距离计算
- **下一阶段**：见 [ROADMAP.md P2-3](ROADMAP.md#p2--体验优化中期)

### 4. 当前没有真实线上部署

- **现状**：默认本地 Docker PostgreSQL + 本地 dev server
- **影响**：试用必须在自己电脑跑；不能给远程客户演示
- **真实场景差异**：SaaS 产品一般部署在云（Vercel / 阿里云 / AWS）
- **下一阶段**：见 [ROADMAP.md P3-1](ROADMAP.md#p3--未来规划长期)

### 5. 当前权限还是最小角色权限

- **现状**：3 个固定角色（admin / worker / customer），无细粒度权限矩阵
- **影响**：admin 不能限定到「只管理订单」；worker 不能限定到「只看自己的订单」
- **真实场景差异**：真实 SaaS 都有「运营 / 客服 / 主管 / 老板」等多角色 + 自定义权限
- **下一阶段**：见 [ROADMAP.md P1-1](ROADMAP.md#p1--影响试用和演示)（真实登录顺带 RBAC）

### 6. ~~当前没有财务结算~~ [部分解决 2026-07-03]

- **现状（v0.7.0 → v0.10.x）**：
  - ✅ **商家维度**：MerchantSettlement（pending/confirmed/archived 状态机）+ WithdrawRequest（提现申请 + 审核）+ PayoutRecord（线下打款）+ FinanceLedger（财务流水）
  - ✅ **师傅维度**（[任务 17]）：WorkerSettlement（按 worker × period 汇总）— 2026-07-03 新增
  - ❌ **师傅提现/打款**：师傅无提现流程（演示期未实现）
- **影响**：商家可走完整提现链路；师傅只有收入汇总，无法提现
- **真实场景差异**：O2O 平台应支持师傅提现到支付宝/微信
- **下一阶段**：见 [ROADMAP.md P3-2](ROADMAP.md#p3--未来规划长期)

### 7. 当前没有评价系统

- **现状**：订单完成后客户无法评价师傅；师傅 rating 字段是硬编码初始值
- **影响**：新客户选择师傅只能看历史完成单数；无法筛选「4.5 星以上」
- **真实场景差异**：美团 / 58 等都有详细评分（态度 / 专业度 /准时等）
- **下一阶段**：见 [ROADMAP.md P2-6](ROADMAP.md#p2--体验优化中期)

### 8. 当前没有售后系统

- **现状**：订单完成后客户无法发起投诉 / 申请售后 / 申请返工
- **影响**：服务质量问题只能线下沟通；平台无法介入
- **真实场景差异**：O2O 平台都有「售后工单」独立系统
- **下一阶段**：见 [ROADMAP.md P2-7](ROADMAP.md#p2--体验优化中期)

### 9. 当前没有商家端

- **现状**：单租户 — 一家公司一个后台；不能支持「多家服务商（家政公司 / 家电清洗公司）入驻」
- **影响**：想做 SaaS 平台模式必须重构数据模型
- **真实场景差异**：所有 SaaS O2O 都是多租户（每个商家独立数据）
- **下一阶段**：见 [ROADMAP.md P3-3](ROADMAP.md#p3--未来规划长期)

### 10. 当前 Demo 数据可被重置

- **现状**：`npm run seed:demo` 会清空所有业务数据并写入演示数据
- **影响**：
  - **演示阶段**：方便 — 一键回到干净状态
  - **真实场景风险**：如果误在生产库跑，会删掉所有订单 / 日志
- **当前保护**：
  - README 标注「不要在生产库跑」
  - DEMO.md 标注「不要在生产库跑」
  - **没有技术性阻断**（读 .env 判断 prod）
- **下一阶段**：增加 prod 环境检测（如 `NODE_ENV=production` 时拒绝执行）

---

## 其他小限制（不一定需要修）

### 11. 密码明文存储

- **现状**：v0.3.0 加了 bcrypt 哈希（rounds=10），但 schema 注释里还写「MVP 明文存」
- **实际**：已经是 bcrypt 哈希，schema 注释过时
- **影响**：注释可能误导读者
- **修复**：等下次 schema 改时清理注释

### 12. 没有删除功能

- **现状**：服务品类 / SKU / 师傅 都不能删，只有「启用 / 停用」开关
- **影响**：试用者经常问「怎么删？」
- **设计理由**：演示阶段防止误删；真实业务需要更复杂的级联删除 + 软删除
- **下一阶段**：等真实业务需求明确再加

### 13. 服务 SKU 时长字段硬编码 60 分钟

- **现状**：新建 SKU 默认 `durationMinutes = 60`，UI 不暴露编辑
- **影响**：所有服务都按 60 分钟展示
- **修复**：UI 加编辑字段

### 14. 首页汇总算法简化

- **现状**：「待派单」「服务中」统计是简化算法（`createdAt desc 第一笔 pending`）
- **实际**：应该按业务优先级排序
- **影响**：首页数字可能跟 /orders 页不一致

### 15. Sidebar 1024px 以下未做断点隐藏 [v1.x]

- **现状**：`AdminShell` 对所有 admin 路径总是渲染 sidebar（230px 宽）
- **影响**：1024px 以下页面会出现横向滚动条，sidebar 内容需要滚动才能看完
- **当前保护**：Sidebar 内部可折叠成 56px 图标条，但仍未解决横向溢出
- **决策回报**：见 `components/Sidebar.tsx` 头部注释 — 当前决定不做 mobile drawer / 断点隐藏
- **下一阶段**：加 CSS `@media (max-width: 1024px)` 自动折叠 + 或者 worker/customer 一样用顶部横排

### 16. ~~T13/T14 verify 脚本未进入 Vitest 主测试链路~~ [已解决 2026-07-03]

- **原状**：`scripts/verify-withdraw-request.ts` 和 `scripts/verify-finance-ledger.ts` 是 tsx 跑的脚本，不在 `npm run test` 链路
- **解决**：已迁移到 Vitest 集成测试
  - `tests/integration/finance.withdraw-request.test.ts`（2 cases）— 复合断言 + 列表查询
  - `tests/integration/finance.ledger.test.ts`（8 cases）— 多维过滤 + 统计卡
- **遗留**：其他 4 个 verify 脚本（verify-chain / dispatch / invite / payout）仍在 `scripts/` 下，单独跑 — 优先度低，业务规则已被 src/lib/*.test.ts 单测覆盖

### 17. 商家后台 admin 越权入口已收口（fallback 第一个 active 商家）[任务 18]

- **原状**：admin 角色登录 `/merchant-admin/*` 时，半成品 layout 放行 admin，但 5 子页 guard 校验 `user.merchantId`（admin 为 null），全显「未绑定 merchantId」红字
- **解决**：
  - `src/lib/merchant-admin.ts` 新增 `getEffectiveMerchantId(user)` helper
  - 规则：merchant 角色 → 用 session.merchantId；admin 角色 → 动态取 `prisma.merchant.findFirst({ where: { status: "active" }, orderBy: { id: "asc" }})`；worker/customer → 抛错
  - 5 子页 + 总览页 guard 改用 helper，admin 进 `/merchant-admin` 不再红字
  - `React.cache()` 包裹：同 request 内 5 子页调用只跑 1 次 DB query
- **数据层零信任调用方（merchantId 来源唯一 = session）**：
  - 所有 page.tsx 中 `merchantId = await getEffectiveMerchantId(user)`，**不接 URL.searchParams / form data**
  - `grep -rn 'searchParams.*merchantId' app/merchant-admin/` 返回 0 命中（仅读 `error` / `created` 等 UI 反馈字段）
  - 回归测试：`src/lib/merchant-admin.test.ts` 的 "merchant1 调用 getEffectiveMerchantId 永远返 M001" it()
  - 即 merchant1 访问 `/merchant-admin?merchantId=M002`，实际查 session merchantId (M001) → 不会拿到 M002 数据
- **admin fallback 副作用**：
  - admin 角色进 `/merchant-admin` 默认看 id 最小的 active 商家（M001，因 seed 顺序）
  - 这是演示期排障便利决策；**不是** admin 真有商家数据访问权
  - 上线后建议：layout 对 admin 也跳 `/dashboard`（或 403），把 fallback 逻辑删掉
- **决策回报**：见 plan 文件 `merchant-admin` 任务第 3 决策

---

## 试用反馈

试用时如果发现新问题 / 限制，请填 [docs/FEEDBACK.md](FEEDBACK.md) 提交。

我们按 P0-P3 分级处理：

- **P0** — Beta 必修
- **P1** — 下一 sprint
- **P2** — 中期 backlog
- **P3** — 长期规划

### 18. 订单取消/退款流程（任务 19）

- **原状**（任务前）：
  - `cancelOrderAction` 只改 `status=cancelled`，**不动 `payStatus`** — 已支付订单取消后 payStatus 仍是 paid，财务上等于"客户付了钱但没拿到服务 + 没退款"（P0 隐患）
  - `payStatus` schema 注释「refunded 预留字段本次不做 UI」 — 退款 UI 完全没有
  - 商家端无 cancel 入口（任务要求"用户/商家/后台可取消"含商家）
  - 已完成订单发现问题后无售后退款入口
- **解决**（任务 19）：
  - **`payStatus` 扩到 4 态**：`unpaid | paid | refunding | refunded`（schema.prisma + src/types/index.ts + app/orders/page.tsx 过滤器同步）
  - **cancel 联动退款**：`transitionOrder` 事务内检测 `cancelled + payStatus=paid` → 事务一步 `payStatus=refunded`（与 status 同步原子写）
  - **独立售后入口** `refundOrder(orderId)`：仅 `completed + payStatus=paid` 可走，事务乐观锁
  - **3 端 server actions**：
    - `customerCancelOrderAction`（既有，加联动退款）
    - `customerRefundOrderAction`（新）— 客户申请售后退款，越权防护 `user.phone === order.customerPhone`
    - `adminRefundOrderAction`（新）— admin 代任何订单发起售后退款
    - `merchantCancelOrderAction`（新）— 商家取消本商家师傅接的订单，越权防护 `master.merchantId === user.merchantId`
  - **3 端 UI**：
    - customer 详情页：completed + paid 时显示「申请售后退款」按钮 + 已退款状态文案
    - admin 订单列表：completed + paid 行的 OrderActions 组件显示「售后退款」按钮
    - merchant 端新建 `app/merchant-admin/orders/[id]/page.tsx` 详情页 + `merchantCancelOrderAction`；列表行可点详情
- **退款中间态 `refunding` 状态机**：
  - 演示期不接真实通道，事务内一步到 `refunded`；`refunding` 字段保留给真实通道（"先发起退款→等回调→成功再改 refunded"）
  - assignOrder 守门 `payStatus !== "paid"` 已自动拒绝 refunding 订单（无新代码）
- **已退款订单的二次防御**：
  - `payOrder` 守门：refunded 订单不能再付
  - `refundOrder` 乐观锁：第二次 refundOrder 被 updateMany 条件拒绝
- **测试覆盖**（`src/lib/orders.refund.test.ts`，13 个 it）：
  - cancel 联动退款 3 个状态分支（paid+pending / unpaid+pending / paid+in_service）
  - refundOrder 5 个守门 + 1 个不存在的订单 + 1 个乐观锁
  - assignOrder 拒绝 refunding 订单回归
  - payOrder 拒绝 refunded 订单回归
  - 每个 describe 用 `beforeEach/afterEach` 自建测试订单 + 清理（不污染 seed）
- **决策回报**：
  - 选了「cancel 自动联动退款」而非「cancel/refund 独立」：业务上客户体验更顺（一句话"取消=退款"）
  - 选了「加 refunding 中间态」：给真实通道留口子，演示期一跳到 refunded
  - 选了「做 merchant 端 cancel」：任务原文"用户/商家/后台可取消"包含商家
  - 选了「全套 (后端 + UI + 测试)」：不留 TODO
- **遗留 / 不做**：
  - 真实支付通道集成（`payStatus=refunding` 状态机已留接口）
  - 商家端 cancel 自动通过 admin 审核（演示期直接生效，真实业务可加 24h 审核窗口）
  - 部分退款 / 自动退款到原支付渠道
  - `FinanceLedger` 退款冲正（任务 14 财务流水按 settlement 走；售后退款是 order 级，独立维度）
