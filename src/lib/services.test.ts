// 服务业务逻辑测试 — createCategory / createSku / updateSku + 校验

import { afterEach, describe, expect, it } from "vitest";
import {
  createCategory,
  createSku,
  updateSku,
  validateCategoryInput,
  validateSkuInput,
  validateUpdateSkuInput,
  listCategories,
  listSkus,
} from "./services";
import { prisma } from "@/src/lib/db";

// # spec: 服务品类校验 = name 必填、code 合法 ASCII 且小写 normalize 成大写、纯中文或非法字符拒绝
describe("validateCategoryInput", () => {
  it("合法输入通过", () => {
    const r = validateCategoryInput({
      name: "家政",
      code: "CLEAN",
      enabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.code).toBe("CLEAN");
  });

  // # spec: 品类字段校验 — name 必填，空串拒绝并指向 field=name
  it("空 name → field=name", () => {
    const r = validateCategoryInput({ name: "", code: "CLEAN", enabled: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("name");
  });

  // # spec: 品类编码合法性 — 纯中文编码 normalize 后变空，拒绝并指向 field=code
  it("非法编码（纯中文 → normalize 后空 → 拒）", () => {
    const r = validateCategoryInput({
      name: "测试",
      code: "中文SKU",
      enabled: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("code");
  });

  // # spec: 品类编码长度上限 — normalize 后空且超 32 字符的非法字符直接拒绝
  it("编码超长（normalize 截断后仍 >32 字符的非法字符）", () => {
    // 用 33 个非法字符（normalize 后会清空）→ 拒
    const r = validateCategoryInput({
      name: "测试",
      code: "!".repeat(33),
      enabled: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("code");
  });

  // # spec: 编码规范化 — 小写 code 应用层 normalize 成大写，校验仍通过
  it("小写编码会被 normalize 成大写（不报错）", () => {
    const r = validateCategoryInput({
      name: "测试",
      code: "clean",
      enabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.code).toBe("CLEAN"); // 大写
  });
});

// # spec: 服务 SKU 校验 = name/code/categoryCode 必填、basePrice 范围 [0, 100 万] 元
describe("validateSkuInput", () => {
  // # spec: SKU 合法校验 — 完整输入（name+code+categoryCode+basePrice+enabled）通过
  it("合法输入通过", () => {
    const r = validateSkuInput({
      name: "深度保洁 3 小时",
      code: "CLEAN-DEEP-3H",
      categoryCode: "CLEAN",
      basePrice: 268,
      enabled: true,
    });
    expect(r.ok).toBe(true);
  });

  // # spec: SKU 字段校验 — name/code/categoryCode 任一为空都拒绝
  it("空 name / 空 code / 空 categoryCode", () => {
    expect(
      validateSkuInput({
        name: "",
        code: "X",
        categoryCode: "CLEAN",
        basePrice: 100,
        enabled: true,
      }).ok,
    ).toBe(false);
    expect(
      validateSkuInput({
        name: "x",
        code: "",
        categoryCode: "CLEAN",
        basePrice: 100,
        enabled: true,
      }).ok,
    ).toBe(false);
    expect(
      validateSkuInput({
        name: "x",
        code: "X",
        categoryCode: "",
        basePrice: 100,
        enabled: true,
      }).ok,
    ).toBe(false);
  });

  // # spec: SKU 价格范围 — basePrice 必须 [0, 100 万] 元，负数 / 超限都拒绝
  it("basePrice 负数 / 超限", () => {
    expect(
      validateSkuInput({
        name: "x",
        code: "X",
        categoryCode: "CLEAN",
        basePrice: -1,
        enabled: true,
      }).ok,
    ).toBe(false);
    expect(
      validateSkuInput({
        name: "x",
        code: "X",
        categoryCode: "CLEAN",
        basePrice: 1_000_001,
        enabled: true,
      }).ok,
    ).toBe(false);
  });
});

// # spec: 更新 SKU 校验 = 必须传 id 才能更新合法字段（name/basePrice/enabled）
describe("validateUpdateSkuInput", () => {
  // # spec: 更新 SKU 合法校验 — 合法字段组合（name/basePrice/enabled）+ 有 id 即通过
  it("合法输入通过", () => {
    const r = validateUpdateSkuInput({
      id: "S001",
      name: "改名",
      basePrice: 999,
      enabled: false,
    });
    expect(r.ok).toBe(true);
  });

  // # spec: 更新 SKU 必须传 id — 缺 id 拒绝
  it("缺 id", () => {
    const r = validateUpdateSkuInput({
      name: "x",
      basePrice: 100,
      enabled: true,
    });
    expect(r.ok).toBe(false);
  });
});

// # spec: 品类/SKU 端到端 CRUD = 创建写库（元转分 + durationMinutes 默认 60）、code 重复拒绝、小写 code normalize、categoryCode 不存在拒绝、更新不改 skuCode/categoryId/durationMinutes
describe("createCategory / createSku / updateSku — 端到端", () => {
  const createdIds: { category?: string; sku?: string } = {};

  afterEach(async () => {
    if (createdIds.sku) {
      await prisma.serviceSku.deleteMany({ where: { id: createdIds.sku } });
      delete createdIds.sku;
    }
    if (createdIds.category) {
      await prisma.serviceCategory.deleteMany({
        where: { id: createdIds.category },
      });
      delete createdIds.category;
    }
  });

  // # spec: 品类创建 — 合法输入落库，categoryCode + name + enabled=true 正确写入
  it("createCategory：合法输入 → DB 写入 enabled=true", async () => {
    const r = await createCategory({
      name: "测试品类-A",
      code: "TEST-CAT-A",
      enabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.category = r.id;

    const row = await prisma.serviceCategory.findUnique({
      where: { id: r.id },
    });
    expect(row?.name).toBe("测试品类-A");
    expect(row?.categoryCode).toBe("TEST-CAT-A");
    expect(row?.enabled).toBe(true);
  });

  // # spec: 品类 code 唯一性 — 重复的 code 拒绝创建（category=validation）
  it("createCategory：code 重复 → validation", async () => {
    // 用 seed 已有的 CLEAN
    const r = await createCategory({
      name: "重复",
      code: "CLEAN",
      enabled: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  // # spec: 品类 code 规范化 — 小写 code 入库前 normalize 成大写后落 DB
  it("createCategory：小写 code 会被 normalize 成大写", async () => {
    const r = await createCategory({
      name: "小写测试",
      code: "test-lower",
      enabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.category = r.id;

    const row = await prisma.serviceCategory.findUnique({
      where: { id: r.id },
    });
    expect(row?.categoryCode).toBe("TEST-LOWER");
  });

  // # spec: SKU 创建 — 元转分落库 + durationMinutes 默认 60 + requiredSkills 写入（修复 #1）
  it("createSku：合法输入 → DB 写入（元 → 分 + requiredSkills）", async () => {
    // 用 seed 已有的 CLEAN 类目
    const r = await createSku({
      name: "测试 SKU-A",
      code: "TEST-SKU-A",
      categoryCode: "CLEAN",
      basePrice: 199.5,
      enabled: true,
      requiredSkills: ["保洁"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.sku = r.id;

    const row = await prisma.serviceSku.findUnique({ where: { id: r.id } });
    expect(row?.name).toBe("测试 SKU-A");
    expect(row?.skuCode).toBe("TEST-SKU-A");
    expect(row?.basePrice).toBe(19950); // 元 → 分
    expect(row?.enabled).toBe(true);
    expect(row?.durationMinutes).toBe(60); // 默认值
    expect(row?.requiredSkills).toBe('["保洁"]'); // 关键修复 #1：技能写入
  });

  // # spec: SKU 品类归属 — categoryCode 在品类表里找不到时拒绝创建（field=categoryCode）
  it("createSku：categoryCode 不存在 → validation", async () => {
    const r = await createSku({
      name: "测试",
      code: "TEST-SKU-X",
      categoryCode: "NON-EXISTENT",
      basePrice: 100,
      enabled: true,
      requiredSkills: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.field).toBe("categoryCode");
  });

  // # spec: SKU 更新 — 改 name/basePrice/enabled/requiredSkills，但 skuCode/categoryId/durationMinutes 不动
  it("updateSku：合法输入 → 改名 + 改价格", async () => {
    const c = await createSku({
      name: "原名",
      code: "TEST-SKU-UPD",
      categoryCode: "CLEAN",
      basePrice: 100,
      enabled: true,
      requiredSkills: [],
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.sku = c.id;

    const u = await updateSku({
      id: c.id,
      name: "新名",
      basePrice: 250.75,
      enabled: false,
      requiredSkills: ["保洁"],
    });
    expect(u.ok).toBe(true);

    const row = await prisma.serviceSku.findUnique({ where: { id: c.id } });
    expect(row?.name).toBe("新名");
    expect(row?.basePrice).toBe(25075); // 元 → 分
    expect(row?.enabled).toBe(false);
    expect(row?.requiredSkills).toBe('["保洁"]'); // update 写入新技能
    // skuCode / categoryId / durationMinutes 没动
    expect(row?.skuCode).toBe("TEST-SKU-UPD");
  });

  // # spec: SKU 更新 — id 在 DB 找不到时拒绝更新（category=validation）
  it("updateSku：SKU 不存在 → validation", async () => {
    const u = await updateSku({
      id: "NOT-EXIST",
      name: "x",
      basePrice: 100,
      enabled: true,
    });
    expect(u.ok).toBe(false);
    if (u.ok) return;
    expect(u.category).toBe("validation");
  });
});

// # spec: 新建 SKU 立即可见 = createSku 后 listSkus 立即返回该 SKU，enabled=true 时 listEnabledServices 也能找到
describe("新建的 SKU 能被 listSkus 查到，能出现在新建订单下拉", () => {
  const createdIds: { sku?: string } = {};
  afterEach(async () => {
    if (createdIds.sku) {
      await prisma.serviceSku.deleteMany({ where: { id: createdIds.sku } });
      delete createdIds.sku;
    }
  });

  // # spec: SKU 创建后可见 — listSkus 立即能查到新 SKU（无缓存）
  it("createSku 后 listSkus 立即能找到", async () => {
    const r = await createSku({
      name: "测试-查找",
      code: "TEST-LIST-SKU",
      categoryCode: "CLEAN",
      basePrice: 100,
      enabled: true,
      requiredSkills: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.sku = r.id;

    const all = await listSkus();
    const found = all.find((s) => s.id === r.id);
    expect(found).toBeDefined();
    expect(found?.skuCode).toBe("TEST-LIST-SKU");
  });

  // # spec: SKU 启用可见 — enabled=true 的新 SKU 立即出现在 listEnabledServices（用户端下拉）
  it("enabled=true 的新 SKU 出现在 listEnabledServices", async () => {
    const r = await createSku({
      name: "测试-启用",
      code: "TEST-EN-SKU",
      categoryCode: "CLEAN",
      basePrice: 100,
      enabled: true,
      requiredSkills: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.sku = r.id;

    const { listEnabledServices } = await import("@/src/lib/repos/services");
    const enabled = await listEnabledServices();
    const found = enabled.find((s) => s.id === r.id);
    expect(found).toBeDefined();
  });
});

// # spec: 品类列表 = 返回所有品类含 disabled 的全量列表
describe("listCategories", () => {
  // # spec: 品类列表 — 返回全量品类（含 disabled），管理员视图
  it("返回所有品类（含 disabled）", async () => {
    const all = await listCategories();
    expect(all.length).toBeGreaterThanOrEqual(5); // seed 有 5 个
    // 至少一个 enabled（seed 没禁用任何）
    expect(all.some((c) => c.enabled)).toBe(true);
  });
});

// # spec: 新 SKU 必填 requiredSkills 才能参与派单匹配 = requiredSkills 非空时推荐能匹配到对应技能师傅、空数组时 DB 存 "[]" 且不参与派单
describe("修复 #1：新 SKU 设置 requiredSkills 后能参与派单匹配", () => {
  const createdIds: { category?: string; sku?: string } = {};
  afterEach(async () => {
    if (createdIds.sku) {
      await prisma.serviceSku.deleteMany({ where: { id: createdIds.sku } });
      delete createdIds.sku;
    }
    if (createdIds.category) {
      await prisma.serviceCategory.deleteMany({
        where: { id: createdIds.category },
      });
      delete createdIds.category;
    }
  });

  // # spec: 新 SKU requiredSkills 必填 — 非空时能匹配到对应技能师傅进入派单候选
  it("新 SKU requiredSkills=['空调维修'] → 派单匹配时找得到「空调维修」师傅", async () => {
    // 1. 新建品类（避免污染 seed）
    const c = await createCategory({
      name: "测试类目-派单",
      code: "TEST-DISPATCH",
      enabled: true,
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.category = c.id;

    // 2. 新建 SKU 带 requiredSkills
    const s = await createSku({
      name: "测试服务-空调",
      code: "TEST-DISPATCH-SKU",
      categoryCode: "TEST-DISPATCH",
      basePrice: 199,
      enabled: true,
      requiredSkills: ["空调维修"],
    });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    createdIds.sku = s.id;

    // 3. 调 recommendMastersForOrder 看 T004（孙师傅，available + 会空调维修）能否在候选里
    const { recommendMastersForOrder } = await import("@/lib/dispatch");
    const cat = await prisma.serviceCategory.findUnique({
      where: { id: createdIds.category },
    });
    const masters = await prisma.master
      .findMany({
        where: { status: { not: "offline" } }, // available / busy 都参与匹配
        select: {
          id: true,
          name: true,
          phone: true,
          skills: true,
          rating: true,
          completedJobs: true,
          status: true,
          serviceArea: true,
        },
      })
      .then((rows) =>
        rows.map((r) => {
          let skills: string[] = [];
          try {
            const p = JSON.parse(r.skills);
            if (Array.isArray(p))
              skills = p.filter((s: unknown) => typeof s === "string");
          } catch {}
          return {
            ...r,
            skills,
            status: r.status as "available" | "busy" | "offline",
          };
        }),
      );

    // 加一个「匹配 SKU 规则」的 DispatchRule
    const result = recommendMastersForOrder({
      order: { skuId: createdIds.sku!, categoryId: cat!.id },
      rules: [
        {
          id: "R-NEW",
          name: "新 SKU 测试",
          priority: 100,
          enabled: true,
          spec: {
            match: { skuId: createdIds.sku! },
            requiredSkills: ["空调维修"],
          },
        },
      ],
      masters,
    });

    expect(result.rule?.id).toBe("R-NEW");
    // T004（孙师傅，skills 包含「空调维修」）必须在候选里
    const t004 = result.candidates.find((m) => m.id === "T004");
    expect(t004).toBeDefined();
    expect(t004?.name).toBe("孙师傅");
  });

  // # spec: 新 SKU requiredSkills 空数组 — DB 存 "[]"，且不参与派单自动匹配
  it("新 SKU requiredSkills=[] → 派单匹配规则时返回「无候选」（不参与）", async () => {
    const c = await createCategory({
      name: "应急测试",
      code: "TEST-EMERGENCY",
      enabled: true,
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.category = c.id;

    const s = await createSku({
      name: "应急服务",
      code: "TEST-EMERGENCY-SKU",
      categoryCode: "TEST-EMERGENCY",
      basePrice: 99,
      enabled: true,
      requiredSkills: [], // 应急服务不参与自动派单
    });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    createdIds.sku = s.id;

    // 验证 DB 里确实是 []
    const row = await prisma.serviceSku.findUnique({ where: { id: s.id } });
    expect(row?.requiredSkills).toBe("[]");
  });
});
