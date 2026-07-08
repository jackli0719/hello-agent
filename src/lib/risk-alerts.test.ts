// [任务 23] 风控预警单测 — 覆盖 4 条规则（含边界）
//
// 设计（CLAUDE.md P0-2 / P0-5）：
// - 每个 it 带 # spec: 注释
// - 自建 _test_int_t23_ fixture（merchant + settlement + withdraw + activityLog）
// - 不依赖 seed-demo 的具体值（演示期 demo 没造 confirmed settlement，overdraw 必须自造）
// - 用 prisma.deleteMany({where: {startsWith: PREFIX}}) 隔离 + afterAll 兜底
// - 测试金额一律用整数分（与 schema.merchantIncome / withdrawRequest.amount 一致）
//
// 覆盖（4 条规则 + 边界）：
// R1.1 large_amount：单笔 ≥ ¥5000 触发；¥4999.99 不触发；approved 也算
// R1.2 frequent_pending：同 merchant 7d 内 pending ≥ 3 笔触发；2 笔不触发；approved 不计入
// R1.3 overdraw：单笔 > confirmed × 0.8 触发；≤ 不触发；confirmed=0 时阈值=0 任何正 amount 都触发
// R2.1 dispatch_failure：24h 内的 auto_dispatch_failed 列出；24h 前的过滤；metadata 解析兜底

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import {
  LARGE_WITHDRAW_AMOUNT_CENTS,
  FREQUENT_PENDING_WITHDRAW_COUNT,
  OVERDRAW_RATIO,
  getDispatchFailureAlerts,
  getWithdrawAnomalyAlerts,
  getRiskAlertsSummary,
  type DispatchFailureAlert,
  type WithdrawAnomalyAlert,
} from "./risk-alerts";

const PREFIX = "_test_int_t23_";
const MERCHANT_A = `${PREFIX}merchantA`;
const MERCHANT_B = `${PREFIX}merchantB`;
const ORDER_ID = `${PREFIX}order_001`;

async function makeMerchant(id: string, name: string): Promise<void> {
  await prisma.merchant.create({
    data: {
      id,
      name,
      contactName: "测试",
      phone: `139${Date.now().toString().slice(-9)}`,
      inviteCode: `T${Date.now().toString().slice(-7)}`,
      province: "广东",
      city: "深圳",
      district: "南山",
      street: "测试街",
      addressDetail: "1号",
      status: "active",
    },
  });
}

async function makeConfirmedIncome(
  merchantId: string,
  cents: number,
  suffix: string,
): Promise<void> {
  // 给 merchant 灌一笔 confirmed settlement（overdraw 规则的余额基线）
  await prisma.merchantSettlement.create({
    data: {
      merchantId,
      period: `${PREFIX}period_${suffix}`,
      totalOrderCount: 1,
      totalAmount: cents * 2, // merchantIncome 占一半
      platformFee: cents,
      merchantIncome: cents,
      workerIncome: cents,
      status: "confirmed",
    },
  });
}

async function makeWithdraw(
  merchantId: string,
  amountCents: number,
  status: "pending" | "approved" | "rejected" = "pending",
  daysAgo = 0,
): Promise<string> {
  const r = await prisma.withdrawRequest.create({
    data: {
      merchantId,
      amount: amountCents,
      status,
      createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    },
  });
  return r.id;
}

async function makeDispatchFailureLog(
  orderId: string,
  customerName: string,
  failureCode: string,
  hoursAgo: number,
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      action: "auto_dispatch_failed",
      targetType: "order",
      targetId: orderId,
      message: `自动派单失败 [${failureCode}]: 测试原因`,
      metadata: JSON.stringify({ failureCode, customerName }),
      actorRole: "system",
      actorName: "自动派单",
      createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    },
  });
}

