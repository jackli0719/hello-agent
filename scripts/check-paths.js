#!/usr/bin/env node
// 项目级目录约定检查 — 防 `src/app/` vs `app/` 混淆。
//
// 这个项目踩过 3 次：写新页面时容易建到 `src/app/` 但 Next.js 只认根 `app/`。
// 加个 lint 脚本，建错时直接 fail。
//
// 规则：
// 1. 不允许 `src/app/` 目录（Next.js 只认项目根 `app/`）
// 2. 不允许 `src/components/`（客户端组件统一放项目根 `components/`）
//
// 退出码：0 = OK，1 = 有违规

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

const forbiddenDirs = [
  // Next.js 路由 — 必须放项目根
  { path: path.join(projectRoot, "src/app"), reason: "Next.js 路由必须放在项目根 app/，不是 src/app/" },
  // 客户端组件 — 必须放项目根
  { path: path.join(projectRoot, "src/components"), reason: "客户端组件必须放在项目根 components/，不是 src/components/" },
];

let violations = 0;

for (const { path: dir, reason } of forbiddenDirs) {
  if (fs.existsSync(dir)) {
    console.error(`❌ 违规: ${path.relative(projectRoot, dir)}`);
    console.error(`   ${reason}`);
    violations++;
  }
}

if (violations === 0) {
  console.log("✅ 目录约定检查通过");
  process.exit(0);
}

console.error("");
console.error(`共 ${violations} 处违规。修复后重新跑 npm run lint:paths`);
process.exit(1);