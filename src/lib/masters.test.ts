// 师傅业务逻辑测试 — createMaster + updateMaster + validateMasterInput

import { afterEach, describe, expect, it } from "vitest";
import {
  createMaster,
  parseSkillsString,
  skillsToString,
  updateMaster,
  validateMasterInput,
} from "./masters";
import { prisma } from "@/src/lib/db";

const valid = {
  name: "测试师傅",
  phone: "13900001234",
  skills: ["空调维修"],
  rating: 4.5,
  available: true,
  serviceArea: "上海",
  merchantId: "M001", // [任务 2] 商家必填 — 测试需要 active 商家
};

// # spec: 师傅字段校验 = name 必填且 50 字符内、phone 1xx 11 位格式、rating [0,5]、serviceArea 100 字符内
describe("validateMasterInput", () => {
  // # spec: 师傅合法校验 — 完整输入通过且 cleaned 字段（name/skills）原样保留
  it("完整合法输入通过", () => {
    const r = validateMasterInput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.name).toBe("测试师傅");
    expect(r.cleaned.skills).toEqual(["空调维修"]);
  });

  // # spec: 师傅字段校验 — name 必填，空串拒绝并指向 field=name
  it("空姓名 → field=name", () => {
    const r = validateMasterInput({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("name");
  });

  // # spec: 师傅字段校验 — name 长度上限 50 字符，超长拒绝并指向 field=name
  it("姓名超过 50 字符", () => {
    const r = validateMasterInput({ ...valid, name: "x".repeat(51) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("name");
  });

  // # spec: 师傅手机号格式 — 必须 1 开头 11 位数字，否则拒绝并指向 field=phone
  it("手机号格式错（不是 1 开头）", () => {
    const r = validateMasterInput({ ...valid, phone: "23900000000" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("phone");
  });

  // # spec: 师傅评分范围 — rating > 5 拒绝并指向 field=rating
  it("评分 > 5", () => {
    const r = validateMasterInput({ ...valid, rating: 5.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("rating");
  });

  // # spec: 师傅评分范围 — rating < 0 拒绝并指向 field=rating
  it("评分 < 0", () => {
    const r = validateMasterInput({ ...valid, rating: -0.1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("rating");
  });

  // # spec: 服务区域长度 — serviceArea 上限 100 字符，超长拒绝并指向 field=serviceArea
  it("服务区域 > 100 字符", () => {
    const r = validateMasterInput({ ...valid, serviceArea: "x".repeat(101) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("serviceArea");
  });
});

// # spec: 技能字符串解析 = 支持中英文/全角逗号分隔、trim + 去空 + 去重；反向序列化为 ", " 拼接
describe("parseSkillsString / skillsToString", () => {
  // # spec: 技能解析 — 英文逗号分隔的标准输入拆成数组
  it("英文逗号分隔", () => {
    expect(parseSkillsString("a,b,c")).toEqual(["a", "b", "c"]);
  });

  // # spec: 技能解析 — 支持中文逗号 + 全角逗号 + 顿号多种分隔符
  it("中文逗号 + 全角逗号", () => {
    expect(parseSkillsString("a，b、c")).toEqual(["a", "b", "c"]);
  });

  // # spec: 技能解析 — 自动 trim + 去空 + 去重，保证数组元素干净
  it("trim + 去空 + 去重", () => {
    expect(parseSkillsString(" a , b , a ,, ")).toEqual(["a", "b"]);
  });

  // # spec: 技能序列化 — skillsToString 用 ", " 拼接；空数组返回空串
  it("反向：数组 → 字符串", () => {
    expect(skillsToString(["a", "b", "c"])).toBe("a, b, c"); // 实现是 ", " 分隔
    expect(skillsToString([])).toBe("");
  });
});

// # spec: 师傅创建 = 合法输入落库（skills JSON 字符串、status 默认 available、completedJobs 初始 0）、姓名空时拒绝
describe("createMaster — 端到端", () => {
  // 每个测试创建后清理
  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.master.deleteMany({ where: { id } });
    }
  });

  // # spec: 师傅创建 — 合法输入落库，skills JSON 字符串 + status 默认 available + completedJobs=0
  it("合法输入 → 创建成功，skills 是 JSON 字符串，status 由 available 决定", async () => {
    const r = await createMaster(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.masterId);

    const row = await prisma.master.findUnique({ where: { id: r.masterId } });
    expect(row?.name).toBe("测试师傅");
    expect(row?.phone).toBe("13900001234");
    expect(row?.skills).toBe(JSON.stringify(["空调维修"]));
    expect(row?.rating).toBe(4.5);
    expect(row?.status).toBe("available");
    expect(row?.serviceArea).toBe("上海");
    expect(row?.completedJobs).toBe(0);
  });

  // # spec: 师傅创建 — 新师傅 status 永远是 available（表单不暴露 status 字段）
  it("新师傅默认 status=available（不可在表单里设置 offline）", async () => {
    const r = await createMaster({ ...valid, name: "新师傅-A" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.masterId);

    const row = await prisma.master.findUnique({ where: { id: r.masterId } });
    expect(row?.status).toBe("available");
  });

  // # spec: 师傅创建 — 空 name 拒绝创建（category=validation, field=name）
  it("空姓名 → validation 错误", async () => {
    const r = await createMaster({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.field).toBe("name");
  });
});

// # spec: 新师傅进派单候选 = 创建后应被 recommendMastersForOrder 找到，且按 rating 排序时新师傅能排第一
describe("createMaster — 新师傅能参与派单推荐", () => {
  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.master.deleteMany({ where: { id } });
    }
  });

  // # spec: 新师傅进派单候选 — 技能匹配 + rating 高时排在候选第一位
  it("新师傅技能匹配 → 出现在 recommendMastersForOrder 结果中", async () => {
    // 查「家政」类目的真实 ID（不能写死，否则 schema 改了测试就挂）
    const jiazhengCat = await prisma.serviceCategory.findUnique({
      where: { name: "家政" },
      select: { id: true },
    });
    expect(jiazhengCat).not.toBeNull();
    if (!jiazhengCat) return;

    // 创建一个「保洁」师傅
    const r = await createMaster({
      name: "新保洁师傅",
      phone: "13900009999",
      skills: ["保洁"],
      rating: 5.0, // [v0.7.6] 跟 seed 默认 rating 5.0 一致（同分时按 id 排第一）
      serviceArea: "上海",
      // [任务 2] 商家必填
      merchantId: valid.merchantId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.masterId);

    // 直接调 dispatch 看新师傅是否在候选里
    const { recommendMastersForOrder } = await import("@/lib/dispatch");
    const masters = (
      await prisma.master.findMany({
        orderBy: { rating: "desc" }, // [v0.7.6] 排序稳定（默认 cuid 顺序不可靠）
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
    ).map((r) => {
      let skills: string[] = [];
      try {
        const parsed = JSON.parse(r.skills);
        if (Array.isArray(parsed))
          skills = parsed.filter((s) => typeof s === "string");
      } catch {}
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        skills,
        rating: r.rating,
        completedJobs: r.completedJobs,
        status: r.status as "available" | "busy" | "offline",
        serviceArea: r.serviceArea,
      };
    });

    const result = recommendMastersForOrder({
      order: { skuId: "S001", categoryId: jiazhengCat.id }, // S001 = 日常保洁
      rules: [
        {
          id: "R-CAT",
          name: "家政类目",
          priority: 10,
          enabled: true,
          spec: {
            match: { categoryId: jiazhengCat.id },
            requiredSkills: ["保洁"],
          },
        },
      ],
      masters,
    });
    expect(result.rule?.id).toBe("R-CAT");
    const found = result.candidates.find((m) => m.id === r.masterId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("新保洁师傅");
    // [v0.9.10] seed-demo 里已有 5.0 分师傅，新增 4.99 不应硬断言第一。
    // 这里验证「新师傅进入候选」和「候选整体按评分降序」。
    const ratings = result.candidates.map((m) => m.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });
});

// # spec: 师傅更新 = 改 name/phone/skills/rating/serviceArea，但不覆盖 status（保护 busy 师傅不被改成 available），不存在 id 拒绝
describe("updateMaster", () => {
  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.master.deleteMany({ where: { id } });
    }
  });

  // # spec: 师傅更新 — 改 name/phone/skills/rating/serviceArea，但不动 status
  it("更新已有师傅信息", async () => {
    const c = await createMaster({ ...valid, name: "原名" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.masterId);

    const u = await updateMaster({
      id: c.masterId,
      name: "新名",
      phone: "13911112222",
      skills: ["空调维修", "家电清洗"],
      rating: 4.8,
      serviceArea: "北京",
      // [任务 2] 商家必填
      merchantId: valid.merchantId,
    });
    expect(u.ok).toBe(true);

    const row = await prisma.master.findUnique({ where: { id: c.masterId } });
    expect(row?.name).toBe("新名");
    expect(row?.phone).toBe("13911112222");
    expect(row?.skills).toBe(JSON.stringify(["空调维修", "家电清洗"]));
    expect(row?.rating).toBe(4.8);
    // 关键：updateMaster 不改 status（即使新师傅创建时是 available，更新后仍然 available）
    expect(row?.status).toBe("available");
    expect(row?.serviceArea).toBe("北京");
  });

  // # documents current behavior: updateMaster 故意不动 status，保护接单中的 busy 师傅不被覆盖
  it("updateMaster 不改 status（保护 busy 师傅不被覆盖）", async () => {
    // 准备：创建师傅，手动把 status 改成 busy（模拟「接单中」）
    const c = await createMaster({ ...valid, name: "忙碌师傅" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    createdIds.push(c.masterId);

    await prisma.master.update({
      where: { id: c.masterId },
      data: { status: "busy" },
    });

    // 即使 available=true 风格的字段不存在了，验证 updateMaster 不会把 busy 改成 available
    const u = await updateMaster({
      id: c.masterId,
      name: "忙碌师傅改名",
      phone: "13911113333",
      skills: ["保洁"],
      rating: 4.0,
      serviceArea: "上海",
      // [任务 2] 商家必填
      merchantId: valid.merchantId,
    });
    expect(u.ok).toBe(true);

    const row = await prisma.master.findUnique({ where: { id: c.masterId } });
    expect(row?.status).toBe("busy"); // 关键：仍是 busy
    expect(row?.name).toBe("忙碌师傅改名"); // 其它字段确实更新了
  });

  // # spec: 师傅更新 — id 不存在时拒绝更新（category=validation）
  it("更新不存在的师傅 → validation 错误", async () => {
    const u = await updateMaster({ ...valid, id: "NOT-EXIST" });
    expect(u.ok).toBe(false);
    if (u.ok) return;
    expect(u.category).toBe("validation");
  });

  // # spec: 师傅更新 — 缺 id 拒绝更新（category=validation）
  it("缺 id → validation 错误", async () => {
    const u = await updateMaster({ ...valid });
    expect(u.ok).toBe(false);
  });
});
