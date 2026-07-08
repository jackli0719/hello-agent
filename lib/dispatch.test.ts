import { describe, expect, it } from "vitest";
import {
  recommendMastersForOrder,
  parseRuleJson,
  type DispatchRuleRow,
  type MerchantAreaRow,
  type PlatformAreaRow,
} from "./dispatch";
import type { Technician } from "./types";

// 测试 fixtures
// [v0.10.0] merchantId 业务必填（任务 2: Master.merchantId）— makeMaster 不默认填，
// 保持旧 it() 调用点最少改动；新 it() 显式传 merchantId: "MERCHANT-1" 等
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

function makePlatformArea(
  overrides: Partial<PlatformAreaRow> = {},
): PlatformAreaRow {
  return {
    id: "PA001",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    enabled: true,
    ...overrides,
  };
}

function makeMerchantArea(
  overrides: Partial<MerchantAreaRow> = {},
): MerchantAreaRow {
  return {
    merchantId: "MERCHANT-1",
    platformAreaId: "PA001",
    enabled: true,
    ...overrides,
  };
}

describe("parseRuleJson", () => {
  // # spec: parseRuleJson 把 JSON 字符串转成 {match, requiredSkills}，不合法或非 JSON 返回 null
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

  // # spec: 缺 match/requiredSkills 时用默认值（match={}，requiredSkills=[]）
  it("空字段用默认值", () => {
    const spec = parseRuleJson("{}");
    expect(spec).not.toBeNull();
    if (!spec) return;
    expect(spec.match).toEqual({});
    expect(spec.requiredSkills).toEqual([]);
  });

  // # spec: requiredSkills 非字符串元素必须被过滤掉，只保留字符串
  it("requiredSkills 里塞非字符串会被过滤", () => {
    const spec = parseRuleJson(
      JSON.stringify({ match: {}, requiredSkills: ["保洁", 42, null, "家电"] }),
    );
    expect(spec).not.toBeNull();
    if (!spec) return;
    expect(spec.requiredSkills).toEqual(["保洁", "家电"]);
  });

  // # documents current behavior: 之前 throw，现在返 null（让上游过滤）
  it("非 JSON 字符串 → 返回 null", () => {
    // 关键：之前是 throw，现在返回 null 让上游过滤
    const spec = parseRuleJson("这不是 JSON");
    expect(spec).toBeNull();
  });

  // # documents current behavior: match 非对象也返 null（不抛），上游过滤
  it("不匹配 schema → 返回 null", () => {
    // match 应该是对象，但传了字符串
    const spec = parseRuleJson(
      JSON.stringify({ match: "not-an-object", requiredSkills: [] }),
    );
    expect(spec).toBeNull();
  });
});

