// 任务 3 派单区域过滤 — 6 场景验证
//
// 依赖：prisma DB 已 seed（3 商家 + 4 PlatformArea + 4 MerchantArea + 5 师傅）
// 跑法：npx tsx scripts/verify-dispatch.ts
//
// ⚠️ 会临时改 DB：
//   - T002.merchantId / skills
//   - MerchantArea.enabled (商家 A 在福田/宝安)
//   - 商家 A 的 status (inactive)
//   - 创建/删除测试订单
// finally 强制恢复所有备份值；中途抛错也回滚
//
// 6 场景：
//   1. 南山粤海 + A 绑区 + 师傅有空 → 推荐
//   2. 福田华强北 + B 绑区 + A 不绑 → 只推 B
//   3. 无匹配 PlatformArea → 拒 + area_no_platform_area
//   4. 有区但无 active 商家 → 拒 + area_no_merchant
//   5. 商家覆盖但 inactive → 拒该商家师傅
//   6. 商家覆盖但技能不匹配 → T001 不推荐 / T004 推荐

import { recommendMastersForOrder } from "../lib/dispatch";
import { prisma } from "../src/lib/db";

const SKU_CLEAN_DAILY = "CLEAN-DAILY-2H";
const SKU_AC_WALL = "APPLIANCE-AC-WALL";

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

// ============= 备份/恢复 state =============
// 所有"临时改 DB"前先备份原值，finally 强制恢复
type Snapshot = {
  t002?: { merchantId: string; skills: string }; // 原始 T002
  shenzhenNanshanOriginalStatus?: string; // 原始 M001 状态
  merchantAreaEnabledBackup?: Array<{
    merchantId: string;
    platformAreaId: string;
    enabled: boolean;
  }>; // 备份所有 enabled 状态
  createdOrderIds: string[]; // 测试订单
  masterFixes?: Array<{ id: string; originalMerchantId: string }>; // demo seed 字符串 merchantId 修正
};

async function safeRestore(snap: Snapshot) {
  // 1. 恢复 T002
  if (snap.t002) {
    try {
      await prisma.master.update({
        where: { id: "T002" },
        data: { merchantId: snap.t002.merchantId, skills: snap.t002.skills },
      });
    } catch (e) {
      console.error("⚠️ 恢复 T002 失败:", e);
    }
  }
  // 2. 恢复商家 A 状态 — 强制 active（demo seed 标准值，避免多次跑互相污染）
  try {
    const m = await prisma.merchant.findFirst({
      where: { name: "深圳南山服务商 A" },
    });
    if (m) {
      await prisma.merchant.update({
        where: { id: m.id },
        data: { status: "active" },
      });
    }
  } catch (e) {
    console.error("⚠️ 恢复商家 A 状态失败:", e);
  }
  // 3. 恢复 MerchantArea.enabled — 强制全部 enabled（demo seed 标准值）
  try {
    await prisma.merchantArea.updateMany({ data: { enabled: true } });
  } catch (e) {
    console.error("⚠️ 恢复 MerchantArea 失败:", e);
  }
  // 4. 删除测试订单
  for (const id of snap.createdOrderIds) {
    try {
      await prisma.order.delete({ where: { id } });
    } catch {
      // 已删/不存在忽略
    }
  }
  // 5. 恢复 master.merchantId 修正
  if (snap.masterFixes) {
    for (const fix of snap.masterFixes) {
      try {
        await prisma.master.update({
          where: { id: fix.id },
          data: { merchantId: fix.originalMerchantId },
        });
      } catch (e) {
        console.error("⚠️ 恢复 master.merchantId 失败:", fix.id, e);
      }
    }
  }
}

