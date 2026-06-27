// 订单业务逻辑 — 纯函数 + DB 写操作的封装。
// app/orders/actions.ts（server action）调这里的函数。
//
// ============================================================
// src/lib/ vs lib/ 目录说明（重要）
// ============================================================
// 项目有两个 lib/ 目录：
// - src/lib/  ← 新业务代码（auth, codes, masters, services, orders,
//                queries, dispatch-rules, worker, customer, repos/, db）
//                import 用 `@/src/lib/xxx`
// - lib/      ← 演示期遗留（mock-data + types + dispatch）
//                import 用 `@/lib/xxx`（@/ 解析到项目根 ./）
// 新写业务代码一律放 src/lib/。详见 lib/mock-data.ts 顶部说明。
// ============================================================

import { prisma } from "@/src/lib/db";
import { normalizeCode } from "@/src/lib/codes";

export type OrderField =
  | "customerName"
  | "customerPhone"
  | "address"
  | "skuCode"
  | "categoryCode"
  | "amount"
  | "scheduledAt"
  | "remark";

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  address: string;
  skuCode: string;
  // 可选 — 前端表单会传，服务端用来跟 skuCode 做「配对校验」
  // （防止客户端被改包后塞一个 skuCode 不属于 categoryCode 的组合）
  categoryCode?: string;
  amount: number;
  scheduledAt: Date;
  // 可选 — 用户端 MVP 加。trim 后非空就保留，否则 undefined（DB 存 null）
  remark?: string;
}

export type CreateOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string; field?: OrderField };

export function validateCreateOrderInput(
  input: Partial<CreateOrderInput>,
): { ok: true; cleaned: CreateOrderInput } | { ok: false; error: string; field: OrderField } {
  const customerName = (input.customerName ?? "").trim();
  if (!customerName) return { ok: false, error: "请填写客户姓名", field: "customerName" };
  if (customerName.length > 50) return { ok: false, error: "客户姓名不能超过 50 个字符", field: "customerName" };

  const customerPhone = (input.customerPhone ?? "").trim();
  if (!customerPhone) return { ok: false, error: "请填写手机号", field: "customerPhone" };
  if (!/^1\d{10}$/.test(customerPhone)) {
    return { ok: false, error: "手机号格式不正确（11 位数字，1 开头）", field: "customerPhone" };
  }

  const address = (input.address ?? "").trim();
  if (!address) return { ok: false, error: "请填写服务地址", field: "address" };
  if (address.length > 200) return { ok: false, error: "服务地址不能超过 200 个字符", field: "address" };

  const skuCodeRaw = (input.skuCode ?? "").trim();
  if (!skuCodeRaw) return { ok: false, error: "请选择服务 SKU", field: "skuCode" };

  // categoryCode 可选 — 旧调用方不传时跳过校验。trim 后非空就保留，否则置 undefined
  let categoryCode: string | undefined;
  if (typeof input.categoryCode === "string") {
    const trimmed = input.categoryCode.trim();
    if (trimmed) categoryCode = trimmed;
  }

  // 大小写 / 字符规范化：把所有输入强制转成合规编码。
  // 用户写 'clean-daily-2h' 跟 'CLEAN-DAILY-2H' 视为同一个 SKU。
  // SQLite 不支持 @db.Collate — 应用层是唯一防线。
  const skuCode = normalizeCode(skuCodeRaw);
  if (categoryCode !== undefined) categoryCode = normalizeCode(categoryCode);
  // normalize 后可能变空（输入完全是非法字符） — 重新校验
  if (!skuCode) return { ok: false, error: "服务 SKU 格式不合法", field: "skuCode" };
  if (categoryCode === "") categoryCode = undefined;

  if (typeof input.amount !== "number" || Number.isNaN(input.amount)) {
    return { ok: false, error: "金额必须是数字", field: "amount" };
  }
  if (input.amount < 0) return { ok: false, error: "金额不能为负数", field: "amount" };
  if (input.amount > 1_000_000) return { ok: false, error: "金额超出合理范围", field: "amount" };

  if (!(input.scheduledAt instanceof Date) || Number.isNaN(input.scheduledAt.getTime())) {
    return { ok: false, error: "预约时间不正确", field: "scheduledAt" };
  }

  // remark 可选 — trim 后非空就保留，否则 undefined（DB 写 null）
  let remark: string | undefined;
  if (typeof input.remark === "string") {
    const trimmed = input.remark.trim();
    if (trimmed) remark = trimmed;
  }
  // 长度上限：和 address 一样防御性卡一下
  if (remark !== undefined && remark.length > 500) {
    return { ok: false, error: "备注不能超过 500 个字符", field: "remark" };
  }

  return {
    ok: true,
    cleaned: {
      customerName,
      customerPhone,
      address,
      skuCode,
      categoryCode,
      amount: input.amount,
      scheduledAt: input.scheduledAt,
      remark,
    },
  };
}