// [v0.10.0] 本 describe 旧 it() 不传 merchantId — 业务上 [任务 2] 后
// recommendMastersForOrder 已按 master.merchantId + merchant.status + merchantArea.enabled
// 过滤；旧 it() 不传 merchantId 时 prisma IN (undefined) 等价"不参与过滤"，
// 测试通过但不真正覆盖商家过滤。详见 docs/TEST-CHANGELOG.md v0.10.0 段。
// 新 it()（v0.10.0 起）显式传 merchantId + merchantArea 覆盖新逻辑。
describe("recommendMastersForOrder", () => {
  // # spec: 派单按规则匹配师傅，无规则命中时返人工指派（rule=null, candidates=[]）
  it("没有规则覆盖 → rule=null, candidates=[]", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: "cat-1" },
      rules: [
        makeRule({
          spec: { match: { categoryId: "other" }, requiredSkills: [] },
        }),
      ],
      masters: [makeMaster({ skills: ["空调维修"] })],
    });
    expect(r.rule).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/人工指派/);
  });

  // # spec: SKU 规则命中时，候选人按 rating 降序、reason 含规则名
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
        makeMaster({
          id: "M1",
          name: "孙师傅",
          skills: ["空调维修", "家电维修"],
          rating: 4.6,
          status: "available",
        }),
        makeMaster({
          id: "M2",
          name: "王师傅",
          skills: ["空调维修"],
          rating: 4.9,
          status: "available",
        }),
      ],
    });
    expect(r.rule?.id).toBe("R-SKU");
    expect(r.candidates.length).toBe(2);
    // rating 降序：王师傅 4.9 排第一
    expect(r.candidates[0].id).toBe("M2");
    expect(r.candidates[1].id).toBe("M1");
    expect(r.reason).toMatch(/R-SKU/);
  });

  // # spec: 同类规则多条时，按 priority 降序选第一（SKU 精确 > 类目兜底）
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

  // # spec: 无 SKU 规则命中时退到 categoryId 规则（类目兜底）
  it("没 SKU 规则时走类目兜底", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S001", categoryId: "cat-jiazheng" },
      rules: [
        makeRule({
          id: "R-CAT",
          name: "家政类目",
          priority: 10,
          spec: {
            match: { categoryId: "cat-jiazheng" },
            requiredSkills: ["保洁"],
          },
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

  // # spec: 师傅技能集合是 requiredSkills 的超集（every 都包含）才算候选
  it("师傅技能必须**覆盖** requiredSkills（多技能要求）", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S-x", categoryId: "cat-x" },
      rules: [
        makeRule({
          spec: {
            match: { skuId: "S-x" },
            requiredSkills: ["保洁", "家电清洗"],
          },
        }),
      ],
      masters: [
        // 只会有一个师傅覆盖两个技能
        makeMaster({
          id: "M-LI",
          name: "李师傅",
          skills: ["保洁", "家电清洗"],
          status: "available",
        }),
        makeMaster({
          id: "M-WANG",
          name: "王师傅",
          skills: ["保洁"],
          status: "available",
        }),
      ],
    });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].id).toBe("M-LI");
  });

  // # spec: 候选只取 status=available 的师傅，busy/offline 不进池
  it("师傅 status 必须 available", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: null },
      rules: [
        makeRule({
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
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

  // # spec: 候选为空时 reason 必须含规则名和 requiredSkills，方便排查
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

  // # spec: 派单匹配只看 enabled=true 的规则，disabled 不进候选池
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

  // # spec: 同优先级多条规则，priority 降序排第一，相同时按 id 字典序
  it("同类型多条规则按 priority 降序，再按 id 字典序", () => {
    const r = recommendMastersForOrder({
      order: { skuId: "S003", categoryId: null },
      rules: [
        makeRule({
          id: "R-A",
          priority: 50,
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
        makeRule({
          id: "R-B",
          priority: 100,
          spec: { match: { skuId: "S003" }, requiredSkills: ["空调维修"] },
        }),
      ],
      masters: [makeMaster({ skills: ["空调维修"] })],
    });
    expect(r.rule?.id).toBe("R-B");
  });

  // # spec: 区域过滤前置 — 订单地址必须命中 enabled PlatformArea 四级字段，否则不进入 SKU/技能匹配
  it("订单地址不在平台合作区域 → 不推荐师傅", () => {
    const r = recommendMastersForOrder({
      order: {
        skuId: "S003",
        categoryId: null,
        address: "上海市浦东新区世纪大道 100 号",
      },
      rules: [
        makeRule({
          spec: { match: { skuId: "S003" }, requiredSkills: ["保洁"] },
        }),
      ],
      masters: [
        makeMaster({ id: "M1", skills: ["保洁"], merchantId: "MERCHANT-1" }),
      ],
      platformAreas: [makePlatformArea()],
      merchantAreas: [makeMerchantArea()],
    });
    expect(r.rule).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/当前区域暂未开放平台合作服务/);
  });

  // # spec: 区域过滤前置 — 平台区域命中后，必须有 enabled MerchantArea 覆盖该区域
  it("平台区域命中但没有启用商家覆盖 → 不推荐师傅", () => {
    const r = recommendMastersForOrder({
      order: {
        skuId: "S003",
        categoryId: null,
        address: "广东省深圳市南山区粤海街道科技园 1 号",
      },
      rules: [
        makeRule({
          spec: { match: { skuId: "S003" }, requiredSkills: ["保洁"] },
        }),
      ],
      masters: [
        makeMaster({ id: "M1", skills: ["保洁"], merchantId: "MERCHANT-1" }),
      ],
      platformAreas: [makePlatformArea()],
      merchantAreas: [makeMerchantArea({ enabled: false })],
    });
    expect(r.rule).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/暂无启用商家覆盖/);
  });

  // # spec: 派单推荐顺序 = 订单区域 → 覆盖商家 → 商家下师傅 → SKU/技能/评分
  it("只推荐覆盖该区域商家下的师傅，再按技能和评分筛选", () => {
    const r = recommendMastersForOrder({
      order: {
        skuId: "S003",
        categoryId: null,
        address: "广东省深圳市南山区粤海街道科技园 1 号",
      },
      rules: [
        makeRule({
          spec: { match: { skuId: "S003" }, requiredSkills: ["保洁"] },
        }),
      ],
      masters: [
        makeMaster({
          id: "M1",
          skills: ["保洁"],
          rating: 4.5,
          merchantId: "MERCHANT-1",
        }),
        makeMaster({
          id: "M2",
          skills: ["保洁"],
          rating: 5.0,
          merchantId: "MERCHANT-2",
        }),
        makeMaster({
          id: "M3",
          skills: ["空调维修"],
          rating: 4.9,
          merchantId: "MERCHANT-1",
        }),
      ],
      platformAreas: [makePlatformArea()],
      merchantAreas: [makeMerchantArea({ merchantId: "MERCHANT-1" })],
    });
    expect(r.rule?.id).toBe("R1");
    expect(r.candidates.map((m) => m.id)).toEqual(["M1"]);
  });

  // # spec: v0.10.0 商家过滤 — 商家 status=inactive 时该商家师傅被排除
  it("[v0.10.0] 商家 status=inactive → 旗下师傅不出现在推荐", () => {
    // 必须传 address 才能让 pickPlatformAreaForAddress 命中（PA001 粤海街道）
    const r = recommendMastersForOrder({
      order: {
        skuId: "S003",
        categoryId: "cat-1",
        address: "广东省深圳市南山区粤海街道科技园",
      },
      rules: [
        makeRule({
          spec: {
            match: { categoryId: "cat-1" },
            requiredSkills: ["空调维修"],
          },
        }),
      ],
      masters: [
        makeMaster({
          id: "ACTIVE-M",
          skills: ["空调维修"],
          merchantId: "MERCHANT-A",
        }),
        makeMaster({
          id: "INACTIVE-M",
          skills: ["空调维修"],
          merchantId: "MERCHANT-B",
        }),
      ],
      platformAreas: [makePlatformArea()],
      // 只有 MERCHANT-A 绑定区域（实际：merchant.status 已是 inactive 的，MerchantArea 不会被加载）
      merchantAreas: [makeMerchantArea({ merchantId: "MERCHANT-A" })],
    });
    // 仅 ACTIVE-M 出现
    expect(r.candidates.map((m) => m.id)).toEqual(["ACTIVE-M"]);
  });

  // # spec: v0.10.0 区域过滤 — 商家所有 MerchantArea.enabled=false → 旗下师傅被排除
  it("[v0.10.0] 商家所有 MerchantArea.enabled=false → 师傅不出现在推荐", () => {
    const r = recommendMastersForOrder({
      order: {
        skuId: "S003",
        categoryId: "cat-1",
        address: "广东省深圳市南山区粤海街道科技园",
      },
      rules: [
        makeRule({
          spec: {
            match: { categoryId: "cat-1" },
            requiredSkills: ["空调维修"],
          },
        }),
      ],
      masters: [
        makeMaster({
          id: "M1",
          skills: ["空调维修"],
          merchantId: "MERCHANT-1",
        }),
      ],
      platformAreas: [makePlatformArea()],
      // 商家绑了区域但 enabled=false
      merchantAreas: [makeMerchantArea({ enabled: false })],
    });
    expect(r.candidates).toEqual([]);
  });
});
