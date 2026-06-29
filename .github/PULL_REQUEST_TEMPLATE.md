# Pull Request 模板

> **CLAUDE.md P1-2 / P2-3 强制**：每条 PR 必填 4 段。空白段 = **PR 将被 review 拒掉**（v0.2.2 起）。
>
> 模板放置位置：`.github/PULL_REQUEST_TEMPLATE.md`（项目尚未推 GitHub，但模板可提前写——推时自动生效）。

---

## 改了哪些文件

（列举。改超过 5 个文件请说明「为什么是大改动」。）

- `path/to/file1` — 简述改动
- `path/to/file2` — 简述改动

## 跑了什么测试

（CLAUDE.md P0-1：改 schema/规则后立刻验证。必填。）

```bash
# 例：
npm run check       # ✅ TypeScript + 路径 lint + spec 注释 lint 都过
npm run test        # ✅ 222 passed
npm run test:coverage # optional
```

## 验证了什么场景

（端到端步骤 + 实际观察值。不是「应该跑了」）

- 场景 1：... → 观察：...
- 场景 2：... → 观察：...

## 我决定不做什么（**决策回报**）

> CLAUDE.md P2-3「决策回报主动暴露」：非显然决策必须主动说 + 理由 + 风险。

1. 没做 X，因为 Y，**风险是 Z**
2. 简化了 A 为 B，**MVP 业务规则** = 引用 ARCHITECTURE.md 第 N 节
3. ...

> **不填此段 = 默认「我啥也没简化」「我啥也没决定不做的」**。真没决策也说「无」。

---

## ⚠️ 提交前自检 (v0.2.2)

- [ ] `npm run check` 过（含 `lint:spec`——spec 注释卡点）
- [ ] `npm run test` 过
- [ ] 4 段全填
- [ ] 如改了 schema，跑了 `npm run db:reset`
