// 业务编码校验 / 生成 — 纯函数测试。

import { describe, expect, it } from "vitest";
import { isValidCode, suggestCode, assertValidCode } from "./codes";

describe("isValidCode", () => {
  it("合法编码通过", () => {
    expect(isValidCode("CLEAN")).toBe(true);
    expect(isValidCode("APPLIANCE")).toBe(true);
    expect(isValidCode("REPAIR-PIPE")).toBe(true);
    expect(isValidCode("C2")).toBe(true); // 最短 2 字符
    expect(isValidCode("A".repeat(32))).toBe(true); // 最长 32 字符
  });

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

describe("suggestCode", () => {
  it("含非 ASCII 字符 → 返回空（拒绝猜测）", () => {
    // 中文 / emoji / 全角字符一律不给建议，调用方按不合法处理
    expect(suggestCode("家政")).toBe("");
    expect(suggestCode("中文SKU")).toBe("");
    expect(suggestCode("中文")).toBe("");
    expect(suggestCode("")).toBe("");
  });

  it("纯 ASCII 字母数字 + 分隔符规范化", () => {
    expect(suggestCode("Home Cleaning")).toBe("HOME-CLEANING");
    expect(suggestCode("appliance_ac")).toBe("APPLIANCE-AC");
    expect(suggestCode("repair pipe")).toBe("REPAIR-PIPE");
    expect(suggestCode("---weird---name---")).toBe("WEIRD-NAME");
    expect(suggestCode("A B C")).toBe("A-B-C");
  });

  it("截断到 32 字符", () => {
    const long = "a".repeat(50);
    expect(suggestCode(long).length).toBe(32);
  });
});

describe("normalizeCode（应用层大小写防线）", () => {
  it("小写 → 大写", () => {
    expect(suggestCode("clean")).toBe("CLEAN");
    expect(suggestCode("Clean-Daily")).toBe("CLEAN-DAILY");
  });

  it("已是大写 → 不变", () => {
    expect(suggestCode("CLEAN")).toBe("CLEAN");
  });

  it("混合大小写 → 全部大写", () => {
    expect(suggestCode("cLeAn")).toBe("CLEAN");
  });

  it("normalize 后空字符串 → isValidCode 拒绝", () => {
    const s = suggestCode("中文");
    expect(s).toBe("");
    expect(isValidCode(s)).toBe(false);
  });
});

describe("assertValidCode", () => {
  it("合法编码不抛", () => {
    expect(() => assertValidCode("CLEAN")).not.toThrow();
  });

  it("非法编码抛错（错误信息含 label）", () => {
    expect(() => assertValidCode("bad code", "skuCode")).toThrow(/skuCode/);
    expect(() => assertValidCode("clean")).toThrow(/格式不合法/);
    expect(() => assertValidCode("")).toThrow();
  });
});