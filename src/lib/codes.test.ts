// 业务编码校验 / 生成 — 纯函数测试。

import { describe, expect, it } from "vitest";
import { isValidCode, suggestCode, assertValidCode } from "./codes";

// # spec: 业务编码格式 = 必须大写字母开头 + 字母数字连字符 + 2-32 字符（应用层唯一防线，SQLite 不支持 @db.Collate）
describe("isValidCode", () => {
  // # spec: 业务编码合法 — 大写字母数字连字符 2-32 字符（含边界值）通过
  it("合法编码通过", () => {
    expect(isValidCode("CLEAN")).toBe(true);
    expect(isValidCode("APPLIANCE")).toBe(true);
    expect(isValidCode("REPAIR-PIPE")).toBe(true);
    expect(isValidCode("C2")).toBe(true); // 最短 2 字符
    expect(isValidCode("A".repeat(32))).toBe(true); // 最长 32 字符
  });

  // # spec: 业务编码非法 — 小写、下划线/空格/点、连字符开头、数字开头、长度越界、纯中文一律拒绝
  it("非法编码拒绝", () => {
    expect(isValidCode("clean")).toBe(false); // 必须大写
    expect(isValidCode("Clean")).toBe(false);
    expect(isValidCode("REPAIR_PIPE")).toBe(false); // 不允许下划线
    expect(isValidCode("REPAIR PIPE")).toBe(false); // 不允许空格
    expect(isValidCode("REPAIR.PIPE")).toBe(false); // 不允许点
    expect(isValidCode("-CLEAN")).toBe(false); // 必须字母开头
    expect(isValidCode("1CLEAN")).toBe(false); // 不能数字开头
    expect(isValidCode("C")).toBe(false); // 最短 2 字符
    expect(isValidCode("A".repeat(33))).toBe(false); // 最长 32 字符
    expect(isValidCode("")).toBe(false);
    expect(isValidCode("中文")).toBe(false); // 不允许中文
  });
});

// # spec: 编码建议规则 = 纯 ASCII 规范化、非 ASCII 直接返回空不猜测；调用方按不合法处理
describe("suggestCode", () => {
  // # spec: 编码建议拒绝猜测 — 含中文/emoji/全角字符一律返回空，不做猜测
  it("含非 ASCII 字符 → 返回空（拒绝猜测）", () => {
    // 中文 / emoji / 全角字符一律不给建议，调用方按不合法处理
    expect(suggestCode("家政")).toBe("");
    expect(suggestCode("中文SKU")).toBe("");
    expect(suggestCode("中文")).toBe("");
    expect(suggestCode("")).toBe("");
  });

  // # spec: 编码建议规范化 — 空格/下划线 → 连字符，转大写，去重连续分隔符
  it("纯 ASCII 字母数字 + 分隔符规范化", () => {
    expect(suggestCode("Home Cleaning")).toBe("HOME-CLEANING");
    expect(suggestCode("appliance_ac")).toBe("APPLIANCE-AC");
    expect(suggestCode("repair pipe")).toBe("REPAIR-PIPE");
    expect(suggestCode("---weird---name---")).toBe("WEIRD-NAME");
    expect(suggestCode("A B C")).toBe("A-B-C");
  });

  // # spec: 编码建议长度截断 — 超过 32 字符的输入截断到 32
  it("截断到 32 字符", () => {
    const long = "a".repeat(50);
    expect(suggestCode(long).length).toBe(32);
  });
});

// # spec: 全 DB 写入路径必须经过 normalizeCode，应用层防线（大小写、非法字符、过长输入都不会污染 DB）
describe("normalizeCode（应用层大小写防线）", () => {
  // # spec: 编码规范化大小写 — 小写/混合大小写输入都转大写
  it("小写 → 大写", () => {
    expect(suggestCode("clean")).toBe("CLEAN");
    expect(suggestCode("Clean-Daily")).toBe("CLEAN-DAILY");
  });

  // # documents current behavior: 已是大写的输入走 suggestCode 不变（无副作用）
  it("已是大写 → 不变", () => {
    expect(suggestCode("CLEAN")).toBe("CLEAN");
  });

  // # spec: 编码规范化大小写 — 混合大小写全部转大写
  it("混合大小写 → 全部大写", () => {
    expect(suggestCode("cLeAn")).toBe("CLEAN");
  });

  // # spec: 编码防线串联 — 中文 suggestCode 后空串被 isValidCode 拒绝
  it("normalize 后空字符串 → isValidCode 拒绝", () => {
    const s = suggestCode("中文");
    expect(s).toBe("");
    expect(isValidCode(s)).toBe(false);
  });
});

// # spec: seed / 内部调用方必须用 assertValidCode；UI 层不抛错（用 isValidCode 给友好提示）
describe("assertValidCode", () => {
  // # spec: assertValidCode — 合法编码不抛错（仅给 seed / 内部调用方用）
  it("合法编码不抛", () => {
    expect(() => assertValidCode("CLEAN")).not.toThrow();
  });

  // # spec: assertValidCode — 非法编码抛错且错误信息含 label，方便定位字段
  it("非法编码抛错（错误信息含 label）", () => {
    expect(() => assertValidCode("bad code", "skuCode")).toThrow(/skuCode/);
    expect(() => assertValidCode("clean")).toThrow(/格式不合法/);
    expect(() => assertValidCode("")).toThrow();
  });
});