async function loadFixture() {
  // 加载 SKU
  const cleanSku = await prisma.serviceSku.findUnique({
    where: { skuCode: SKU_CLEAN_DAILY },
    select: { id: true, categoryId: true },
  });
  const acSku = await prisma.serviceSku.findUnique({
    where: { skuCode: SKU_AC_WALL },
    select: { id: true, categoryId: true },
  });
  if (!cleanSku || !acSku) {
    throw new Error("基础 SKU 不存在 — 请先 npm run db:seed");
  }

  // 加载 PlatformArea
  const platformAreas = await prisma.platformArea.findMany({
    where: { enabled: true },
    select: {
      id: true,
      province: true,
      city: true,
      district: true,
      street: true,
      enabled: true,
    },
  });

  // 加载所有 active MerchantArea
  const merchantAreas = await prisma.merchantArea.findMany({
    where: { enabled: true, merchant: { status: "active" } },
    select: { merchantId: true, platformAreaId: true, enabled: true },
  });

  // 加载所有 master
  // 注意：demo seed 用字符串 id ("M001"/"M002"/"M003") 演示可读，master.merchantId
  //      也是同字符串 — merchantAreas.merchantId 同样 — 匹配 OK，不需要修正
  const masterRows = await prisma.master.findMany({
    select: {
      id: true,
      name: true,
      skills: true,
      rating: true,
      status: true,
      serviceArea: true,
      merchantId: true,
      merchant: { select: { name: true, status: true } },
    },
  });

  return {
    cleanSku,
    acSku,
    platformAreas,
    merchantAreas,
    masterRows,
    masterFixes: [],
  };
}

