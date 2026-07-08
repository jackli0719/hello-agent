// [任务 T2-1 压测验证] 100 并发 createWorkerWithdrawRequest 验证 DB partial unique +
// 事务 Serializable 在生产负载下的不变量：
// - 同 worker 100 个并发 create → 期望 1 成功 / 99 失败
// - 不变量：DB 中只能有 1 条 pending
// - 统计：成功率 / 失败原因分布 / 错误数

// 运行：npx tsx scripts/stress-worker-withdraw.ts

import { PrismaClient } from "@prisma/client";
import {
  createWorkerWithdrawRequest,
  getWorkerAvailable,
} from "@/src/lib/worker-withdraw-request";

const prisma = new PrismaClient();

const TOTAL = 100;
const AMOUNT_CENTS = 5000; // ¥50

async function cleanup(workerId: string) {
  await prisma.workerWithdrawRequest.deleteMany({ where: { workerId } });
}

async function createWorkerIncome(workerId: string, cents: number) {
  // 找唯一 period 避免冲突
  const period = `2097-12-${Math.floor(Math.random() * 100000)}`;
  await prisma.workerSettlement.create({
    data: {
      workerId,
      period,
      orderCount: 1,
      totalAmount: cents * 2,
      workerIncome: cents,
    },
  });
}

async function main() {
  console.log("=== WorkerWithdrawRequest 100 并发压测 ===\n");

  // 找一个 worker
  const worker = await prisma.master.findFirst();
  if (!worker) {
    console.error("seed 没建 master");
    process.exit(1);
  }
  console.log(`目标 worker: ${worker.name} (${worker.id})\n`);

  // 准备：清旧数据 + 给 ¥1000 余额
  await cleanup(worker.id);
  await createWorkerIncome(worker.id, 100000);

  // 算可提现金额
  const before = await getWorkerAvailable(worker.id);
  console.log(`开始前可提现: ¥${(before.available / 100).toFixed(2)}`);
  console.log(
    `开始压测: ${TOTAL} 并发 createWorkerWithdrawRequest ¥${AMOUNT_CENTS / 100}\n`,
  );

  const start = Date.now();

  // 100 并发
  const results = await Promise.allSettled(
    Array.from({ length: TOTAL }).map((_, i) =>
      createWorkerWithdrawRequest({
        workerId: worker.id,
        amount: AMOUNT_CENTS,
        remark: `stress-${i}`,
      }),
    ),
  );

  const elapsed = Date.now() - start;

  // 统计
  let okCount = 0;
  const errorBuckets = new Map<string, number>();
  for (const r of results) {
    if (r.status === "fulfilled") {
      const v = r.value;
      if (v.ok) {
        okCount++;
      } else {
        const key = v.error;
        errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
      }
    } else {
      const msg =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      errorBuckets.set(
        `UNEXPECTED_EXCEPTION: ${msg.slice(0, 80)}`,
        (errorBuckets.get(msg.slice(0, 80)) ?? 0) + 1,
      );
    }
  }

  console.log(`耗时: ${elapsed}ms`);
  console.log(`成功: ${okCount} / ${TOTAL}`);
  console.log(`失败: ${TOTAL - okCount} / ${TOTAL}\n`);

  console.log("失败原因分布:");
  for (const [k, v] of errorBuckets) {
    console.log(`  ${v.toString().padStart(3)} × ${k}`);
  }

  // DB 不变量校验
  const pending = await prisma.workerWithdrawRequest.findMany({
    where: { workerId: worker.id, status: "pending" },
  });
  console.log(`\nDB 中 pending 记录数: ${pending.length}（期望 1）`);

  // 业务不变量：成功 1 条 + DB 中只能 1 条
  const invariants = {
    successCountIs1: okCount === 1,
    dbPendingCountIs1: pending.length === 1,
    noUnexpectedExceptions: ![...errorBuckets.keys()].some((k) =>
      k.startsWith("UNEXPECTED_EXCEPTION"),
    ),
  };

  console.log("\n=== 不变量 ===");
  for (const [k, v] of Object.entries(invariants)) {
    console.log(`  ${v ? "✓" : "✗"} ${k}`);
  }

  // 清理
  await cleanup(worker.id);
  // 删 2097-* WorkerSettlement
  await prisma.workerSettlement.deleteMany({
    where: { workerId: worker.id, period: { startsWith: "2097-" } },
  });

  const allPass = Object.values(invariants).every(Boolean);
  console.log(`\n${allPass ? "✅ 压测通过" : "❌ 压测失败"}`);
  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
