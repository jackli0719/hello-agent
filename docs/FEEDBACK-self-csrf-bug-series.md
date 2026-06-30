# CSRF 系列 Bug 自我审计（v0.6.0 → v0.7.7 共 4 次复发）

> **类型**：agent 自我审计（不是用户试用反馈）—— 4 次同类 bug 总结。
> **目的**：让下次新会话 / agent **不再犯**「CSRF 调用方漏 token」这种 bug。

---

## 背景

v0.6.0 修 ADR-013 B6（CSRF token）时，**只考虑了 `loginAction` 一个 server action**。
结果：之后每加一个新 server action，调用方都漏传 `_csrf`，**bug 反复复发 4 次**。

---

## 时间线（4 次同类 bug）

| 版本       | bug 触发                            | 触发位置                                           | 修法                                                      |
| ---------- | ----------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| **v0.6.0** | 加 CSRF 校验（修 ADR-013 B6）       | `loginAction` 头部                                 | `verifyCsrfToken`                                         |
| **v0.7.1** | login 首次访问 cookie 不存在        | login page useEffect 读 cookie                     | middleware 写 csrf cookie                                 |
| **v0.7.2** | logout 报「会话已过期」             | `app/worker/page.tsx` + `customer/orders/page.tsx` | 调用页 RSC 调 `ensureCsrfCookie` + form 内联 hidden input |
| **v0.7.7** | InternalRemarkForm 报「会话已过期」 | `components/InternalRemarkForm.tsx`                | 同 v0.7.2 模式                                            |

---

## 根因分析

### 共同根因

**每加一个新 server action 时，只测了「校验逻辑」单测（vitest 单元函数），没在浏览器走完整 E2E 流程**。

```
写 server action
  ↓
调 verifyCsrfToken（v0.6.0 加的）
  ↓
写单测 verifyCsrfToken("") === false ← 这只测了函数逻辑
  ↓
commit "✅ 246/246 通过"
  ↓
用户实际访问 → 报「会话已过期」
```

### 漏掉的环节

1. **调用方有没有拿 csrf token**？（middleware 写？page 调 ensureCsrfCookie？form 有 hidden input？）
2. **form action 自动传的 FormData 含 \_csrf 吗**？（不含——必须显式 set）
3. **client component 能不能调 ensureCsrfCookie**？（不能，import next/headers 报错）

### 没自动化的检测

- ❌ pre-commit hook 没检查「所有 server action 头部都有 verifyCsrfToken」
- ❌ 测试没断言「client 调用方都传了 _csrf」
- ❌ E2E 浏览器跑登录/登出/取消按钮 → 报「会话已过期」就 fail

---

## 修法（4 步走的，**新加 server action 时必须做**）

### Step 1: 写 server action 头部 CSRF 校验

```ts
// app/orders/actions.ts
export async function myServerAction(formData: FormData) {
  // 1. 头部：CSRF 校验
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return { ok: false, error: "会话已过期，请刷新页面后重试" };
  }
  // 2. 业务逻辑
  ...
}
```

### Step 2: 调用方 RSC 调 ensureCsrfCookie + form 内联

```tsx
// app/xxx/page.tsx (RSC)
import { ensureCsrfCookie } from "@/src/lib/csrf";
export default async function MyPage() {
  const user = await getCurrentUser();
  // ... 校验 ...
  const csrfToken = await ensureCsrfCookie(); // ← 关键：RSC 拿 token
  return (
    <form action={myServerAction}>
      <input type="hidden" name="_csrf" value={csrfToken} /> // ← 关键：form 传
      token
      <button>提交</button>
    </form>
  );
}
```

### Step 3: 加 E2E 单测（防回归）

```ts
// src/lib/orders-cancel.test.ts 模式
it("缺 _csrf → 拒绝", async () => {
  // 调 action，formData 没 _csrf
  const result = await myServerAction(formData);
  expect(result.ok).toBe(false);
});
```

### Step 4: dev 浏览器跑一遍（**类别 8 警示**）

```
跑完整路径：
  1. 打开页面
  2. 填表单
  3. 提交按钮
  4. 看到预期结果（不报「会话已过期」）
```

**只跑 check + test + build 是不够的**——单测不能模拟「调用方漏传 token」的真实场景。

---

## 防再发机制（4 层防御）

### 第 1 层：CLAUDE.md 类别 8c 错误卡（已有）

> 「凡是 v0.6.0 之后新加的 server action，调用方必须做 3 件事」
> 「'会话已过期' = 100% 是 CSRF 调用方漏 token」

### 第 2 层：错误卡里有「下次新会话开始时扫一眼」提示

### 第 3 层：新加 action 时检查清单

```
□ 这个 action 接收 formData 吗？
□ 是登录后才调吗？
□ 调用方是 RSC 吗？调用方能 ensureCsrfCookie() 吗？
□ 调用方是 client component 吗？需要 prop 注入 csrfToken 吗？
□ action 头部有 verifyCsrfToken 吗？
□ 单测有「缺 _csrf → 拒绝」case 吗？
□ 浏览器实际跑了一遍吗？
```

### 第 4 层：错误日志埋点（监控）

```ts
// src/lib/csrf.ts 加埋点（可选 — 演示期不需要）
if (!token) {
  console.warn(
    `[csrf] form token missing — caller likely forgot to pass _csrf`,
  );
}
```

---

## 验证下次没犯的方法

| 验证项                    | 怎么做                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| **新加 server action 时** | 扫这个清单 + 跑 v0.7.2 三个 commit diff                                               |
| **commit msg 检查**       | 包含 "CSRF" 关键词 + 列出 3 件事（ensureCsrfCookie / hidden input / verifyCsrfToken） |
| **每版本回顾**            | commit 历史里 grep "会话已过期" 关键字                                                |

---

## 历史 commit（防止重复）

```bash
git log --oneline --grep "CSRF"
git log --oneline --grep "会话已过期"
```

如果新会话发现这两个 grep 又匹配了 → **bug 又发了**，参考这个文件。

---

## 关联

- [ADR-013 账号体系审计](adr-013-account-system-audit.md) — B6 CSRF token（最初修）
- [ADR-016 账号体系安全加固](adr-016-security-hardening.md) — v0.6.0 加 CSRF（漏了 logout）
- [MEMORY 类 8c「CSRF 调用方漏 token」同类 bug](~/.claude/.../memory/) — 速查卡
- [FEEDBACK-self-v0.7.0-v0.7.1.md](FEEDBACK-self-v0.7.0-v0.7.1.md) — 上次自我审计（发现 bug 但未总结模式）

---

## 自我反思：为什么犯 4 次

```
第 1 次（v0.6.0）：不知道 v0.6.0 之前的「裸 cookie」模式 → 漏考虑调用方
第 2 次（v0.7.1）：只测 cookie 写入，没测调用方拿 token
第 3 次（v0.7.2）：只补 logout，但 worker/customer 没改 — 漏跨调用方
第 4 次（v0.7.7）：新加 action 时没扫"已修过的同类 bug"
```

**根因 1**：每修一个 server action 时，**没问自己**「还有哪些地方调了同款模式」—— 是 search-and-replace 而非 pattern-aware。

**根因 2**：自评报告只写"✅ test 通过"，**没列未验证项**—— 类别 5 警示。

**根因 3**：错误卡（类别 8c）**触发得太晚** —— v0.7.7 才有错误卡，前 3 次都是「先犯后总结」。

**改进**：错误卡**提前预警**——新加任何 server action 之前先扫这个文档。
