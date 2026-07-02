// 任务 13 商家提现申请 — 端到端验证
//
// 依赖：prisma DB 已 seed（3 商家 / 5 师傅 / 已确认+已归档 MerchantSettlement）
// 跑法：npx tsx scripts/verify-withdraw-request.ts
//
// ⚠️ 临时改 DB：
//   - 新建 1 个独立 merchant（不入 seed 主数据）
//   - 新建 1 个 archived MerchantSettlement (merchantIncome=10000) 作为可提现余额来源
//   - 新建若干 WithdrawRequest
// finally 强制清理（删 merchant → cascade 删 settlement → cascade 删 withdraw）
//
// 9 场景：
//   1. getMerchantAvailable 公式正确
//   2. 正常创建（amount ≤ available）
//   3. amount > available → 拒
//   4. inactive merchant → 拒
//   5. 同一 merchant 已有 pending → 拒
//   6. approve: pending → approved；终态再 approve 拒
//   7. reject: pending → rejected（必填 rejectReason）；终态再 reject 拒
//   8. approved/rejected 不再占 totalPending
//   9. listWithdrawRequests 查询
//
// 设计：每场景在 finally 前自清理 pending，避免状态互相污染

import {
  approveWithdrawRequest,
  createWithdrawRequest,
  getMerchantAvailable,
  listWithdrawRequests,
  rejectWithdrawRequest,
} from "../src/lib/withdraw-request";
import { prisma } from "../src/lib/db";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ============================================================
// Setup — 独立 merchant + archived settlement，merchantIncome=10000
// ============================================================
let testMerchantId = "";
let testSettlementId = "";

async function setup() {
  const now = Date.now().toString().slice(-9);
  const merchant = await prisma.merchant.create({
    data: {
      name: "verify withdraw test",
      contactName: "测试",
      phone: `139000${now}`,
      inviteCode: `W${now}`.slice(0, 8),
      province: "广东",
      city: "深圳",
      district: "南山",
      street: "测试街",
      addressDetail: "1号",
      status: "active",
    },
  });
  testMerchantId = merchant.id;

  const s = await prisma.merchantSettlement.create({
    data: {
      merchantId: merchant.id,
      period: `2099-${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(5, "0")}`,
      totalOrderCount: 1,
      totalAmount: 30000,
      platformFee: 20000,
      merchantIncome: 10000,
      workerIncome: 0,
      status: "archived",
    },
  });
  testSettlementId = s.id;
}

async function cleanup() {
  // 先删 merchant（cascade 删 settlement + withdraw）
  if (testMerchantId) {
    await prisma.merchant.deleteMany({ where: { id: testMerchantId } });
  }
  testMerchantId = "";
  testSettlementId = "";
}

// 辅助：清理该 merchant 的所有 pending（让后续场景重新可申请）
async function clearPending(merchantId: string) {
  await prisma.withdrawRequest.updateMany({
    where: { merchantId, status: "pending" },
    data: {
      status: "rejected",
      reviewerName: "verify-setup",
      rejectReason: "verify 测试 cleanup",
      reviewedAt: new Date(),
    },
  });
}