export async function createOrder(
  rawInput: Partial<CreateOrderInput>,
): Promise<CreateOrderResult> {
  const validated = validateCreateOrderInput(rawInput);
  if (!validated.ok) {
    return { ok: false, error: validated.error, field: validated.field };
  }
  const input = validated.cleaned;

  const sku = await prisma.serviceSku.findUnique({
    where: { skuCode: input.skuCode },
    select: {
      id: true,
      name: true,
      enabled: true,
      category: { select: { categoryCode: true } },
    },
  });
  if (!sku) {
    return { ok: false, error: `SKU 不存在：${input.skuCode}`, field: "skuCode" };
  }
  if (!sku.enabled) {
    return { ok: false, error: `SKU 已下架：${sku.name}`, field: "skuCode" };
  }

  // 配对校验：客户端传的 categoryCode 必须等于 SKU 真实所属类目的 categoryCode。
  // 这是「前端改了 skuCode 但没改 categoryCode」或者反过来时的兜底。
  // 不传 categoryCode 时跳过（兼容旧调用方/外部 API）。
  if (input.categoryCode !== undefined && sku.category.categoryCode !== input.categoryCode) {
    return {
      ok: false,
      error: `SKU「${sku.name}」不属于类目「${input.categoryCode}」`,
      field: "categoryCode",
    };
  }

  // 写订单 + 撞号重试：generateNextOrderId 读 count+1，同一秒并发提交可能撞号。
  // 撞到 unique 约束就 +1 再试，最多 MAX_RETRIES 次（5 次基本覆盖 99% 场景）。
  // 真正的并发安全靠 DB unique 约束 + 重试，不是靠「count 准确」。
  const MAX_RETRIES = 5;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const orderId = await generateNextOrderId();
    try {
      await prisma.order.create({
        data: {
          id: orderId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          serviceSkuId: sku.id,
          serviceName: sku.name,
          address: input.address,
          scheduledAt: input.scheduledAt,
          amount: Math.round(input.amount * 100),
          status: "pending",
          remark: input.remark ?? null,
        },
      });
      return { ok: true, orderId };
    } catch (e) {
      lastError = e;
      if (isUniqueConflict(e) && attempt < MAX_RETRIES) {
        continue; // 撞号了，下一轮 attempt 会重新读 count 然后 +1
      }
      throw e; // 不是撞号（其他系统错误），或重试耗尽（极端并发）：抛出去
    }
  }
  // 重试耗尽才走到这里 — 5 次都撞号说明并发极高，转成业务错误返回
  throw lastError instanceof Error ? lastError : new Error("订单号生成失败");
}

/** 判断 Prisma 错误是否是 unique 约束冲突 */
function isUniqueConflict(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  // Prisma 5 的 SQLite unique 冲突：error.code === "P2002"
  const code = (e as { code?: string }).code;
  return code === "P2002";
}

/**
 * 拼一个候选订单号（纯函数）：O + YYYYMMDD + 4 位顺序号。
 * 这是「纯格式化」，不查 DB。createOrder 自己查 DB 算当前 seq。
 *
 * 暴露这个函数方便：
 * - 单测断言订单号格式
 * - 外部调用方（比如批量导入脚本）想预览即将生成的号
 */
export function buildOrderId(now: Date, seq: number): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `O${ymd}${pad(seq, 4)}`;
}

/**
 * 查 DB 算「下一个候选订单号」：O + YYYMMDD + (count + 1)。
 * 同日并发可能返回重复值 — 由 createOrder 的重试兜底。
 */
export async function generateNextOrderId(now: Date = new Date()): Promise<string> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const todayPrefix = `O${ymd}`;
  const count = await prisma.order.count({
    where: { id: { startsWith: todayPrefix } },
  });
  return buildOrderId(now, count + 1);
}

// ============================================================
// 派单
// ============================================================

export class AssignOrderError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "AssignOrderError";
  }
}

