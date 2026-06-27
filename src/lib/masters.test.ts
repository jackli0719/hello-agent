// 师傅业务逻辑测试 — createMaster + updateMaster + validateMasterInput

import { afterEach, describe, expect, it } from "vitest";
import { createMaster, parseSkillsString, skillsToString, updateMaster, validateMasterInput } from "./masters";
import { prisma } from "@/src/lib/db";

const valid = {
  name: "测试师傅",
  phone: "13900001234",
  skills: ["空调维修"],
  rating: 4.5,
  available: true,
  serviceArea: "上海",
};

describe("validateMasterInput", () => {
  it("完整合法输入通过", () => {
    const r = validateMasterInput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cleaned.name).toBe("测试师傅");
    expect(r.cleaned.skills).toEqual(["空调维修"]);
  });

  it("空姓名 → field=name", () => {
    const r = validateMasterInput({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("name");
  });

  it("姓名超过 50 字符", () => {
    const r = validateMasterInput({ ...valid, name: "x".repeat(51) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("name");
  });

  it("手机号格式错（不是 1 开头）", () => {
    const r = validateMasterInput({ ...valid, phone: "23900000000" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("phone");
  });

  it("评分 > 5", () => {
    const r = validateMasterInput({ ...valid, rating: 5.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("rating");
  });

  it("评分 < 0", () => {
    const r = validateMasterInput({ ...valid, rating: -0.1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("rating");
  });

  it("服务区域 > 100 字符", () => {
    const r = validateMasterInput({ ...valid, serviceArea: "x".repeat(101) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("serviceArea");
  });
});

describe("parseSkillsString / skillsToString", () => {
  it("英文逗号分隔", () => {
    expect(parseSkillsString("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("中文逗号 + 全角逗号", () => {
    expect(parseSkillsString("a，b、c")).toEqual(["a", "b", "c"]);
  });

  it("trim + 去空 + 去重", () => {
    expect(parseSkillsString(" a , b , a ,, ")).toEqual(["a", "b"]);
  });

  it("反向：数组 → 字符串", () => {
    expect(skillsToString(["a", "b", "c"])).toBe("a, b, c"); // 实现是 ", " 分隔
    expect(skillsToString([])).toBe("");
  });
});

describe("createMaster — 端到端", () => {
  // 每个测试创建后清理
  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.master.deleteMany({ where: { id } });
    }
  });

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

  it("新师傅默认 status=available（不可在表单里设置 offline）", async () => {
    const r = await createMaster({ ...valid, name: "新师傅-A" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.masterId);

    const row = await prisma.master.findUnique({ where: { id: r.masterId } });
    expect(row?.status).toBe("available");
  });

  it("空姓名 → validation 错误", async () => {
    const r = await createMaster({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.field).toBe("name");
  });
});

describe("createMaster — 新师傅能参与派单推荐", () => {
  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.master.deleteMany({ where: { id } });
    }
  });

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
      rating: 4.99, // 比李师傅 4.9 还高
      serviceArea: "上海",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.masterId);

    // 直接调 dispatch 看新师傅是否在候选里
    const { recommendMastersForOrder } = await import("@/lib/dispatch");
    const masters = (await prisma.master.findMany({
      select: { id: true, name: true, phone: true, skills: true, rating: true, completedJobs: true, status: true, serviceArea: true },
    })).map((r) => {
      let skills: string[] = [];
      try {
        const parsed = JSON.parse(r.skills);
        if (Array.isArray(parsed)) skills = parsed.filter((s) => typeof s === "string");
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
      rules: [{
        id: "R-CAT", name: "家政类目", priority: 10, enabled: true,
        spec: { match: { categoryId: jiazhengCat.id }, requiredSkills: ["保洁"] },
      }],
      masters,
    });
    expect(result.rule?.id).toBe("R-CAT");
    const found = result.candidates.find((m) => m.id === r.masterId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("新保洁师傅");
    // 新师傅 rating 4.99 排第一
    expect(result.candidates[0].id).toBe(r.masterId);
  });
});

describe("updateMaster", () => {
  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.master.deleteMany({ where: { id } });
    }
  });

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
    });
    expect(u.ok).toBe(true);

    const row = await prisma.master.findUnique({ where: { id: c.masterId } });
    expect(row?.status).toBe("busy"); // 关键：仍是 busy
    expect(row?.name).toBe("忙碌师傅改名"); // 其它字段确实更新了
  });

  it("更新不存在的师傅 → validation 错误", async () => {
    const u = await updateMaster({ ...valid, id: "NOT-EXIST" });
    expect(u.ok).toBe(false);
    if (u.ok) return;
    expect(u.category).toBe("validation");
  });

  it("缺 id → validation 错误", async () => {
    const u = await updateMaster({ ...valid });
    expect(u.ok).toBe(false);
  });
});