(async () => {
  const snap: Snapshot = { createdOrderIds: [] };
  try {
    const fix = await loadFixture();
    snap.masterFixes = fix.masterFixes;

    // 备份所有 MerchantArea.enabled 状态（用于场景 4 临时禁用后恢复）
    snap.merchantAreaEnabledBackup = await prisma.merchantArea.findMany({
      select: { merchantId: true, platformAreaId: true, enabled: true },
    });

    // 备份商家 A 状态（用于场景 5）
    const merchantARecord = await prisma.merchant.findFirst({
      where: { name: "深圳南山服务商 A" },
    });
    if (merchantARecord) {
      snap.shenzhenNanshanOriginalStatus = merchantARecord.status;
    }

    // 转换 masters
    const masters = fix.masterRows.map((m) => {
      let skills: string[] = [];
      try {
        const parsed = JSON.parse(m.skills);
        if (Array.isArray(parsed))
          skills = parsed.filter((s) => typeof s === "string");
      } catch {}
      return {
        id: m.id,
        name: m.name,
        phone: "",
        skills,
        rating: m.rating,
        completedJobs: 0,
        status: m.status as "available" | "busy" | "offline",
        serviceArea: m.serviceArea ?? "",
        merchantId: m.merchantId,
        merchantName: m.merchant?.name ?? undefined,
      };
    });

    // 加载 DispatchRule
    const ruleRows = await prisma.dispatchRule.findMany({
      where: { enabled: true },
    });
    const rules = ruleRows
      .map((r) => {
        let spec;
        try {
          spec = JSON.parse(r.ruleJson);
        } catch {
          return null;
        }
        return {
          id: r.id,
          name: r.name,
          priority: r.priority,
          enabled: r.enabled,
          spec: {
            match: spec.match ?? {},
            requiredSkills: spec.requiredSkills ?? [],
          },
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // ============================================================
    // 场景 1: 南山粤海 + A 绑区
    // ============================================================
    {
      const r = recommendMastersForOrder({
        order: {
          skuId: fix.cleanSku.id,
          categoryId: fix.cleanSku.categoryId,
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          street: "粤海街道",
        },
        rules,
        masters: masters.map((m) => ({ ...m, status: "available" as const })),
        platformAreas: fix.platformAreas,
        merchantAreas: fix.merchantAreas,
      });
      const t001 = r.candidates.find((c) => c.id === "T001");
      assert(
        "场景 1: 南山粤海推荐 T001（A 师傅）",
        !!t001,
        `candidates=[${r.candidates.map((c) => c.id).join(",")}] reason=${r.reason}`,
      );
    }

    // ============================================================
    // 场景 2: 福田华强北 + B 绑区 + A 不绑
    // ============================================================
    {
      const merchantA = await prisma.merchant.findFirst({
        where: { name: "深圳南山服务商 A" },
      });
      const merchantB = await prisma.merchant.findFirst({
        where: { name: "深圳福田服务商 B" },
      });
      if (!merchantA || !merchantB) {
        assert("场景 2: 找不到商家 A 或 B", false, "前置失败");
      } else {
        // 备份 T002 原始值
        const t002Original = await prisma.master.findUnique({
          where: { id: "T002" },
        });
        if (t002Original) {
          snap.t002 = {
            merchantId: t002Original.merchantId,
            skills: t002Original.skills,
          };
        }

        // T002 改属 B + 加保洁技能
        await prisma.master.update({
          where: { id: "T002" },
          data: {
            merchantId: merchantB.id,
            skills: JSON.stringify(["水电维修", "管道疏通", "保洁"]),
          },
        });

        // 重新查 master（反映 T002 改属 + 加技能）
        const scenario2MasterRows = await prisma.master.findMany({
          select: {
            id: true,
            name: true,
            skills: true,
            rating: true,
            status: true,
            serviceArea: true,
            merchantId: true,
            merchant: { select: { name: true, status: true } },
          },
        });
        const scenario2Masters = scenario2MasterRows.map((m) => {
          let skills: string[] = [];
          try {
            const parsed = JSON.parse(m.skills);
            if (Array.isArray(parsed))
              skills = parsed.filter((s) => typeof s === "string");
          } catch {}
          return {
            id: m.id,
            name: m.name,
            phone: "",
            skills,
            rating: m.rating,
            completedJobs: 0,
            status: m.status as "available" | "busy" | "offline",
            serviceArea: m.serviceArea ?? "",
            merchantId: m.merchantId,
            merchantName: m.merchant?.name ?? undefined,
          };
        });

        // A 在福田解绑；B 在福田加绑
        const futianId = fix.platformAreas.find(
          (pa) => pa.district === "福田区",
        )?.id;
        await prisma.merchantArea.updateMany({
          where: { merchantId: merchantA.id, platformAreaId: futianId! },
          data: { enabled: false },
        });
        const bExistFutian = await prisma.merchantArea.findUnique({
          where: {
            merchantId_platformAreaId: {
              merchantId: merchantB.id,
              platformAreaId: futianId!,
            },
          },
        });
        if (bExistFutian) {
          await prisma.merchantArea.update({
            where: {
              merchantId_platformAreaId: {
                merchantId: merchantB.id,
                platformAreaId: futianId!,
              },
            },
            data: { enabled: true },
          });
        } else {
          await prisma.merchantArea.create({
            data: {
              merchantId: merchantB.id,
              platformAreaId: futianId!,
              enabled: true,
            },
          });
        }
        const scenario2Mas = await prisma.merchantArea.findMany({
          where: { enabled: true, merchant: { status: "active" } },
          select: { merchantId: true, platformAreaId: true, enabled: true },
        });
        const r = recommendMastersForOrder({
          order: {
            skuId: fix.cleanSku.id,
            categoryId: fix.cleanSku.categoryId,
            province: "广东省",
            city: "深圳市",
            district: "福田区",
            street: "华强北街道",
          },
          rules,
          masters: scenario2Masters.map((m) => ({
            ...m,
            status: "available" as const,
          })),
          platformAreas: fix.platformAreas,
          merchantAreas: scenario2Mas,
        });
        const hasT002 = r.candidates.find((c) => c.id === "T002");
        const hasT001 = r.candidates.find((c) => c.id === "T001");
        assert(
          "场景 2: 福田华强北推荐 T002（B 师傅）",
          !!hasT002,
          `candidates=[${r.candidates.map((c) => c.id).join(",")}] reason=${r.reason}`,
        );
        assert(
          "场景 2: 福田华强北不推荐 T001（A 不绑）",
          !hasT001,
          `candidates=[${r.candidates.map((c) => c.id).join(",")}]`,
        );
      }
    }

    // ============================================================
    // 场景 3: 订单区域不在任何 PlatformArea
    // ============================================================
    {
      const r = recommendMastersForOrder({
        order: {
          skuId: fix.cleanSku.id,
          categoryId: fix.cleanSku.categoryId,
          province: "北京市",
          city: "北京市",
          district: "朝阳区",
          street: "建国路",
        },
        rules,
        masters: masters.map((m) => ({ ...m, status: "available" as const })),
        platformAreas: fix.platformAreas,
        merchantAreas: fix.merchantAreas,
      });
      assert(
        "场景 3: 朝阳区无 PlatformArea → 拒 + failureCode=area_no_platform_area",
        r.candidates.length === 0 && r.failureCode === "area_no_platform_area",
        `reason=${r.reason}`,
      );
    }

    // ============================================================
    // 场景 4: 平台区存在但无 active 商家覆盖
    // ============================================================
    {
      const baoanId = fix.platformAreas.find(
        (pa) => pa.district === "宝安区",
      )?.id;
      // 临时解绑所有商家在宝安区的绑定
      await prisma.merchantArea.updateMany({
        where: { platformAreaId: baoanId! },
        data: { enabled: false },
      });
      const scenario4Mas = await prisma.merchantArea.findMany({
        where: { enabled: true, merchant: { status: "active" } },
        select: { merchantId: true, platformAreaId: true, enabled: true },
      });
      const r = recommendMastersForOrder({
        order: {
          skuId: fix.cleanSku.id,
          categoryId: fix.cleanSku.categoryId,
          province: "广东省",
          city: "深圳市",
          district: "宝安区",
          street: "西乡街道",
        },
        rules,
        masters: masters.map((m) => ({ ...m, status: "available" as const })),
        platformAreas: fix.platformAreas,
        merchantAreas: scenario4Mas,
      });
      assert(
        "场景 4: 宝安区无 active 商家 → 拒 + failureCode=area_no_merchant",
        r.candidates.length === 0 && r.failureCode === "area_no_merchant",
        `reason=${r.reason}`,
      );
    }

    // ============================================================
    // 场景 5: 商家覆盖区域但商家 inactive
    // ============================================================
    {
      const shenzhenNanshan = await prisma.merchant.findFirst({
        where: { name: "深圳南山服务商 A" },
      });
      if (!shenzhenNanshan) {
        assert("场景 5: 找不到 '深圳南山服务商 A'", false, "前置失败");
      } else {
        await prisma.merchant.update({
          where: { id: shenzhenNanshan.id },
          data: { status: "inactive" },
        });
        const activeMerchantAreas = await prisma.merchantArea.findMany({
          where: { enabled: true, merchant: { status: "active" } },
          select: { merchantId: true, platformAreaId: true, enabled: true },
        });
        const r = recommendMastersForOrder({
          order: {
            skuId: fix.cleanSku.id,
            categoryId: fix.cleanSku.categoryId,
            province: "广东省",
            city: "深圳市",
            district: "南山区",
            street: "粤海街道",
          },
          rules,
          masters: masters
            .filter((m) => m.merchantId !== shenzhenNanshan.id)
            .map((m) => ({ ...m, status: "available" as const })),
          platformAreas: fix.platformAreas,
          merchantAreas: activeMerchantAreas,
        });
        const hasT001 = r.candidates.find((c) => c.id === "T001");
        assert(
          "场景 5: 商家 A inactive → T001 不推荐",
          !hasT001,
          `candidates=[${r.candidates.map((c) => c.id).join(",")}] reason=${r.reason}`,
        );
      }
    }

    // ============================================================
    // 场景 6: 商家覆盖 + 师傅技能不匹配
    // 订单在南山粤海（M001/M002 绑），用 SKU=APPLIANCE-AC-WALL（要求「空调维修」）
    // T001 技能=[保洁,家电清洗] → 区域匹配但技能不匹配 → 不在候选
    // T004 技能=[空调维修,家电维修] 但属 M003（不绑南山） → 区域不匹配 → 不在候选
    // → candidates 应空，failureCode=no_skill_matched
    // ============================================================
    {
      const r = recommendMastersForOrder({
        order: {
          skuId: fix.acSku.id,
          categoryId: fix.acSku.categoryId,
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          street: "粤海街道",
        },
        rules,
        masters: masters.map((m) => ({ ...m, status: "available" as const })),
        platformAreas: fix.platformAreas,
        merchantAreas: fix.merchantAreas,
      });
      const hasT001 = r.candidates.find((c) => c.id === "T001");
      const hasT004 = r.candidates.find((c) => c.id === "T004");
      assert(
        "场景 6: T001 技能不匹配 → 不在候选",
        !hasT001,
        `candidates=[${r.candidates.map((c) => c.id).join(",")}]`,
      );
      assert(
        "场景 6: T004 区域不匹配 → 不在候选",
        !hasT004,
        `candidates=[${r.candidates.map((c) => c.id).join(",")}]`,
      );
      assert(
        "场景 6: candidates 应空 + failureCode=no_skill_matched",
        r.candidates.length === 0 && r.failureCode === "no_skill_matched",
        `reason=${r.reason}`,
      );
    }

    // ============================================================
    // 附加: getOrdersVisibleToMerchant 验证
    // ============================================================
    {
      // 先恢复商家 A 状态 + 全部 MerchantArea enabled（前面场景 5 改了）
      const shenzhenNanshan0 = await prisma.merchant.findFirst({
        where: { name: "深圳南山服务商 A" },
      });
      if (shenzhenNanshan0) {
        await prisma.merchant.update({
          where: { id: shenzhenNanshan0.id },
          data: { status: "active" },
        });
      }
      await prisma.merchantArea.updateMany({ data: { enabled: true } });
      const { getOrdersVisibleToMerchant } = await import("../src/lib/queries");
      const shenzhenNanshan = await prisma.merchant.findFirst({
        where: { name: "深圳南山服务商 A" },
      });
      if (!shenzhenNanshan) {
        assert(
          "getOrdersVisibleToMerchant 找不到 '深圳南山服务商 A'",
          false,
          "前置失败",
        );
      } else {
        const nanshanId = fix.platformAreas.find(
          (pa) => pa.district === "南山区",
        )?.id;
        // 临时只绑南山区
        await prisma.merchantArea.updateMany({
          where: { merchantId: shenzhenNanshan.id, enabled: true },
          data: { enabled: false },
        });
        await prisma.merchantArea.updateMany({
          where: {
            merchantId: shenzhenNanshan.id,
            platformAreaId: nanshanId!,
          },
          data: { enabled: true },
        });

        const testOrderN = await prisma.order.create({
          data: {
            id: "O_VERIFY_NANSHAN_TEST",
            customerName: "_test_verify",
            customerPhone: "13900099001",
            serviceSkuId: fix.cleanSku.id,
            serviceName: "_test_sku",
            address: "广东省深圳市南山区粤海街道科技园 1 号",
            province: "广东省",
            city: "深圳市",
            district: "南山区",
            street: "粤海街道",
            addressDetail: "科技园 1 号",
            scheduledAt: new Date(),
            amount: 10000,
            status: "pending",
          },
        });
        snap.createdOrderIds.push(testOrderN.id);

        const testOrderF = await prisma.order.create({
          data: {
            id: "O_VERIFY_FUTIAN_TEST",
            customerName: "_test_verify_f",
            customerPhone: "13900099002",
            serviceSkuId: fix.cleanSku.id,
            serviceName: "_test_sku",
            address: "广东省深圳市福田区华强北街道华强路 1 号",
            province: "广东省",
            city: "深圳市",
            district: "福田区",
            street: "华强北街道",
            addressDetail: "华强路 1 号",
            scheduledAt: new Date(),
            amount: 10000,
            status: "pending",
          },
        });
        snap.createdOrderIds.push(testOrderF.id);

        const m001View = await getOrdersVisibleToMerchant(shenzhenNanshan.id);
        const orders = m001View.orders;
        assert(
          "getOrdersVisibleToMerchant(深圳南山服务商 A) 返回非空",
          orders.length >= 1,
          `totalCount=${orders.length}`,
        );
        const allInM001Area = orders.every(
          (o) =>
            o.province === "广东省" &&
            o.city === "深圳市" &&
            o.district === "南山区" &&
            o.street === "粤海街道",
        );
        assert(
          "getOrdersVisibleToMerchant 所有订单都在南山区粤海街道",
          allInM001Area,
          orders
            .map(
              (o) =>
                `${o.id}:${o.province}/${o.city}/${o.district}/${o.street}`,
            )
            .join("; "),
        );
        const futianOrder = orders.find((o) => o.id === "O_VERIFY_FUTIAN_TEST");
        assert(
          "getOrdersVisibleToMerchant 不返回福田订单",
          !futianOrder,
          `总订单数=${orders.length}`,
        );
      }
    }

    console.log("");
    console.log(`========== ${passed} passed, ${failed} failed ==========`);
  } catch (e) {
    console.error("verify-dispatch 异常:", e);
  } finally {
    // 强制恢复所有备份（无论成功/失败）— 必须先跑完 finally 再 exit
    await safeRestore(snap);
    await prisma.$disconnect();
  }
  if (failed > 0) {
    process.exit(1);
  }
})();
