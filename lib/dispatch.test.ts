import { describe, expect, it } from "vitest";
import {
  recommendMastersForOrder,
  parseRuleJson,
  type DispatchRuleRow,
} from "./dispatch";
import type { Technician } from "./types";

// 测试 fixtures
function makeMaster(overrides: Partial<Technician>): Technician {
  return {
    id: "M",
    name: "默认师傅",
    phone: "138****0000",
    skills: [],
    rating: 4.5,
    completedJobs: 100,
    status: "available",
    serviceArea: "",
    ...overrides,
  };
}

function makeRule(overrides: Partial<DispatchRuleRow>): DispatchRuleRow {
  return {
    id: "R1",
    name: "默认规则",
    priority: 0,
    enabled: true,
    spec: { match: {}, requiredSkills: [] },
    ...overrides,
  };
}

describe("parseRuleJson", () => {
  it("解析完整 ruleJson", () => {
    const spec = parseRuleJson(
      JSON.stringify({
        match: { skuId: "S003", categoryId: "cat-1" },
        requiredSkills: ["空调维修"],
      }),
    );
    expect(spec).not.toBeNull();
    if (!spec) return;
    expect(spec.match.skuId).toBe("S003");
    expect(spec.match.categoryId).toBe("cat-1");
    expect(spec.requiredSkills).toEqual(["空调维修"]);
  });

  it("空字段用默认值", () => {
    const spec = parseRuleJson("{}");
    expect(spec).not.toBeNull();
    if (!spec) return;
    expect(spec.match).toEqual({});
    expect(spec.requiredSkills).toEqual([]);
  });

  it("requiredSkills 里塞非字符串会被过滤", () => {
    const spec = parseRuleJson(
      JSON.stringify({ match: {}, requiredSkills: ["保洁", 42, null, "家电"] }),
    );
    expect(spec).not.toBeNull();
    if (!spec) return;
    expect(spec.requiredSkills).toEqual(["保洁", "家电"]);
  });

  it("非 JSON 字符串 → 返回 null", () => {
    // 关键：之前是 throw，现在返回 null 让上游过滤
    const spec = parseRuleJson("这不是 JSON");
    expect(spec).toBeNull();
  });

  it("不匹配 schema → 返回 null", () => {
    // match 应该是对象，但传了字符串
    const spec = parseRuleJson(JSON.stringify({ match: "not-an-object", requiredSkills: [] }));
    expect(spec).toBeNull();
  });
});

describe("recommendMastersForOrder", () => {
  it("没有规则覆盖 → rule=null, candidates=[]", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: "cat-1" },
      rules: [makeRule({ spec: { match: { categoryId: "other" }, requiredSkills: [] } })],
      masters: [makeMaster({ skills: ["空调维修"] })],
    });
    expect(r.rule).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/人工指派/);
  });

  it("SKU 精确规则命中：requiredSkills=['空调维修']，师傅技能覆盖", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: "cat-1" },
      rules: [
        makeRule({
          id: "R-SKU",
          name: "SKU 精确",
          priority: 100,
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
      ],
      masters: [
        makeMaster({ id: "M1", name: "孙师傅", skills: ["空调维修", "家电维修"], rating: 4.6, status: "available" }),
        makeMaster({ id: "M2", name: "王师傅", skills: ["空调维修"], rating: 4.9, status: "available" }),
      ],
    });
    expect(r.rule?.id).toBe("R-SKU");
    expect(r.candidates.length).toBe(2);
    // rating 降序：王师傅 4.9 排第一
    expect(r.candidates[0].id).toBe("M2");
    expect(r.candidates[1].id).toBe("M1");
    expect(r.reason).toMatch(/R-SKU/);
  });

  it("SKU 精确优先于类目兜底", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: "cat-1" },
      rules: [
        makeRule({
          id: "R-CAT",
          name: "类目兜底",
          priority: 10,
          spec: { match: { categoryId: "cat-1" }, requiredSkills: ["保洁"] },
        }),
        makeRule({
          id: "R-SKU",
          name: "SKU 精确",
          priority: 100,
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
      ],
      masters: [makeMaster({ skills: ["空调维修"] })],
    });
    expect(r.rule?.id).toBe("R-SKU");
  });

  it("没 SKU 规则时走类目兜底", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S001", categoryId: "cat-jiazheng" },
      rules: [
        makeRule({
          id: "R-CAT",
          name: "家政类目",
          priority: 10,
          spec: { match: { categoryId: "cat-jiazheng" }, requiredSkills: ["保洁"] },
        }),
      ],
      masters: [
        makeMaster({ id: "M1", skills: ["保洁"], status: "available" }),
        makeMaster({ id: "M2", skills: ["空调维修"], status: "available" }),
      ],
    });
    expect(r.rule?.id).toBe("R-CAT");
    // 只 M1 满足 requiredSkills
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].id).toBe("M1");
  });

  it("师傅技能必须**覆盖** requiredSkills（多技能要求）", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S-x", categoryId: "cat-x" },
      rules: [
        makeRule({
          spec: { match: { skuId: "S-x" }, requiredSkills: ["保洁", "家电清洗"] },
        }),
      ],
      masters: [
        // 只会有一个师傅覆盖两个技能
        makeMaster({ id: "M-LI", name: "李师傅", skills: ["保洁", "家电清洗"], status: "available" }),
        makeMaster({ id: "M-WANG", name: "王师傅", skills: ["保洁"], status: "available" }),
      ],
    });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].id).toBe("M-LI");
  });

  it("师傅 status 必须 available", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: null },
      rules: [
        makeRule({ spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] } }),
      ],
      masters: [
        makeMaster({ id: "BUSY", skills: ["空调维修"], status: "busy" }),
        makeMaster({ id: "OFF", skills: ["空调维修"], status: "offline" }),
        makeMaster({ id: "FREE", skills: ["空调维修"], status: "available" }),
      ],
    });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].id).toBe("FREE");
  });

  it("没候选时 reason 包含规则名 + 技能要求", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: null },
      rules: [
        makeRule({
          name: "S003 空调维修",
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
      ],
      masters: [makeMaster({ skills: ["保洁"], status: "available" })],
    });
    expect(r.rule?.name).toBe("S003 空调维修");
    expect(r.candidates.length).toBe(0);
    expect(r.reason).toMatch(/S003 空调维修/);
    expect(r.reason).toMatch(/空调维修/);
  });

  it("disabled 规则被忽略", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: null },
      rules: [
        makeRule({
          enabled: false,
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
      ],
      masters: [makeMaster({ skills: ["空调维修"] })],
    });
    expect(r.rule).toBeNull();
  });

  it("同类型多条规则按 priority 降序，再按 id 字典序", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: null },
      rules: [
        makeRule({ id: "R-A", priority: 50, spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] } }),
        makeRule({ id: "R-B", priority: 100, spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] } }),
      ],
      masters: [makeMaster({ skills: ["空调维修"] })],
    });
    expect(r.rule?.id).toBe("R-B");
  });
});