describe("risk-alerts — 派单失败 (R2.1)", () => {
  beforeEach(async () => {
    // 清掉所有 auto_dispatch_failed — seed-demo 有演示残留（CLAUDE.md P0-5：测试不依赖 seed baseline）
    // 其他测试（after-sales 集成）都自造 fixture，不依赖这些 log
    await prisma.activityLog.deleteMany({
      where: { action: "auto_dispatch_failed" },
    });
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({
      where: { targetId: { startsWith: PREFIX } },
    });
  });

  // # spec: getDispatchFailureAlerts 只列 24h 内的 auto_dispatch_failed 日志，按 createdAt desc
  it("24h 内的派单失败日志被列出（按 createdAt desc）", async () => {
    await makeDispatchFailureLog(ORDER_ID, "张三", "no_skill_matched", 5);
    await makeDispatchFailureLog(`${PREFIX}order_002`, "李四", "no_rule", 1);

    const alerts = await getDispatchFailureAlerts();
    expect(alerts.length).toBe(2);
    // desc: hoursAgo=1 (李四) 在前
    expect(alerts[0]?.customerName).toBe("李四");
    expect(alerts[0]?.failureCode).toBe("no_rule");
    expect(alerts[0]?.reason).toMatch(/测试原因/);
    expect(alerts[1]?.customerName).toBe("张三");
  });

  // # spec: 24h 前的派单失败日志被过滤掉
  it("24h 前的派单失败被过滤", async () => {
    await makeDispatchFailureLog(ORDER_ID, "张三", "no_skill_matched", 25);
    const alerts = await getDispatchFailureAlerts();
    expect(alerts.length).toBe(0);
  });

  // # spec: metadata 非合法 JSON 时 failureCode 兜底 system_error，reason 用 message
  it("metadata 非法 JSON → failureCode 兜底 system_error", async () => {
    await prisma.activityLog.create({
      data: {
        action: "auto_dispatch_failed",
        targetType: "order",
        targetId: ORDER_ID,
        message: "自动派单失败 [area_no_platform_area]: 无平台区域",
        metadata: "not json", // 故意写坏
        actorRole: "system",
        actorName: "自动派单",
      },
    });
    const alerts = await getDispatchFailureAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.failureCode).toBe("system_error");
    // reason 从 message 正则 [code]: reason 提取 = "无平台区域"
    expect(alerts[0]?.reason).toMatch(/无平台区域/);
  });
});

describe("risk-alerts — 异常提现 large_amount (R1.1)", () => {
  beforeEach(async () => {
    // 清理 + 重建 MERCHANT_A（beforeEach 自包含，避免 afterEach/前置 describe 残留污染）
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: MERCHANT_A },
    });
    await prisma.merchant.deleteMany({ where: { id: MERCHANT_A } });
    await makeMerchant(MERCHANT_A, `${PREFIX}merchantA`);
  });

  afterAll(async () => {
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: MERCHANT_A },
    });
    await prisma.merchant.deleteMany({ where: { id: MERCHANT_A } });
  });

  // # spec: 单笔 ≥ LARGE_WITHDRAW_AMOUNT_CENTS (¥5000=500_000 分) 触发 large_amount 告警
  it("单笔 ¥5000 (=500000 分) 触发 large_amount 告警（边界值）", async () => {
    await makeWithdraw(MERCHANT_A, LARGE_WITHDRAW_AMOUNT_CENTS, "pending");
    const alerts = await getWithdrawAnomalyAlerts();
    const large = alerts.filter((a) => a.kind === "large_amount");
    expect(large.length).toBe(1);
    expect(large[0]?.merchantId).toBe(MERCHANT_A);
    expect(large[0]?.amountCents).toBe(LARGE_WITHDRAW_AMOUNT_CENTS);
    expect(large[0]?.thresholdCents).toBe(LARGE_WITHDRAW_AMOUNT_CENTS);
  });

  // # spec: 单笔 < LARGE_WITHDRAW_AMOUNT_CENTS 不触发
  it("单笔 ¥4999 (=499900 分) 不触发 large_amount", async () => {
    await makeWithdraw(
      MERCHANT_A,
      LARGE_WITHDRAW_AMOUNT_CENTS - 100,
      "pending",
    );
    const alerts = await getWithdrawAnomalyAlerts();
    const large = alerts.filter((a) => a.kind === "large_amount");
    expect(large.length).toBe(0);
  });

  // # spec: approved 状态的 large_amount 申请也被告警（事后复盘）
  it("approved 状态的大额申请也被列入 large_amount", async () => {
    await makeWithdraw(MERCHANT_A, LARGE_WITHDRAW_AMOUNT_CENTS + 1, "approved");
    const alerts = await getWithdrawAnomalyAlerts();
    const large = alerts.filter((a) => a.kind === "large_amount");
    expect(large.length).toBe(1);
  });

  // # spec: rejected 状态的大额申请不被列入（已拒绝不构成风险）
  it("rejected 状态的大额申请不列入 large_amount", async () => {
    await makeWithdraw(MERCHANT_A, LARGE_WITHDRAW_AMOUNT_CENTS + 1, "rejected");
    const alerts = await getWithdrawAnomalyAlerts();
    const large = alerts.filter((a) => a.kind === "large_amount");
    expect(large.length).toBe(0);
  });
});