export type AssignOrderResult =
  | {
      ok: true;
      orderId: string;
      masterId: string;
      masterName: string;
    }
  | {
      ok: false;
      // 分类：调用方根据 category 决定如何展示
      // - "validation"：业务校验失败（订单已派 / 师傅忙），给用户看理由
      // - "system"：DB 挂了之类，给「重试」按钮
      category: "validation" | "system";
      error: string;
    };

/**
 * 给订单派单（写操作）。
 *
 * 规则（按需求）：
 * 1. 订单必须存在，且 status === "pending"
 * 2. 师傅必须存在，且 status === "available"
 * 3. 师傅技能必须覆盖「订单命中的派单规则 requiredSkills」
 * 4. 通过校验 → 事务里改订单（masterId/masterName/status='assigned'） +
 *    师傅（status='busy'）
 *
 * 设计取舍：
 * - 重新调 recommendMastersForOrder 算推荐，而不是相信前端传来的 masterId
 *   —— 服务端独立校验一次，前端可以被改包但服务端不信任
 */
export async function assignOrder(
  orderId: string,
  masterId: string,
): Promise<AssignOrderResult> {
  // 1. 加载订单 + 师傅
  const [order, master] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId } }),
    prisma.master.findUnique({ where: { id: masterId } }),
  ]);

  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (!master) {
    return {
      ok: false,
      category: "validation",
      error: `师傅 ${masterId} 不存在`,
    };
  }
  if (order.status !== "pending") {
    return {
      ok: false,
      category: "validation",
      error: `订单当前状态为「${order.status}」，不能重复派单`,
    };
  }
  if (master.status !== "available") {
    return {
      ok: false,
      category: "validation",
      error: `师傅「${master.name}」当前状态为「${master.status}」，不可派单`,
    };
  }

  // 2. 重新算一次推荐 — 服务端独立校验「师傅确实在候选人里」
  //    这防止前端改了 masterId 绕过校验
  const recommendation = await computeRecommendationForOrder(order);
  const candidate = recommendation.candidates.find((c) => c.id === masterId);
  if (!candidate) {
    return {
      ok: false,
      category: "validation",
      error: recommendation.rule
        ? `师傅「${master.name}」不符合规则「${recommendation.rule.name}」的要求`
        : `订单没有匹配的派单规则`,
    };
  }

  // 3. 事务：两边一起改
  //    用 updateMany + status='pending' 条件做乐观锁：
  //    如果订单已被并发抢单改成 assigned，count=0，我们回滚师傅状态改动并报错
  try {
    await prisma.$transaction(async (tx) => {
      // 乐观锁：只在订单仍是 pending 时改它
      const result = await tx.order.updateMany({
        where: { id: orderId, status: "pending" },
        data: {
          masterId: master.id,
          masterName: master.name, // 冗余快照
          status: "assigned",
        },
      });
      if (result.count === 0) {
        // 抢单失败 — 让事务抛错回滚
        throw new AssignOrderError(
          "派单失败",
          "订单已被其它派单操作抢走，请刷新后重试",
        );
      }
      // 师傅状态改 busy — 用 updateMany 加 status 条件兜住并发
      await tx.master.updateMany({
        where: { id: master.id, status: "available" },
        data: { status: "busy" },
      });
    });
  } catch (e) {
    if (e instanceof AssignOrderError) {
      return { ok: false, category: "validation", error: e.reason };
    }
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "派单失败",
    };
  }

  return {
    ok: true,
    orderId,
    masterId: master.id,
    masterName: master.name,
  };
}

/**
 * 内部工具：跟 queries.ts 一样调 recommendMastersForOrder。
 * 这里独立查 DB（不依赖 queries.ts 的 listOrdersForPage）— assignOrder 是个独立路径。
 */
