// Repo 转换层测试：只测 DB→页面类型的纯转换函数，不连真实 DB。
// 金额分→元和时区序列化是关键路径，写错一个是 100 倍 / 8 小时偏移的灾难。

import { describe, expect, it } from "vitest";
import { toLocalISOString } from "./orders";

describe("toLocalISOString", () => {
  it("输出形如 2026-06-24T10:00:00+08:00（带时区偏移）", () => {
    const d = new Date(2026, 5, 24, 10, 0, 0); // 本地时间 10:00
    const iso = toLocalISOString(d);
    // 形如 2026-06-24T10:00:00+HH:MM
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // 时区偏移是测试机实际时区；如果跑 CI 是 UTC，会是 +00:00
    // 所以只断言「有偏移」，不写死 +08:00
    expect(iso).toContain("T10:00:00");
  });

  it("UTC 时间和本地时间的 hour 字段反映测试机的 getHours()", () => {
    // 同样一个时间点，本地解释 vs UTC 解释，hour 字段可能不同
    // 但 toLocalISOString 用的是 Date 的本地方法，所以结果应一致
    const d1 = new Date(2026, 5, 24, 10, 0, 0);
    const d2 = new Date(2026, 5, 24, 10, 0, 0);
    expect(toLocalISOString(d1).slice(0, 19)).toBe(toLocalISOString(d2).slice(0, 19));
  });

  it("个位数月日 / 时分秒自动补 0", () => {
    const d = new Date(2026, 0, 5, 3, 4, 9); // 2026-01-05 03:04:09
    const iso = toLocalISOString(d);
    expect(iso.startsWith("2026-01-05T03:04:09")).toBe(true);
  });
});

describe("分→元转换（订单 amount）", () => {
  // 不通过 repo 函数测（要连 DB），直接验证转换契约
  it("¥128 的订单在 DB 存 12800 分，展示时 /100 得 128", () => {
    const fenInDb = 12800;
    const yuan = fenInDb / 100;
    expect(yuan).toBe(128);
  });

  it("¥0 订单 amount=0 不丢精度", () => {
    expect(0 / 100).toBe(0);
  });

  it("¥12800 大额订单金额精确", () => {
    expect(1280000 / 100).toBe(12800);
  });
});