// 验收 16 步链路端到端测试 — 完整跑通
import { createCategory, createSku } from "../src/lib/services";
import { createMaster } from "../src/lib/masters";
import { createRule } from "../src/lib/dispatch-rules";
import { createOrder, assignOrder, transitionOrder } from "../src/lib/orders";
import { recommendMastersForOrder } from "../lib/dispatch";
import { prisma } from "../src/lib/db";

(async () => {
  const ids: Record<string, string | null> = {};
  try {
    // 1. 新建类目
    const cat1 = await createCategory({ name: "验收家电", code: "VERIFY-APPL", enabled: true });
    ids.cat1 = cat1.ok ? cat1.id : null;
    console.log("1. 新建类目:", cat1.ok);

    // 2. 新建 SKU
    const sku1 = await createSku({
      name: "验收空调", code: "VERIFY-AC", categoryCode: "VERIFY-APPL",
      basePrice: 199, enabled: true, requiredSkills: ["空调维修"],
    });
    ids.sku1 = sku1.ok ? sku1.id : null;
    console.log("2. 新建 SKU:", sku1.ok);

    // 3. 新建师傅
    const m1 = await createMaster({
      name: "验收师傅1", phone: "13900000001", skills: ["空调维修", "保洁"],
      rating: 4.9, serviceArea: "上海",
    });
    ids.m1 = m1.ok ? m1.masterId : null;
    const m2 = await createMaster({
      name: "验收师傅2", phone: "13900000002", skills: ["保洁"],
      rating: 4.5, serviceArea: "上海",
    });
    ids.m2 = m2.ok ? m2.masterId : null;
    console.log("3. 新建师傅 1+2:", m1.ok, m2.ok);

    // 4. SKU 精确 + 品类兜底 2 条规则
    const r1 = await createRule({
      name: "SKU 精确 - VERIFY-AC", categoryCode: null, skuCode: "VERIFY-AC",
      requiredSkills: ["空调维修"], priority: 100, enabled: true,
    });
    ids.r1 = r1.ok ? r1.id : null;
    const r2 = await createRule({
      name: "类目兜底 - VERIFY-APPL", categoryCode: "VERIFY-APPL", skuCode: null,
      requiredSkills: ["保洁"], priority: 10, enabled: true,
    });
    ids.r2 = r2.ok ? r2.id : null;
    console.log("4. 新增 2 条规则:", r1.ok, r2.ok);

    // 5. 创建订单
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const o1 = await createOrder({
      customerName: "验收客户", customerPhone: "13900000099", address: "上海市",
      skuCode: "VERIFY-AC", categoryCode: "VERIFY-APPL", amount: 199, scheduledAt: tomorrow,
    });
    ids.o1 = o1.ok ? o1.orderId : null;
    console.log("5. 创建订单:", o1.ok, o1.ok ? o1.orderId : "");

    // 6. SKU 精确规则优先检查（用 RecommendArgs 直接调）
    const catObj = await prisma.serviceCategory.findUnique({ where: { id: ids.cat1! } });
    const skuObj = await prisma.serviceSku.findUnique({ where: { id: ids.sku1! } });
    const ruleRows = await prisma.dispatchRule.findMany({ where: { enabled: true } });
    const { parseRuleJson } = await import("../lib/dispatch");
    const rules = ruleRows.map((r) => ({
      id: r.id, name: r.name, priority: r.priority, enabled: r.enabled,
      spec: parseRuleJson(r.ruleJson) ?? { match: {}, requiredSkills: [] },
    }));
    const masters = [
      { id: ids.m1!, name: "验收师傅1", phone: "x", skills: ["空调维修", "保洁"], rating: 4.9, completedJobs: 100, status: "available" as const, serviceArea: "上海" },
      { id: ids.m2!, name: "验收师傅2", phone: "x", skills: ["保洁"], rating: 4.5, completedJobs: 100, status: "available" as const, serviceArea: "上海" },
    ];
    const r6 = recommendMastersForOrder({
      order: { skuId: skuObj!.id, categoryId: catObj!.id },
      rules, masters,
    });
    console.log("6. SKU 精确规则优先:", r6.rule?.name, "（应是 VERIFY-AC）");
    console.log("   候选:", r6.candidates.map((c) => c.id).join(","));

    // 7. 品类兜底检查 — 用新订单（没 SKU 匹配，但类目匹配）
    const r7 = recommendMastersForOrder({
      order: { skuId: "NON-EXISTENT-SKU", categoryId: catObj!.id },
      rules, masters,
    });
    console.log("7. 品类兜底命中:", r7.rule?.name, "（应是 类目兜底 - VERIFY-APPL）");
    console.log("   候选:", r7.candidates.map((c) => c.id).join(","), "（应只有 m1 因为 m2 不会空调维修）");

    // 8. 无规则 → 兜底推荐
    const noRules = rules.filter((r) => r.spec.match.skuId !== skuObj!.id && r.spec.match.categoryId !== catObj!.id);
    const r8 = recommendMastersForOrder({
      order: { skuId: "FAKE-SKU", categoryId: "FAKE-CAT" },
      rules: noRules, masters,
    });
    console.log("8. 无规则 → rule=null, candidates=[]:", r8.rule === null, r8.candidates.length === 0);

    // 9. 派单 - 修：传 m1.masterId 不是 m1
    if (ids.o1 && ids.m1) {
      const a = await assignOrder(ids.o1, ids.m1);
      console.log("9. 派单:", a.ok, a.ok ? "→ " + a.masterName : "");
    }

    // 10. 状态 assigned
    const after = await prisma.order.findUnique({ where: { id: ids.o1! } });
    console.log("10. 状态变 assigned:", after?.status);

    // 11. 开始服务
    if (ids.o1) {
      const s = await transitionOrder(ids.o1, "in_service");
      console.log("11. in_service:", s.ok);
    }

    // 12+13. 完成
    if (ids.o1) {
      const d = await transitionOrder(ids.o1, "completed");
      console.log("13. completed:", d.ok);
    }

    // 14. 终态
    const final = await prisma.order.findUnique({ where: { id: ids.o1! } });
    console.log("14. 最终状态:", final?.status);

    // 15. 已完成不能再派单
    if (ids.o1 && ids.m2) {
      const tryAgain = await assignOrder(ids.o1, ids.m2);
      console.log("15. 已完成订单再派单应失败:", !tryAgain.ok, "原因:", tryAgain.ok === false ? tryAgain.error : "n/a");
    }

    // 16. 已取消不能再流转
    if (ids.o1) {
      await prisma.order.update({ where: { id: ids.o1 }, data: { status: "cancelled" } });
      const trans = await transitionOrder(ids.o1, "completed");
      console.log("16. 已取消订单再 completed 应失败:", !trans.ok);
    }
  } finally {
    // 清理
    for (const key of ["o1", "m1", "m2", "r1", "r2", "sku1", "cat1"]) {
      const id = ids[key];
      if (!id) continue;
      if (key.startsWith("o")) await prisma.order.deleteMany({ where: { id } });
      else if (key.startsWith("m")) await prisma.master.deleteMany({ where: { id } });
      else if (key.startsWith("r")) await prisma.dispatchRule.deleteMany({ where: { id } });
      else if (key.startsWith("sku")) await prisma.serviceSku.deleteMany({ where: { id } });
      else if (key.startsWith("cat")) await prisma.serviceCategory.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  }
})();