async function computeRecommendationForOrder(
  order: { id: string; serviceSkuId: string | null; status: string },
) {
  const { recommendMastersForOrder, parseRuleJson } = await import("@/lib/dispatch");
  type Tech = {
    id: string; name: string; phone: string; skills: string;
    rating: number; completedJobs: number; status: string; serviceArea: string;
  };

  // 加载 SKU 拿 categoryId
  let categoryId: string | null = null;
  if (order.serviceSkuId) {
    const sku = await prisma.serviceSku.findUnique({
      where: { id: order.serviceSkuId },
      select: { categoryId: true },
    });
    categoryId = sku?.categoryId ?? null;
  }

  const [ruleRows, masterRows] = await Promise.all([
    prisma.dispatchRule.findMany({
      where: { enabled: true },
      select: { id: true, name: true, priority: true, enabled: true, ruleJson: true },
    }),
    prisma.master.findMany({
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
    }),
  ]);

  const rules = ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    enabled: r.enabled,
    // 坏数据：parseRuleJson 返回 null → spec 给个空 spec
    // 注：assignOrder 路径调用方少（派单时一次性查全量规则），
    // 坏规则 fallback 到空 spec 在这里「不参与匹配」是 OK 的（空 spec 永远不命中）
    spec: parseRuleJson(r.ruleJson) ?? { match: {}, requiredSkills: [] },
  }));

  const masters = (masterRows as Tech[]).map((row): import("@/src/types").Technician => {
    let skills: string[] = [];
    try {
      const parsed = JSON.parse(row.skills);
      if (Array.isArray(parsed)) skills = parsed.filter((s) => typeof s === "string");
    } catch {
      // 坏数据留空
    }
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      skills,
      rating: row.rating,
      completedJobs: row.completedJobs,
      status: row.status as import("@/src/types").TechnicianStatus,
      serviceArea: row.serviceArea ?? "",
    };
  });

  return recommendMastersForOrder({
    order: { skuId: order.serviceSkuId, categoryId },
    rules,
    masters,
  });
}

// ============================================================
// 状态流转
// ============================================================

export class TransitionOrderError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "TransitionOrderError";
  }
}

export type TransitionOrderResult =
  | { ok: true; orderId: string; nextStatus: "in_service" | "completed" | "cancelled" }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
    };

/**
 * 订单状态流转（不含派单本身 — 派单走 assignOrder）。
 *
 * 合法流转（按需求）：
 * - pending → cancelled（取消订单）
 * - assigned → in_service（开始服务）
 * - assigned → cancelled（取消订单）
 * - in_service → completed（完成订单）
 * - in_service → cancelled（取消订单）
 *
 * 边界规则：
 * - completed / cancelled 是终态，不能再变
 * - 取消订单时如果订单有 masterId，事务里把师傅从 busy 改回 available（沿用 releaseMaster 逻辑）
 * - 「完成订单」不改师傅状态 — 师傅做完这单应该还能接别的；但**当前阶段**简化：保持师傅 busy，
 *   等真实场景中「师傅下班 / 接下一单」时再释放（MVP 取舍）
 *
 * 用乐观锁（updateMany + status 条件）防并发：
 *   比如两个用户同时点「开始服务」和「取消订单」，只有一个成功。
 */
export async function transitionOrder(
  orderId: string,
  nextStatus: "in_service" | "completed" | "cancelled",
): Promise<TransitionOrderResult> {
  // 1. 加载订单
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, category: "validation", error: `订单 ${orderId} 不存在` };
  }

  // 2. 校验合法流转
  const allowed = ALLOWED_TRANSITIONS[order.status as keyof typeof ALLOWED_TRANSITIONS];
  if (!allowed || !allowed.includes(nextStatus)) {
    return {
      ok: false,
      category: "validation",
      error: `订单当前状态「${order.status}」不能变更为「${nextStatus}」`,
    };
  }

  // 3. 事务：乐观锁改订单 + 视情况释放师傅
  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: order.status }, // CAS：只在状态没变时改
        data: { status: nextStatus },
      });
      if (result.count === 0) {
        throw new TransitionOrderError(
          "状态变更失败",
          "订单状态已被其它操作改变，请刷新后重试",
        );
      }
      // 「取消」或「完成」时，如果订单有师傅，释放师傅回 available。
      // 业务语义：完成 = 这单做完了，师傅可以接下一单
      if (
        (nextStatus === "cancelled" || nextStatus === "completed") &&
        order.masterId
      ) {
        await tx.master.updateMany({
          where: { id: order.masterId, status: "busy" },
          data: { status: "available" },
        });
      }
    });
  } catch (e) {
    if (e instanceof TransitionOrderError) {
      return { ok: false, category: "validation", error: e.reason };
    }
    return {
      ok: false,
      category: "system",
      error: e instanceof Error ? e.message : "状态变更失败",
    };
  }

  return { ok: true, orderId, nextStatus };
}

// 合法流转表 — 用 lookup 代替一串 if
const ALLOWED_TRANSITIONS: Record<string, Array<"in_service" | "completed" | "cancelled">> = {
  pending: ["cancelled"],
  assigned: ["in_service", "cancelled"],
  in_service: ["completed", "cancelled"],
  // completed / cancelled 不在表里 = 终态，无法再变
};