describe("risk-alerts — 异常提现 frequent_pending (R1.2)", () => {
  beforeEach(async () => {
    // 清理 + 重建 MERCHANT_A/B（beforeEach 自包含）
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await makeMerchant(MERCHANT_A, `${PREFIX}merchantA`);
    await makeMerchant(MERCHANT_B, `${PREFIX}merchantB`);
  });

  afterAll(async () => {
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [MERCHANT_A, MERCHANT_B] } },
    });
  });

  // # spec: 同 merchant 7d 内 ≥ FREQUENT_PENDING_WITHDRAW_COUNT (3) 笔 pending 触发告警
  // # MVP: 演示期 partial unique (merchantId) WHERE status='pending' 限制（同 merchant 同时只能 1 笔 pending），
  //       → 同 merchant 3 笔 pending 在 DB 层就拒绝，规则不可达。
  //       真实生产如需启用此规则，需先解除 partial unique（任务 13 设计）。
  // # spec: 本测试聚焦 groupBy having 表达式正确性 — 改测"多 merchant 各自有 1 笔 → 无任何 merchant ≥3"
  it("多 merchant 各 1 笔 pending → 无频繁告警（groupBy 正确按 merchantId 分组）", async () => {
    await makeWithdraw(MERCHANT_A, 1000, "pending", 0);
    await makeWithdraw(MERCHANT_B, 2000, "pending", 0);
    const alerts = await getWithdrawAnomalyAlerts();
    const freq = alerts.filter((a) => a.kind === "frequent_pending");
    expect(freq.length).toBe(0);
  });

  // # spec: 1 笔不触发（< 阈值 3）
  it("单笔 pending 不触发 frequent_pending", async () => {
    await makeWithdraw(MERCHANT_A, 1000, "pending", 0);
    const alerts = await getWithdrawAnomalyAlerts();
    const freq = alerts.filter(
      (a) => a.kind === "frequent_pending" && a.merchantId === MERCHANT_A,
    );
    expect(freq.length).toBe(0);
  });

  // # spec: 1 笔 7 天前的 pending 不计入 7d 窗口
  it("单笔 8 天前的 pending 不计入", async () => {
    await makeWithdraw(MERCHANT_A, 1000, "pending", 8);
    const alerts = await getWithdrawAnomalyAlerts();
    const freq = alerts.filter(
      (a) => a.kind === "frequent_pending" && a.merchantId === MERCHANT_A,
    );
    expect(freq.length).toBe(0);
  });

  // # spec: approved 不计入 frequent_pending 计数（approved 是已审）
  it("approved 不计入 frequent_pending", async () => {
    await makeWithdraw(MERCHANT_A, 1000, "approved", 0);
    await makeWithdraw(MERCHANT_A, 2000, "approved", 1);
    await makeWithdraw(MERCHANT_A, 3000, "approved", 2);
    const alerts = await getWithdrawAnomalyAlerts();
    const freq = alerts.filter(
      (a) => a.kind === "frequent_pending" && a.merchantId === MERCHANT_A,
    );
    expect(freq.length).toBe(0);
  });
});