(async () => {
  await cleanup();
  await setup();

  try {
    // --- 场景 1: getMerchantAvailable 公式
    {
      const a = await getMerchantAvailable(testMerchantId);
      assert(
        "场景 1: getMerchantAvailable — totalIncome=10000, paid=0, pending=0, available=10000",
        a.totalIncome === 10000 &&
          a.totalPaid === 0 &&
          a.totalPending === 0 &&
          a.available === 10000,
        `actual=${JSON.stringify(a)}`,
      );
    }

    // --- 场景 2: 正常创建
    {
      const r = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: 2000,
        remark: "verify 场景 2",
      });
      assert("场景 2: 正常创建（amount=2000 ≤ available=10000）→ 成功", r.ok);
      if (r.ok) {
        const av = await getMerchantAvailable(testMerchantId);
        assert(
          "场景 2: 创建后 available=8000, pending=2000",
          av.available === 8000 && av.totalPending === 2000,
          `actual=${JSON.stringify(av)}`,
        );
      }
    }

    // --- 场景 5（先做）：同一 merchant 已有 pending → 拒
    {
      const r = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: 100,
      });
      assert("场景 5: 同一 merchant 已有 pending → 拒", !r.ok);
      if (!r.ok) {
        assert(
          "场景 5: 错误信息含「未审核的申请」",
          r.error.includes("未审核"),
          `error=${r.error}`,
        );
      }
    }

    // --- 场景 3: amount > available（清掉 pending 后再测）
    await clearPending(testMerchantId);
    {
      const av = await getMerchantAvailable(testMerchantId);
      const r = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: av.available + 100,
      });
      assert(`场景 3: amount>available(${av.available}) → 拒`, !r.ok);
      if (!r.ok) {
        assert(
          "场景 3: 错误信息含「超过可提现余额」",
          r.error.includes("超过"),
          `error=${r.error}`,
        );
      }
    }

    // --- 场景 4: inactive merchant → 拒
    {
      const now = Date.now().toString().slice(-9);
      const inactive = await prisma.merchant.create({
        data: {
          name: "verify 场景 4 inactive",
          contactName: "测试",
          phone: `139000${now}`,
          inviteCode: `X${now}`.slice(0, 8),
          province: "广东",
          city: "深圳",
          district: "南山",
          street: "测试",
          addressDetail: "1号",
          status: "inactive",
        },
      });
      try {
        const r = await createWithdrawRequest({
          merchantId: inactive.id,
          amount: 100,
        });
        assert("场景 4: inactive merchant → 拒", !r.ok);
        if (!r.ok) {
          assert(
            "场景 4: 错误信息含「未激活」",
            r.error.includes("未激活"),
            `error=${r.error}`,
          );
        }
      } finally {
        await prisma.merchant.delete({ where: { id: inactive.id } });
      }
    }

    // --- 场景 6: approve + 状态机
    await clearPending(testMerchantId);
    let approveId = "";
    {
      const c = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: 1500,
        remark: "verify 场景 6",
      });
      assert("场景 6-前置: 创建 pending 成功", c.ok);
      if (!c.ok) throw new Error("场景 6 前置失败");
      approveId = c.id;

      const r = await approveWithdrawRequest({
        id: approveId,
        reviewerName: "admin",
      });
      assert("场景 6: pending → approved → 成功", r.ok);
      if (r.ok) assert("场景 6: 返回 status=approved", r.status === "approved");

      // 二次 approve
      const r2 = await approveWithdrawRequest({
        id: approveId,
        reviewerName: "admin",
      });
      assert("场景 6: 已 approved 再次 approve → 拒", !r2.ok);
      if (!r2.ok) {
        assert(
          "场景 6: 错误信息含「仅 pending」",
          r2.error.includes("仅 pending"),
          `error=${r2.error}`,
        );
      }
    }

    // --- 场景 7: reject + 必填 rejectReason + 终态不可改
    await clearPending(testMerchantId);
    {
      const c = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: 500,
        remark: "verify 场景 7",
      });
      assert("场景 7-前置: 新建 pending 成功", c.ok);
      if (!c.ok) throw new Error("场景 7 前置失败");
      const id = c.id;

      // 不填 rejectReason
      const r1 = await rejectWithdrawRequest({
        id,
        reviewerName: "admin",
      });
      assert(
        "场景 7: reject 时不填 rejectReason → 拒",
        !r1.ok,
        `error=${r1.ok ? "" : r1.error}`,
      );

      // 正常 reject
      const r2 = await rejectWithdrawRequest({
        id,
        reviewerName: "admin",
        rejectReason: "金额异常",
      });
      assert("场景 7: 正常 reject → 成功", r2.ok);
      if (r2.ok)
        assert("场景 7: 返回 status=rejected", r2.status === "rejected");

      // 二次 reject
      const r3 = await rejectWithdrawRequest({
        id,
        reviewerName: "admin",
        rejectReason: "再拒",
      });
      assert("场景 7: 已 rejected 再次 reject → 拒", !r3.ok);
    }

    // --- 场景 8: approved / rejected 后 totalPending 只算 approved（不含 rejected）
    // 注意：场景 6 留了一条 approved (1500) 没清，会进 totalPending
    {
      // 步骤 1: a1=approved (1000)
      const c1 = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: 1000,
      });
      assert("场景 8-1: a1 创建 pending 成功", c1.ok);
      if (!c1.ok) throw new Error("场景 8-1 失败");
      await approveWithdrawRequest({
        id: c1.id,
        reviewerName: "admin",
      });
      // a1 now approved

      // a1 已被处理，再创建 a2 不会被「已有 pending」挡
      const c2 = await createWithdrawRequest({
        merchantId: testMerchantId,
        amount: 2000,
      });
      assert("场景 8-2: a2 创建 pending 成功（a1 已 approved）", c2.ok);
      if (!c2.ok) throw new Error("场景 8-2 失败");
      await rejectWithdrawRequest({
        id: c2.id,
        reviewerName: "admin",
        rejectReason: "verify",
      });
      // a2 now rejected

      // totalPending = 场景 6 留下的 approved 1500 + a1 approved 1000 = 2500
      // a2 rejected 2000 不计
      const av = await getMerchantAvailable(testMerchantId);
      assert(
        "场景 8: approved(1500+1000=2500) 计入 pending, rejected(2000) 不计, available=7500",
        av.totalPending === 2500 && av.available === 7500,
        `actual=${JSON.stringify(av)}`,
      );
    }

    // --- 场景 9: listWithdrawRequests
    {
      const list = await listWithdrawRequests({
        merchantId: testMerchantId,
      });
      assert(
        "场景 9: listWithdrawRequests 查到该 merchant 的 withdraw",
        list.length >= 3 && list.every((w) => w.merchantId === testMerchantId),
        `count=${list.length}`,
      );
    }
  } finally {
    await cleanup();
  }

  console.log(
    `\n=== 任务 13 verify 完成：${passed} passed / ${failed} failed ===`,
  );
  if (failed > 0) process.exit(1);
})();
