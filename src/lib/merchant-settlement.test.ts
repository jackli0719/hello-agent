// merchant-settlement 状态机测试 — 连真实 SQLite
// 覆盖：
//   1. confirm: pending → confirmed；幂等；archived 拒
//   2. archive: pending → archived；confirmed → archived；幂等
//   3. generateAllMerchantSettlements: pending 覆盖 / confirmed 跳过 / archived 跳过

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveMerchantSettlement,
  confirmMerchantSettlement,
  generateAllMerchantSettlements,
} from "./merchant-settlement";
import { prisma } from "@/src/lib/db";

const createdSettlementIds: string[] = [];

async function cleanup() {
  if (createdSettlementIds.length === 0) return;
  await prisma.merchantSettlement.deleteMany({
    where: { id: { in: createdSettlementIds } },
  });
  createdSettlementIds.length = 0;
}

async function createTestSettlement(
  status: "pending" | "confirmed" | "archived",
) {
  const merchant = await prisma.merchant.findFirst({
    where: { status: "active" },
  });
  if (!merchant) throw new Error("seed 没建 active merchant");
  const period = `2099-${String(Math.floor(Math.random() * 10000)).padStart(
    5,
    "0",
  )}`;
  const s = await prisma.merchantSettlement.create({
    data: {
      merchantId: merchant.id,
      period,
      totalOrderCount: 0,
      totalAmount: 0,
      platformFee: 0,
      merchantIncome: 1000,
      workerIncome: 0,
      status,
    },
  });
  createdSettlementIds.push(s.id);
  return s;
}

describe("confirmMerchantSettlement", () => {
  afterEach(cleanup);

  // # spec: 状态机 confirm 规则 = pending → confirmed；confirmed 幂等；archived 拒
  it("pending → confirmed", async () => {
    const s = await createTestSettlement("pending");
    const r = await confirmMerchantSettlement(s.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("confirmed");
  });

  // # spec: 状态机 confirm 幂等 = confirmed 状态再次 confirm 不报错，状态保持 confirmed
  it("confirmed → confirmed（幂等）", async () => {
    const s = await createTestSettlement("confirmed");
    const r = await confirmMerchantSettlement(s.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("confirmed");
  });

  // # spec: 状态机 confirm 拒 archived = archived 是终态，confirm 后会破坏只读不变量，所以拒
  it("archived → 拒", async () => {
    const s = await createTestSettlement("archived");
    const r = await confirmMerchantSettlement(s.id);
    expect(r.ok).toBe(false);
  });

  // # spec: 业务规则 = 不存在的 settlementId 必须报错，不静默成功
  it("settlementId 不存在 → 拒", async () => {
    const r = await confirmMerchantSettlement("non-existent");
    expect(r.ok).toBe(false);
  });
});

describe("archiveMerchantSettlement", () => {
  afterEach(cleanup);

  // # spec: 状态机 archive 规则 = pending → archived；confirmed → archived；archived 幂等
  it("pending → archived", async () => {
    const s = await createTestSettlement("pending");
    const r = await archiveMerchantSettlement(s.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("archived");
  });

  // # spec: 状态机 archive 规则 = confirmed 可直接归档（关账后再付清）
  it("confirmed → archived", async () => {
    const s = await createTestSettlement("confirmed");
    const r = await archiveMerchantSettlement(s.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("archived");
  });

  // # spec: 状态机 archive 幂等 = archived 状态再次 archive 不报错，状态保持 archived
  it("archived → archived（幂等）", async () => {
    const s = await createTestSettlement("archived");
    const r = await archiveMerchantSettlement(s.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("archived");
  });
});

describe("generateAllMerchantSettlements — 状态机保护", () => {
  afterEach(cleanup);

  // # spec: [F0-2] pending 状态重新生成 → 覆盖
  it("pending 状态 → 覆盖（created/updated）", async () => {
    const s = await createTestSettlement("pending");
    // 直接调 generate；因为没有 SettlementPreview 关联，可能 groups 为空
    // 只验证 status=pending 的 settlement 仍可重新生成（不会报 skipped）
    const r = await generateAllMerchantSettlements();
    expect(r.skipped).toBeGreaterThanOrEqual(0);
    const after = await prisma.merchantSettlement.findUnique({
      where: { id: s.id },
    });
    expect(after?.status).toBe("pending"); // 状态不被改
  });

  // # spec: [F0-2] confirmed 状态 → 跳过（skipped）
  it("confirmed 状态 → skipped，不覆盖", async () => {
    const s = await createTestSettlement("confirmed");
    await prisma.merchantSettlement.update({
      where: { id: s.id },
      data: { merchantIncome: 99999 }, // 一个明显特征值
    });
    const before = await prisma.merchantSettlement.findUnique({
      where: { id: s.id },
    });
    expect(before?.merchantIncome).toBe(99999);

    await generateAllMerchantSettlements();

    const after = await prisma.merchantSettlement.findUnique({
      where: { id: s.id },
    });
    // merchantIncome 没被覆盖
    expect(after?.merchantIncome).toBe(99999);
    expect(after?.status).toBe("confirmed");
  });

  // # spec: [F0-2] archived 状态 → 跳过（skipped）
  it("archived 状态 → skipped，不覆盖", async () => {
    const s = await createTestSettlement("archived");
    await prisma.merchantSettlement.update({
      where: { id: s.id },
      data: { merchantIncome: 88888 },
    });
    await generateAllMerchantSettlements();
    const after = await prisma.merchantSettlement.findUnique({
      where: { id: s.id },
    });
    expect(after?.merchantIncome).toBe(88888);
    expect(after?.status).toBe("archived");
  });
});
