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

// # spec: 字段校验规则 = 必填项、长度上限（姓名 50 / 地址 200 / 备注 500）、手机号 1xx 格式、金额范围、SKU/品类配对
describe("validateCreateOrderInput", () => {
  // # spec: 订单字段校验 — 完整合法输入通过且 cleaned 字段（customerName/amount）保留
  it("完整合法输入通过", () => {
    const r = validateCreateOrderInput(baseValid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.customerName).toBe("测试客户");
    expect(r.cleaned.amount).toBe(158);
  });

  // # documents current behavior: 防御性判空 — 空字符串与 trim 后空字符串都报 customerName 错
  it("空 customerName → field=customerName", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerName: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerName");
  });

  // # spec: 订单字段校验 — 纯空格 customerName 被 trim 后判空，拒绝并指向 field=customerName
  it("纯空格 customerName 被 trim 后判空", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerName: "   " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerName");
  });

  // # spec: 订单字段校验 — customerName 上限 50 字符，超长报错且错误信息含「50」
  it("customerName > 50 字符", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      customerName: "x".repeat(51),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/50/);
  });

  // # spec: 订单字段校验 — customerPhone 必填，空串拒绝并指向 field=customerPhone
  it("空 customerPhone", () => {
    const r = validateCreateOrderInput({ ...baseValid, customerPhone: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  // # spec: 订单字段校验 — customerPhone 必须 11 位 1 开头，位数错拒绝并指向 field=customerPhone
  it("customerPhone 格式不正确（非 11 位 1 开头）", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      customerPhone: "12345",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  // # spec: 订单字段校验 — customerPhone 位数对但非 1 开头也拒绝（不只看长度）
  it("customerPhone 12 位数字但开头不是 1 → 拒", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      customerPhone: "23900000000",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  // # spec: 订单字段校验 — customerPhone 含字母拒绝（纯数字格式）
  it("customerPhone 含字母 → 拒", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      customerPhone: "1390000000a",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("customerPhone");
  });

  // # spec: 订单字段校验 — address 必填，空串拒绝并指向 field=address
  it("空 address", () => {
    const r = validateCreateOrderInput({ ...baseValid, address: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("address");
  });

  // # spec: 订单字段校验 — address 上限 200 字符，超长拒绝并指向 field=address
  it("address > 200 字符", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      address: "x".repeat(201),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("address");
  });

  // # spec: 订单字段校验 — skuCode 必填，空串拒绝并指向 field=skuCode
  it("空 skuCode", () => {
    const r = validateCreateOrderInput({ ...baseValid, skuCode: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("skuCode");
  });

  // # spec: 订单字段校验 — amount 必须是有效数字，NaN 拒绝并指向 field=amount
  it("amount = NaN", () => {
    const r = validateCreateOrderInput({ ...baseValid, amount: Number("abc") });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  // # spec: 订单字段校验 — amount 不能为负数，拒绝并指向 field=amount
  it("amount 负数", () => {
    const r = validateCreateOrderInput({ ...baseValid, amount: -1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  // # spec: 订单字段校验 — amount 上限 100 万，超限拒绝并指向 field=amount
  it("amount > 100 万", () => {
    const r = validateCreateOrderInput({ ...baseValid, amount: 1_000_001 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  // # spec: 订单字段校验 — scheduledAt 必须是有效 Date，Invalid Date 拒绝并指向 field=scheduledAt
  it("scheduledAt 是 Invalid Date", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      scheduledAt: new Date("not a date"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("scheduledAt");
  });

  // # documents current behavior: 空白 categoryCode 视作未填（向后兼容，不报错）
  it("categoryCode 空白字符串 → 当成 undefined（不报错）", () => {
    const r = validateCreateOrderInput({ ...baseValid, categoryCode: "   " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.categoryCode).toBeUndefined();
  });

  // # spec: 订单字段校验 — 有效 categoryCode 字符串原样保留到 cleaned
  it("categoryCode 有效字符串 → 保留", () => {
    const r = validateCreateOrderInput({ ...baseValid, categoryCode: "CLEAN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.categoryCode).toBe("CLEAN");
  });

  // # spec: 订单字段校验 — customerName 前后空格在 cleaned 里被 trim 掉
  it("trim 行为：customerName 前后空格被去掉", () => {
    const r = validateCreateOrderInput({
      ...baseValid,
      customerName: "  张三  ",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.customerName).toBe("张三");
  });
});
