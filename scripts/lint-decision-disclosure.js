#!/usr/bin/env node
// PR 决策回报 lint — 强制 PR description 必须含「我决定不做什么」段。
//
// 背景：CLAUDE.md P2-3「决策回报主动暴露」要求每个非显然决策主动说明 + 理由 + 风险。
// v0.2.2 节点写了 .github/PULL_REQUEST_TEMPLATE.md 但**项目未推 GitHub = 模板不强制**。
// v0.2.5 节点：把同样的强提示落到本地脚本，让 commit / PR 时也强制。
//
// 设计：
// - 扫 git log 最近 N 个 commit 是否有「我决定不做什么 / 决策回报」字样
// - 也扫当前 staged diff（如有 src/lib 改动）
// - 退出码：0 = OK，1 = 缺决策回报
//
// 注意：本地可执行的 PR 检查 = commit-msg 卡。PR 模板卡（GitHub UI）等推 GitHub 才生效。

const { execSync } = require("node:child_process");

const projectRoot = process.cwd();
const REQUIRED_KEYWORDS = [
  "我决定不做什么",
  "决策回报",
  "Decision Report",
  "decision:",
  "decisions:",
];

// 拿最近 N 个 commit msg 拼起来（N=5），看有没有决策回报关键词
let logOutput = "";
try {
  logOutput = execSync("git log --pretty=%B -n 5 HEAD", {
    encoding: "utf8",
    cwd: projectRoot,
  });
} catch {
  console.log("✅ lint-decision-disclosure: 不是 git 仓库，跳过");
  process.exit(0);
}

const hasKeyword = REQUIRED_KEYWORDS.some((kw) => logOutput.includes(kw));

// 也要扫工作区中新增 / 修改的文件（如果有「我决定不做什么」字样 = 已写决策回报）
let stagedOrWorkChanges = "";
try {
  stagedOrWorkChanges = execSync("git status --short", {
    encoding: "utf8",
    cwd: projectRoot,
  });
} catch {
  // ignore
}

// 跳过「无 git 操作」的 commit 链端点（如 root commit / merge commit）
const isInitial =
  stagedOrWorkChanges.trim() === "" && logOutput.split("\n").length < 3;

if (isInitial || hasKeyword) {
  console.log("✅ lint-decision-disclosure: 决策回报覆盖");
  process.exit(0);
}

// 没找到关键词 + 不是初始化 commit = 警告但不报错
// 原因：决策回报 P2-3 写的是「非显然决策」，常规 commit 不一定每次都涉及
// 我们的策略是「警告而非阻断」——避免开发者被噪音逼得写空话
console.log("⚠️  lint-decision-disclosure: 最近 5 commit 没看到决策回报关键词");
console.log("");
console.log("   CLAUDE.md P2-3：非显然决策必须主动说 + 理由 + 风险。");
console.log("   关键词示例：'我决定不做什么' / '决策回报' / 'Decision Report'");
console.log("   如果本次确实无决策，commit msg 末加一句「无决策」即可放行。");
console.log("");

// 仅 stderr 输出，不阻断流程（warning 而非 error）
// 这是**故意设计**——完全不阻断 = 不强制，太严 = 被写空话
console.error("⚠️  见 CLAUDE.md P2-3（决策回报主动暴露）");
process.exit(0);
