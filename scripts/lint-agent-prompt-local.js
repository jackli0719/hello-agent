#!/usr/bin/env node
// .claude/CLAUDE.local.md 验证 lint — 确认 agent prompt 强提示文件存在 + 覆盖关键段。
//
// 背景：CLAUDE.md P1-P3「先问」「复述」「暴露假设」传统上靠人。
// v0.2.2 写了 .claude/CLAUDE.local.md 但**未验证 Claude Code 是否真加载**。
// v0.2.5 节点：本脚本**确认文件存在且内容覆盖关键段**——把"不可验证"变成"可验证"。
//
// 要求（v0.2.5 节点）：
// - 文件存在（不是 v0.2.1 时说的"假卡点"）
// - 含 P0（先问）/ P1（复述）/ P2（暴露假设）三个关键段
//
// 退出码：0 = OK，1 = 文件缺 / 关键段缺

const fs = require("node:fs");
const path = require("node:path");

const file = path.join(process.cwd(), ".claude/CLAUDE.local.md");
const REQUIRED_SECTIONS = [
  { regex: /0\.\s*模糊指令必须先问/, label: "P0：模糊指令必须先问" },
  { regex: /1\.\s*进度汇报分四/, label: "P1：进度汇报分四" },
  { regex: /2\.\s*决策回报主动暴露/, label: "P2：决策回报主动暴露" },
  { regex: /3\.\s*失败时暴露假设/, label: "P3：失败时暴露假设" },
];

if (!fs.existsSync(file)) {
  console.error(`❌ ${file} 不存在 — 流程纪律强提示缺失`);
  console.error("   v0.2.5 起规则要求本文件必存在 + 覆盖 P0-P3 四个段。");
  process.exit(1);
}

const content = fs.readFileSync(file, "utf8");

let missing = [];
for (const { regex, label } of REQUIRED_SECTIONS) {
  if (!regex.test(content)) {
    missing.push(label);
  }
}

if (missing.length > 0) {
  console.error(`❌ .claude/CLAUDE.local.md 缺关键段：`);
  for (const m of missing) {
    console.error(`   - ${m}`);
  }
  console.error("");
  console.error("   修复：v0.2.2 + v0.2.5 模板要求 4 段 P0-P3 全覆盖。");
  process.exit(1);
}

console.log(
  "✅ lint-agent-prompt-local: 4 段 P0-P3 全覆盖（流程纪律工具卡生效）",
);
process.exit(0);
