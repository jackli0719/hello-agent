// createPayoutRecord 业务规则测试 — 连真实 SQLite
// 覆盖：
//   1. 金额正数校验（≤0 拒）
//   2. 状态闸门：pending 拒 / confirmed 允 / archived 允
//   3. Σ 累计校验：累计 ≤ merchantIncome；超额拒；边界恰好等于允
//   4. proofUrl 校验：空 OK / http:// OK / https:// OK / ftp:// 拒 / xxx 拒
//   5. paidAt 必填：缺失报错

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPayoutRecord, isValidUrl } from "./payout";
import { prisma } from "@/src/lib/db";

const TEST_PERIOD = "2099-12";
const TEST_MERCHANT_INCOME = 10000; // ¥100

type SettlementSnap = { id: string };

async function cleanupSettlements(ids: string[]) {
  if (ids.length === 0) return;
  // payout 会随 settlement cascade 删除
  await prisma.merchantSettlement.deleteMany({ where: { id: { in: ids } } });
}

async function createTestSettlement(
  status: "pending" | "confirmed" | "archived",
): Promise<SettlementSnap> {
  const merchant = await prisma.merchant.findFirst({
    where: { status: "active" },
  });
  if (!merchant) throw new Error("seed 没建 active merchant");
  // 找一个远期 period 避免和 seed 撞
  const period = `${TEST_PERIOD}-${Math.floor(Math.random() * 10000)}`;
  const s = await prisma.merchantSettlement.create({
    data: {
      merchantId: merchant.id,
      period,
      totalOrderCount: 1,
      totalAmount: 30000,
      platformFee: 20000,
      merchantIncome: TEST_MERCHANT_INCOME,
      workerIncome: 0,
      status,
    },
  });
  return { id: s.id };
}

describe("isValidUrl", () => {
  // # spec: URL 校验规则 = http(s):// 开头 + 非空
  it("http:// 开头 → true", () => {
    expect(isValidUrl("http://example.com/proof")).toBe(true);
  });
  // # spec: URL 校验规则 = https:// 开头必须通过
  it("https:// 开头 → true", () => {
    expect(isValidUrl("https://example.com/proof")).toBe(true);
  });
  // # spec: URL 校验规则 = 仅 ftp:// 等其他 protocol 必须拒（业务只允许 web URL）
  it("ftp:// 开头 → false", () => {
    expect(isValidUrl("ftp://example.com/proof")).toBe(false);
  });
  // # spec: URL 校验规则 = 无 protocol 必须拒
  it("无 protocol → false", () => {
    expect(isValidUrl("example.com/proof")).toBe(false);
  });
  // # spec: URL 校验规则 = 空串必须拒（不是合法 URL）
  it("空串 → false", () => {
    expect(isValidUrl("")).toBe(false);
  });
});

describe("createPayoutRecord — 业务规则", () => {
  const createdSettlements: string[] = [];

  afterEach(async () => {
    await cleanupSettlements(createdSettlements.splice(0));
  });

  // # spec: 金额必须正整数
  it("amount ≤ 0 → 拒", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 0,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(false);
  });

  // # spec: 金额必须为正整数 — 非整数（如 1.5 元）拒绝（数据库字段是 Integer 分）
  it("amount 非整数 → 拒", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 1.5,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(false);
  });

  // # spec: 状态闸门
  it("status=pending → 拒", async () => {
    const s = await createTestSettlement("pending");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 1000,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/已确认/);
  });

  // # spec: 状态闸门 confirmed — 已确认的结算可以录打款（业务现实：确认后立即打款）
  it("status=confirmed → 允许", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 1000,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(true);
  });

  // # spec: 状态闸门 archived — 已归档的结算可以补录打款（事后补录场景）
  it("status=archived → 允许", async () => {
    const s = await createTestSettlement("archived");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 1000,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(true);
  });

  // # spec: Σ 累计校验 — 累计 = merchantIncome 允许，超额拒绝
  it("Σ 累计 = merchantIncome（恰好等于）→ 允许", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r1 = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 6000,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r1.ok).toBe(true);
    const r2 = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 4000,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.cumulative).toBe(TEST_MERCHANT_INCOME);
      expect(r2.remaining).toBe(0);
    }
  });

  // # spec: Σ 累计校验 — 累计 > 应收 = 超付，必须拒绝（财务正确性）
  it("Σ 累计 > merchantIncome → 拒", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 6000,
      paidAt: new Date(),
      operator: "test",
    });
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 5000, // 累计 11000 > 10000
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/超过应收/);
  });

  // # spec: proofUrl 校验
  it("proofUrl=https:// OK", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 100,
      paidAt: new Date(),
      proofUrl: "https://example.com/p",
      operator: "test",
    });
    expect(r.ok).toBe(true);
  });

  // # spec: proofUrl 校验 — 非 http(s):// 协议必须拒（业务只接受 web URL）
  it("proofUrl=ftp:// 拒", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 100,
      paidAt: new Date(),
      proofUrl: "ftp://example.com/p",
      operator: "test",
    });
    expect(r.ok).toBe(false);
  });

  // # spec: proofUrl optional — 空字符串视为未填，允许通过（不是必填）
  it("proofUrl 空字符串 OK（optional）", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 100,
      paidAt: new Date(),
      proofUrl: "",
      operator: "test",
    });
    expect(r.ok).toBe(true);
  });

  // # spec: paidAt 必填
  it("paidAt 无效 → 拒", async () => {
    const s = await createTestSettlement("confirmed");
    createdSettlements.push(s.id);
    const r = await createPayoutRecord({
      withdrawRequestId: s.id,
      amount: 100,
      paidAt: new Date("invalid"),
      operator: "test",
    });
    expect(r.ok).toBe(false);
  });

  // # spec: settlement 不存在
  it("settlementId 不存在 → 拒", async () => {
    const r = await createPayoutRecord({
      withdrawRequestId: "non-existent-id-xxxx",
      amount: 100,
      paidAt: new Date(),
      operator: "test",
    });
    expect(r.ok).toBe(false);
  });
});
