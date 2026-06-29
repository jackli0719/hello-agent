#!/usr/bin/env node
// 测试断言规格标记 lint — 强制每个 it/test 块必须有 # spec: 或 # documents current behavior 注释。
//
// 背景：CLAUDE.md P0-2 要求「测试断言 = 规格，不是现状」。
// v0.2.1 节点已添加 46 个 describe 级 spec 注释（手动覆盖 100%），但**没工具卡点** = 下个新测试可能不写 = 0 标记回归。
// 本脚本：扫 *.test.ts 文件，每个 it() / test() 块必须在它之前有 # spec: 或 # documents: 注释标记。
//
// 设计选择（v0.2.2 决策回报）：
// - 只检查**第 2 行扫描**（it 前 1 行可空行 + 第 2 行是注释），避免误伤（远离 logic）。
// - describe 级 spec 注释不算「满足 it」，因为 it 自己也要标。
// - 退出码：0 = OK，1 = 有未标注 it。
//
// 已知局限（继续观察）：
// - 只扫 `src/lib/*.test.ts`（和 `app/**/*.test.ts`）。新加测试目录时要更新 SCAN_DIRS。
// - 多行 / 嵌套 describe 不区分（it 块紧邻注释即可）。
// - 「# spec:」字符串匹配（不接 AST）= 近似，但工程上够用。

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

const SCAN_DIRS = ["src/lib", "lib", "app"];
const REQUIRED_TAGS = ["# spec:", "# documents"];

// 用 git ls-files 拿真在仓库里的 .test.ts 文件（避免误扫 node_modules / .next）
let files = [];
try {
  const stdout = execSync("git ls-files '**/*.test.ts'", {
    cwd: projectRoot,
    encoding: "utf8",
  });
  files = stdout.split("\n").filter(Boolean);
} catch {
  console.error("❌ check-spec-tags: git ls-files 失败（不在 git 仓库？）");
  process.exit(1);
}

let violations = 0;

// 匹配 it(...) / test(...) —— 容忍空格、引号、单/双/反引号模板字符串
const IT_REGEX = /^\s*(?:it|test)\s*\(/;

// 注释匹配：行首 0+ 空白 + // + 内容，含 "# spec:" 或 "# documents"
const TAG_REGEX = /^\s*\/\/.*(?:# spec:|# documents)/;

for (const rel of files) {
  const abs = path.join(projectRoot, rel);
  const lines = fs.readFileSync(abs, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!IT_REGEX.test(line)) continue;

    // it 块注释前置：line i-1 OR line i-2 中必须有一行是合格 tag 注释
    // - i-1: 紧邻注释行
    // - i-2: 允许中间一个空行
    const prev1 = lines[i - 1] ?? "";
    const prev2 = lines[i - 2] ?? "";
    const hasTag = TAG_REGEX.test(prev1) || TAG_REGEX.test(prev2);
    if (hasTag) continue;

    // 提取 it 的描述（容错不同引号风格）
    const m = line.match(/\(\s*([`'"])([^`'"]+)\1\s*,/);
    const desc = m ? m[2] : "(无法解析描述)";
    const lineNo = i + 1;
    console.error(
      `❌ ${rel}:${lineNo}  it("${desc}") 缺少 # spec: 或 # documents: 注释`,
    );
    violations++;
  }
}

if (violations > 0) {
  console.error("");
  console.error(
    `❌ check-spec-tags: ${violations} 个未标注 it() 块（CLAUDE.md P0-2）`,
  );
  console.error(
    "   添加方式：在 it() 紧邻前一行加 // # spec: <业务语义> 或 // # documents current behavior: <理由>",
  );
  process.exit(1);
}

console.log(`✅ check-spec-tags: ${files.length} 个测试文件全部 it() 已标注`);