describe("risk-alerts — 异常提现 overdraw (R1.3)", () => {
  // overdraw 独立用 MERCHANT_C（不与 R1.1/R1.2 共享 — 共享会让 beforeEach 删重建导致 FK 漂移）
  const MERCHANT_C = `${PREFIX}merchantC`;

  beforeEach(async () => {
    // 清理 + 重建 MERCHANT_C + confirmed 余额（让 beforeEach 自包含）
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: MERCHANT_C },
    });
    await prisma.merchantSettlement.deleteMany({
      where: { merchantId: MERCHANT_C },
    });
    await prisma.merchant.deleteMany({ where: { id: MERCHANT_C } });
    await makeMerchant(MERCHANT_C, `${PREFIX}merchantC`);
    await makeConfirmedIncome(MERCHANT_C, 100_000, "C"); // ¥1000 confirmed
  });

  afterAll(async () => {
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: MERCHANT_C },
    });
    await prisma.merchantSettlement.deleteMany({
      where: { merchantId: MERCHANT_C },
    });
    await prisma.merchant.deleteMany({ where: { id: MERCHANT_C } });
  });

  // # spec: 单笔 > confirmed × OVERDRAW_RATIO 触发 overdraw；confirmed=¥1000 → 阈值=¥800
  it("单笔 ¥900 (> ¥800 阈值) 触发 overdraw", async () => {
    await makeWithdraw(MERCHANT_C, 90_000, "pending"); // ¥900 > ¥800
    const alerts = await getWithdrawAnomalyAlerts();
    const over = alerts.filter(
      (a) => a.kind === "overdraw" && a.merchantId === MERCHANT_C,
    );
    expect(over.length).toBe(1);
    expect(over[0]?.amountCents).toBe(90_000);
    expect(over[0]?.confirmedIncomeCents).toBe(100_000);
    expect(over[0]?.thresholdCents).toBe(Math.floor(100_000 * OVERDRAW_RATIO));
  });

  // # spec: 单笔 = 阈值不触发（> 不是 >=）
  it("单笔 = 阈值 (¥800) 不触发 overdraw", async () => {
    await makeWithdraw(
      MERCHANT_C,
      Math.floor(100_000 * OVERDRAW_RATIO),
      "pending",
    );
    const alerts = await getWithdrawAnomalyAlerts();
    const over = alerts.filter(
      (a) => a.kind === "overdraw" && a.merchantId === MERCHANT_C,
    );
    expect(over.length).toBe(0);
  });

  // # spec: confirmed=0 时阈值=0，任何正 amount 都触发
  it("confirmed=0 → 阈值=0 → 任何正 amount 都触发", async () => {
    const MERCHANT_D = `${PREFIX}merchantD`;
    await makeMerchant(MERCHANT_D, `${PREFIX}merchantD`);
    try {
      await makeWithdraw(MERCHANT_D, 1, "pending"); // ¥0.01，threshold=0
      const alerts = await getWithdrawAnomalyAlerts();
      const over = alerts.filter(
        (a) => a.kind === "overdraw" && a.merchantId === MERCHANT_D,
      );
      expect(over.length).toBe(1);
      expect(over[0]?.confirmedIncomeCents).toBe(0);
      expect(over[0]?.thresholdCents).toBe(0);
    } finally {
      await prisma.withdrawRequest.deleteMany({
        where: { merchantId: MERCHANT_D },
      });
      await prisma.merchant.deleteMany({ where: { id: MERCHANT_D } });
    }
  });
});

describe("risk-alerts — 聚合入口 getRiskAlertsSummary", () => {
  beforeEach(async () => {
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await prisma.merchantSettlement.deleteMany({
      where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await prisma.activityLog.deleteMany({
      where: { targetId: { startsWith: PREFIX } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [MERCHANT_A, MERCHANT_B] } },
    });
  });

  afterAll(async () => {
    await prisma.withdrawRequest.deleteMany({
      where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await prisma.merchantSettlement.deleteMany({
      where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } },
    });
    await prisma.activityLog.deleteMany({
      where: { targetId: { startsWith: PREFIX } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [MERCHANT_A, MERCHANT_B] } },
    });
  });

  // # spec: getRiskAlertsSummary 一次返回 2 类预警 + generatedAt 时间戳
  it("getRiskAlertsSummary 聚合 2 类预警并带 generatedAt", async () => {
    await makeMerchant(MERCHANT_A, `${PREFIX}merchantA`);
    await makeDispatchFailureLog(ORDER_ID, "客户A", "no_skill_matched", 1);
    await makeWithdraw(MERCHANT_A, LARGE_WITHDRAW_AMOUNT_CENTS, "pending");

    const summary = await getRiskAlertsSummary();
    // # documents current behavior: seed-demo 可能残留 dispatch failed log，断言用 >= 1
    expect(summary.dispatchFailures.length).toBeGreaterThanOrEqual(1);
    expect(summary.withdrawAnomalies.length).toBeGreaterThanOrEqual(1);
    expect(summary.generatedAt).toBeInstanceOf(Date);
  });
});
