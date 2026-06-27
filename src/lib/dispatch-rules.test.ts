// 派单规则业务逻辑测试 — createRule / updateRule + 校验 + 端到端。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRule, listRules, toggleRuleEnabled, updateRule, validateRuleInput } from "./dispatch-rules";
import { recommendMastersForOrder } from "@/lib/dispatch";
import { prisma } from "@/src/lib/db";

const valid = {
  name: "测试规则",
  categoryCode: "CLEAN", // 选一个 seed 里有的类目
  skuCode: null,
  requiredSkills: ["保洁"],
  priority: 50,
  enabled: true,
};

describe("validateRuleInput", () => {
  it("合法输入通过（只填 categoryCode）", () => {
    const r = validateRuleInput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.name).toBe("测试规则");
    expect(r.cleaned.categoryCode).toBe("CLEAN");
    expect(r.cleaned.skuCode).toBe(null);
  });

  it("合法输入（只填 skuCode）", () => {
    const r = validateRuleInput({
      ...valid,
      categoryCode: null,
      skuCode: "CLEAN-DAILY-2H",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.skuCode).toBe("CLEAN-DAILY-2H");
  });

  it("SKU + categoryCode 都填：优先 SKU 精确", () => {
    const r = validateRuleInput({
      ...valid,
      categoryCode: "CLEAN",
      skuCode: "CLEAN-DAILY-2H",
    });
    expect(r.ok).toBe(true);
  });

  it("两个都为空 → validation 拒绝", () => {
    const r = validateRuleInput({
      ...valid,
      categoryCode: null,
      skuCode: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/至少填一个/);
  });

  it("空 name → field=name", () => {
    const r = validateRuleInput({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("name");
  });

  it("priority 非数字 → field=priority", () => {
    const r = validateRuleInput({ ...valid, priority: NaN });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("priority");
  });

  it("priority 超限 → field=priority", () => {
    const r = validateRuleInput({ ...valid, priority: 99999 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("priority");
  });

  it("小写 skuCode 会被 normalize 成大写", () => {
    const r = validateRuleInput({
      ...valid,
      categoryCode: null,
      skuCode: "clean-daily-2h",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.skuCode).toBe("CLEAN-DAILY-2H");
  });

  it("含非 ASCII 的 skuCode → 拒", () => {
    const r = validateRuleInput({
      ...valid,
      categoryCode: null,
      skuCode: "中文SKU",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("skuCode");
  });
});

describe("createRule / updateRule — 端到端", () => {
  // 我们用 priority 数字范围 [1000, 9999] 避免和 seed 冲突（seed 用了 10/100）
  const createdIds: string[] = [];
  beforeEach(async () => {
    // 重置 seed 之外的所有规则（priority >= 1000）
    await prisma.dispatchRule.deleteMany({ where: { priority: { gte: 1000 } } });
  });
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.dispatchRule.deleteMany({ where: { id } });
    }
  });

  it("createRule：合法 → DB 写入 ruleJson 含 match + requiredSkills", async () => {
    const r = await createRule({
      ...valid,
      priority: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.id);

    const row = await prisma.dispatchRule.findUnique({ where: { id: r.id } });
    expect(row?.name).toBe("测试规则");
    expect(row?.priority).toBe(1000);
    expect(row?.enabled).toBe(true);
    // ruleJson 解析：match.categoryId 应该是 CLEAN 类目的 cuid
    const parsed = JSON.parse(row!.ruleJson);
    expect(parsed.match.categoryId).toBeTruthy();
    expect(parsed.requiredSkills).toEqual(["保洁"]);
  });

  it("createRule：skuCode 不存在 → validation 错误", async () => {
    const r = await createRule({
      ...valid,
      categoryCode: null,
      skuCode: "NOT-EXISTENT-SKU",
      priority: 1001,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.field).toBe("skuCode");
    expect(r.error).toMatch(/SKU 编码不存在/);
  });

  it("createRule：categoryCode 不存在 → validation 错误", async () => {
    const r = await createRule({
      ...valid,
      categoryCode: "NOT-EXISTENT-CAT",
      priority: 1002,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("categoryCode");
  });

  it("updateRule：合法 → 改 name + priority + enabled", async () => {
    const c = await createRule({ ...valid, priority: 1003 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.id);

    const u = await updateRule({
      id: c.id,
      name: "改名了",
      categoryCode: "CLEAN",
      skuCode: null,
      requiredSkills: ["保洁", "家电清洗"],
      priority: 2000,
      enabled: false,
    });
    expect(u.ok).toBe(true);

    const row = await prisma.dispatchRule.findUnique({ where: { id: c.id } });
    expect(row?.name).toBe("改名了");
    expect(row?.priority).toBe(2000);
    expect(row?.enabled).toBe(false);
    const parsed = JSON.parse(row!.ruleJson);
    expect(parsed.requiredSkills).toEqual(["保洁", "家电清洗"]);
  });

  it("updateRule：规则不存在 → validation", async () => {
    const u = await updateRule({ ...valid, id: "NOT-EXIST", priority: 1004 });
    expect(u.ok).toBe(false);
    if (u.ok) return;
    expect(u.category).toBe("validation");
  });
});

describe("listRules — 端到端", () => {
  it("返回带 skuCode / categoryCode 业务编码的列表", async () => {
    // 用 seed 的 2 条规则验证 — 业务编码 + 名称都返回
    const all = await listRules();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // 至少有一条 SKU 精确规则（S003）
    const skuRule = all.find((r) => r.skuCode === "APPLIANCE-AC-WALL");
    expect(skuRule).toBeDefined();
    // 至少有一条类目兜底规则（CLEAN）
    const catRule = all.find((r) => r.categoryCode === "CLEAN");
    expect(catRule).toBeDefined();
  });
});

describe("修复需求：新增规则生效后影响 recommendMastersForOrder", () => {
  const createdIds: string[] = [];
  beforeEach(async () => {
    await prisma.dispatchRule.deleteMany({ where: { priority: { gte: 1000 } } });
  });
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.dispatchRule.deleteMany({ where: { id } });
    }
  });

  it("新增 SKU 精确规则 → 派单匹配到这条（而不是 seed 的旧规则）", async () => {
    // 新建一条「SUPER」SKU 精确规则：priority=5000 最高，覆盖 seed 的 priority=100
    const c = await createRule({
      name: "SUPER - S003 优先",
      categoryCode: null,
      skuCode: "APPLIANCE-AC-WALL",
      requiredSkills: ["空调维修"],
      priority: 5000,
      enabled: true,
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.id);

    // 模拟：order sku=S003, categoryId=CLEAN
    // 候选：T004 孙师傅（空调维修，available，rating 4.6）
    const result = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: "CLEAN_ID" },
      rules: await prisma.dispatchRule.findMany({
        where: { enabled: true },
        select: { id: true, name: true, priority: true, enabled: true, ruleJson: true },
      }).then((rows) => rows.map((r) => ({
        id: r.id, name: r.name, priority: r.priority, enabled: r.enabled,
        spec: JSON.parse(r.ruleJson),
      }))),
      masters: [
        // 只列 T004（孙师傅，available，会空调维修）
        { id: "T004", name: "孙师傅", phone: "x", skills: ["空调维修", "家电维修"], rating: 4.6, completedJobs: 100, status: "available" as const, serviceArea: "" },
      ],
    });

    // 命中的应该是 priority 最高的那条（5000 的 SUPER）
    expect(result.rule?.id).toBe(c.id);
    expect(result.rule?.name).toBe("SUPER - S003 优先");
  });

  it("disabled 规则不参与匹配", async () => {
    // 新建一条「应被禁用」规则
    const c = await createRule({
      name: "DISABLED",
      categoryCode: "CLEAN",
      skuCode: null,
      requiredSkills: ["保洁"],
      priority: 9999,
      enabled: false, // 关键
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.id);

    // 实际只跑 seed 那条
    const result = recommendMastersForOrder({
      order: { skuId: null, categoryId: "CLEAN_ID" },
      rules: await prisma.dispatchRule.findMany({
        where: { enabled: true }, // 关键：查询时已经过滤 enabled=true
        select: { id: true, name: true, priority: true, enabled: true, ruleJson: true },
      }).then((rows) => rows.map((r) => ({
        id: r.id, name: r.name, priority: r.priority, enabled: r.enabled,
        spec: JSON.parse(r.ruleJson),
      }))),
      masters: [
        { id: "T004", name: "孙师傅", phone: "x", skills: ["保洁"], rating: 4.6, completedJobs: 100, status: "available" as const, serviceArea: "" },
      ],
    });

    // 命中的应该是 seed 的 CLEAN 兜底规则，不是新建的 disabled
    expect(result.rule?.id).not.toBe(c.id);
  });
});

describe("toggleRuleEnabled — 列表行启用/停用按钮", () => {
  // 用 priority >= 2000 避免和 seed + 其它 case 冲突
  const createdIds: string[] = [];
  beforeEach(async () => {
    await prisma.dispatchRule.deleteMany({ where: { priority: { gte: 2000 } } });
  });
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.dispatchRule.deleteMany({ where: { id } });
    }
  });

  it("创建 enabled=true → 第一次 toggle 变 false", async () => {
    const c = await createRule({ ...valid, priority: 2000 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.id);

    const r = await toggleRuleEnabled(c.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.enabled).toBe(false);

    const row = await prisma.dispatchRule.findUnique({ where: { id: c.id } });
    expect(row?.enabled).toBe(false);
  });

  it("来回 toggle 状态正确（true → false → true → false）", async () => {
    const c = await createRule({ ...valid, priority: 2001 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.id);

    // 初始 enabled=true
    const r1 = await toggleRuleEnabled(c.id);
    expect(r1.ok && r1.enabled === false).toBe(true); // 第 1 次：true → false
    const r2 = await toggleRuleEnabled(c.id);
    expect(r2.ok && r2.enabled === true).toBe(true); //  第 2 次：false → true
    const r3 = await toggleRuleEnabled(c.id);
    expect(r3.ok && r3.enabled === false).toBe(true); // 第 3 次：true → false
  });

  it("不存在的 id → validation 错误", async () => {
    const r = await toggleRuleEnabled("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("空 id → validation 错误", async () => {
    const r = await toggleRuleEnabled("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("toggleRuleEnabled 不动 ruleJson / name / priority（只切 enabled）", async () => {
    const c = await createRule({ ...valid, priority: 2002 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.id);

    const before = await prisma.dispatchRule.findUnique({ where: { id: c.id } });
    await toggleRuleEnabled(c.id);
    const after = await prisma.dispatchRule.findUnique({ where: { id: c.id } });
    expect(after?.name).toBe(before?.name);
    expect(after?.priority).toBe(before?.priority);
    expect(after?.ruleJson).toBe(before?.ruleJson);
    expect(after?.enabled).toBe(!before?.enabled); // 只有 enabled 翻
  });
});

describe("#2 修复：坏数据 ruleJson 不会让推荐挂掉", () => {
  // 手动建一个 ruleJson 坏掉的数据，模拟历史脏数据
  const brokenRuleId = "broken-rule-test-id";

  beforeEach(async () => {
    // 删可能存在的上一轮遗留
    await prisma.dispatchRule.deleteMany({ where: { id: brokenRuleId } });
  });

  afterEach(async () => {
    await prisma.dispatchRule.deleteMany({ where: { id: brokenRuleId } });
  });

  it("listRules 不返回坏数据（直接过滤掉）", async () => {
    // 写一条 ruleJson 是非法 JSON 的规则
    await prisma.dispatchRule.create({
      data: {
        id: brokenRuleId,
        name: "坏数据规则",
        priority: 9999,
        enabled: true,
        ruleJson: "这不是 JSON {",
      },
    });

    const all = await listRules();
    const found = all.find((r) => r.id === brokenRuleId);
    expect(found).toBeUndefined(); // 坏数据被过滤
  });

  it("坏数据规则不会污染推荐结果", async () => {
    // 写一条 spec 是空对象（match 都没字段）的规则 — 行为类似坏数据（不会命中）
    // 注意这不是真正的"坏 JSON"，是"有效 JSON 但业务上无效"
    // 真正的"坏 JSON"已在上面 case 测了
    await prisma.dispatchRule.create({
      data: {
        id: brokenRuleId,
        name: "空 spec 规则",
        priority: 9999,
        enabled: true,
        ruleJson: JSON.stringify({ match: {}, requiredSkills: [] }),
      },
    });

    // 跑推荐：categoryId=某 ID 时这条空 spec 不会命中（skuId/categoryId 都空）
    const ruleRows = await prisma.dispatchRule.findMany({ where: { enabled: true } });
    const rules = ruleRows
      .map((r) => ({
        id: r.id, name: r.name, priority: r.priority, enabled: r.enabled,
        spec: parseRuleJsonLocal(r.ruleJson),
      }))
      .filter((r): r is { id: string; name: string; priority: number; enabled: boolean; spec: { match: {}; requiredSkills: [] } } => r.spec !== null);

    // 这里重点：即使是空 spec，调用不会挂
    // 不报错，能正常返回结果（recommendMastersForOrder 会按 enabled=true 但不命中）
    const { recommendMastersForOrder } = await import("@/lib/dispatch");
    expect(() => {
      recommendMastersForOrder({
        order: { skuId: "S003", categoryId: "fake-id" },
        rules,
        masters: [
          { id: "T004", name: "孙师傅", phone: "x", skills: ["空调维修"], rating: 4.6, completedJobs: 100, status: "available" as const, serviceArea: "" },
        ],
      });
    }).not.toThrow();
  });
});

// local import to avoid circular import issues
import { parseRuleJson as parseRuleJsonLocal } from "@/lib/dispatch";