// createOrder + validateCreateOrderInput 单元测试 — 不连真实 DB 的部分。
// 走真实 DB 的 case（成功创建、SKU 不存在）放在 orders-actions.test.ts。

import { describe, expect, it } from "vitest";
import { validateCreateOrderInput } from "./orders";

const baseValid = {
  customerName: "测试客户",
  customerPhone: "13900000001",
  address: "上海市浦东新区世纪大道 100 号",
  skuCode: "CLEAN-DAILY-2H",
  amount: 158,
  scheduledAt: new Date("2026-06-26T10:00:00"),
};

describe("validateCreateOrderInput", () => {
  it("完整合法输入通过", () => {
    const r = validateCreateOrderInput(baseValid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.customerName).toBe("测试客户");
    expect(r.cleaned.amount).toBe(158);
  });

  it("空 customerName → field=customerName", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerName: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerName");
  });

  it("纯空格 customerName 被 trim 后判空", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerName: "   " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerName");
  });

  it("customerName > 50 字符", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerName: "x".repeat(51) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/50/);
  });

  it("空 customerPhone", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerPhone: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  it("customerPhone 格式不正确（非 11 位 1 开头）", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerPhone: "12345" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  it("customerPhone 12 位数字但开头不是 1 → 拒", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerPhone: "23900000000" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  it("customerPhone 含字母 → 拒", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerPhone: "1390000000a" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  it("空 address", () => {
    const r = validateCreateOrderInput({ ...baseValid, address: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("address");
  });

  it("address > 200 字符", () => {
    const r = validateCreateOrderInput({ ...baseValid, address: "x".repeat(201) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("address");
  });

  it("空 skuCode", () => {
    const r = validateCreateOrderInput({ ...baseValid, skuCode: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("skuCode");
  });

  it("amount = NaN", () => {
    const r = validateCreateOrderInput({ ...baseValid, amount: Number("abc") });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  it("amount 负数", () => {
    const r = validateCreateOrderInput({ ...baseValid, amount: -1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  it("amount > 100 万", () => {
    const r = validateCreateOrderInput({ ...baseValid, amount: 1_000_001 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  it("scheduledAt 是 Invalid Date", () => {
    const r = validateCreateOrderInput({ ...baseValid, scheduledAt: new Date("not a date") });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("scheduledAt");
  });

  it("categoryCode 空白字符串 → 当成 undefined（不报错）", () => {
    const r = validateCreateOrderInput({ ...baseValid, categoryCode: "   " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.categoryCode).toBeUndefined();
  });

  it("categoryCode 有效字符串 → 保留", () => {
    const r = validateCreateOrderInput({ ...baseValid, categoryCode: "CLEAN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.categoryCode).toBe("CLEAN");
  });

  it("trim 行为：customerName 前后空格被去掉", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerName: "  张三  " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.customerName).toBe("张三");
  });
});