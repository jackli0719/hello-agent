#!/usr/bin/env node
// commit-msg 提示 lint（prepare-commit-msg 阶段）— 不阻断，仅提示。
//
// 背景：CLAUDE.md P2-3「决策回报主动暴露」+ P1-3「模糊指令先问」需要 commit msg 也体现。
// v0.2.5 节点设计：**不强制阻断**——开发者被噪音逼得写空话是更糟糕的结果。
// 改为：**git commit 后手动跑这个脚本**，看 commit 是否含决策回报关键词。
//
// 用法：
//   npm run lint:commit-msg
//   或 .husky/post-commit 自动跑

const { execSync } = require("node:child_process");

const projectRoot = process.cwd();
const REQUIRED_KEYWORDS = [
  "决策回报",
  "Decision Report",
  "我决定不做什么",
  "未做",
  "决定不",
  "无决策",
  "决策",
  "decision:",
  "decisions:",
];

let logOutput = "";
try {
  logOutput = execSync("git log -1 --pretty=%B", {
    encoding: "utf8",
    cwd: projectRoot,
  }).trim();
} catch {
  console.log("✅ lint-commit-message: 不是 git 仓库，跳过");
  process.exit(0);
}

const hasKeyword = REQUIRED_KEYWORDS.some((kw) => logOutput.includes(kw));

if (hasKeyword) {
  console.log("✅ lint-commit-message: 最新 commit 含决策回报关键词");
  process.exit(0);
}

console.log("─────────────────────────────────────────────────────");
console.log("💡 CLAUDE.md P2-3 提示：本次 commit 没有决策回报关键词。");
console.log("");
console.log("   最新 commit:");
console.log("   " + logOutput.split("\n")[0].slice(0, 80));
console.log("");
console.log(
  "   关键词示例：'我决定不做什么' / '决策回报' / 'Decision Report' / '无决策'",
);
console.log("   如果本次没有非显然决策，加一句「无决策」即可。");
console.log("");
console.log("   不阻断流程——仅提醒，commit 仍成功。");
console.log("─────────────────────────────────────────────────────");
process.exit(0);
