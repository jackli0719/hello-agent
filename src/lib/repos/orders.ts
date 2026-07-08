// 订单 repo — 唯一允许直接 import @prisma/client 的地方。
// 页面 / 组件 / server action 都只调这里的函数，不直接碰 Prisma Client。
// 后续要换数据源（比如接外部 API），只改这一个文件。

import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import type { Order, OrderStatus } from "@/src/types";
import { listMasters } from "./masters";
import { recommendMastersForOrder, parseRuleJson } from "@/lib/dispatch";

// ---------- 类型 ----------
export interface ListOrdersFilters {
  q?: string;
  status?: OrderStatus | "all";
}

// 创建订单的输入 — 由 server action 校验后传入。
// serviceSkuId 必填（前端下拉只列已上架 SKU）；customerName/address 必填非空。
// scheduledAt 必填；amount 必填且 >= 0。
export interface CreateOrderInput {
  serviceSkuId: string;
  customerName: string;
  address: string;
  scheduledAt: Date;
  amount: number; // 元（页面录入的），repo 内转分
}

/**
 * 派单的结果。订单 + 师傅两边都改了才返回 ok=true。
 * reason 是派单理由（含「没匹配上」的失败原因），UI 可直接展示。
 */
export interface AssignOrderResult {
  order: Order;
  recommendation: {
    rule: { id: string; name: string } | null;
    candidates: { id: string; name: string; rating: number }[];
    reason: string;
  };
}

// ---------- 工具：Date → 带本地时区的 ISO 字符串 ----------
export function toLocalISOString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzOffset = -d.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffset);
  const tz = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`
  );
}

interface DbOrderRow {
  id: string;
  customerName: string;
  serviceName: string;
  masterName: string | null;
  address: string;
  scheduledAt: Date;
  amount: number;
  status: string;
}

function toOrder(row: DbOrderRow): Order {
  return {
    id: row.id,
    customerName: row.customerName,
    customerPhone: "", // 演示期 schema 没这字段，仓库层补空串保持领域类型对齐
    serviceName: row.serviceName,
    technicianName: row.masterName,
    address: row.address,
    scheduledAt: toLocalISOString(row.scheduledAt),
    amount: row.amount / 100,
    status: row.status as OrderStatus,
  };
}

const orderSelect = {
  id: true,
  customerName: true,
  serviceName: true,
  masterId: true,
  masterName: true,
  address: true,
  scheduledAt: true,
  amount: true,
  status: true,
} satisfies Prisma.OrderSelect;

// ---------- 读 ----------

export async function listOrders(
  filters: ListOrdersFilters = {},
): Promise<Order[]> {
  const { q = "", status = "all" } = filters;
  const keyword = q.trim();

  const where: Record<string, unknown> = {};
  if (status !== "all") where.status = status;
  if (keyword) {
    where.OR = [
      { id: { contains: keyword } },
      { customerName: { contains: keyword } },
      { serviceName: { contains: keyword } },
      { masterName: { contains: keyword } },
      { address: { contains: keyword } },
    ];
  }

  const rows = await prisma.order.findMany({
    where,
    orderBy: { scheduledAt: "desc" },
    select: orderSelect,
  });

  return rows.map(toOrder);
}

export async function countOrdersByStatus(): Promise<
  Record<"all" | OrderStatus, number>
> {
  const rows = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const result = {
    all: 0,
    pending: 0,
    assigned: 0,
    in_service: 0,
    completed: 0,
    cancelled: 0,
  } as Record<"all" | OrderStatus, number>;
  for (const r of rows) {
    result.all += r._count._all;
    if (r.status in result) {
      result[r.status as OrderStatus] = r._count._all;
    }
  }
  return result;
}

// ---------- 写 ----------

export class AssignOrderError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    // [任务 20] 失败原因 code — 从 dispatch.ts 的 failureCode 透传
    // 让上层（auto-dispatch.ts）能精确分类到 AutoDispatchFailureCode
    // 不破坏既有调用方（保持 optional 兼容）
    readonly failureCode?: string,
  ) {
    super(message);
    this.name = "AssignOrderError";
  }
}

export class ReleaseOrderError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ReleaseOrderError";
  }
}

/**
 * 释放订单对应的师傅 — 订单完成 / 取消后调用。
 *
 * 规则：
 * - 订单必须存在
 * - 订单当前必须是 assigned / in_service（pending 无师傅可释放；completed/cancelled 已释放过）
 * - 事务里同时改订单状态 + 师傅状态（available），两边一致
 *
 * 副作用细节：
 * - 师傅可能已经在别的并发路径里被改了（极小概率），用 update 时的 status 条件兜底
 *   — 「该师傅当前还是 busy 时才把它改回 available」，避免误改一个本来就没接单的师傅
 */
export async function releaseMaster(
  orderId: string,
  nextStatus: "completed" | "cancelled",
): Promise<Order> {
  if (nextStatus !== "completed" && nextStatus !== "cancelled") {
    throw new ReleaseOrderError("参数错误", `不支持的状态 ${nextStatus}`);
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ReleaseOrderError("订单不存在", `订单 ${orderId} 不存在`);
  }
  if (order.status !== "assigned" && order.status !== "in_service") {
    throw new ReleaseOrderError(
      "不可释放",
      `订单当前状态为「${order.status}」，没有需要释放的师傅`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: { status: nextStatus },
      select: orderSelect,
    });
    // 只在「师傅真的还 busy」时改回 available — 兜住并发场景
    if (order.masterId) {
      await tx.master.updateMany({
        where: { id: order.masterId, status: "busy" },
        data: { status: "available" },
      });
    }
    return updatedOrder;
  });

  return toOrder(updated);
}

/**
 * 给订单派单 — 找最佳师傅，改订单 + 改师傅状态，事务保证两边一致。
 *
 * 失败情形（抛 AssignOrderError）：
 * - 订单不存在
 * - 订单当前不是 pending（已派单 / 服务中 / 已完成 / 已取消）
 * - 订单未支付（payStatus !== "paid"）— [任务 20] 自动派单前必须 paid
 * - 没有任何合适师傅（沿用 matchTechnician 的所有失败分支）
 */
export async function assignOrder(orderId: string): Promise<AssignOrderResult> {
  // 1. 找订单
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AssignOrderError("订单不存在", `订单 ${orderId} 不存在`);
  }
  if (order.status !== "pending") {
    throw new AssignOrderError(
      "不可重复派单",
      `订单当前状态为「${order.status}」，不可重复派单`,
    );
  }

  // [任务 20] payStatus 守门 — 未支付订单不允许自动派单
  // 之前 src/lib/orders.ts:assignOrder(orderId, masterId) 有此守门，
  // repos/orders.ts:assignOrder(orderId) 缺 — 补上保持两条路径一致
  if (order.payStatus !== "paid") {
    throw new AssignOrderError(
      "未支付",
      `订单未支付（payStatus=${order.payStatus}），请先完成支付后再派单`,
    );
  }

  // 2. 从订单的 SKU 拿类目 ID（推荐函数需要 skuId + categoryId）
  const sku = order.serviceSkuId
    ? await prisma.serviceSku.findUnique({
        where: { id: order.serviceSkuId },
        select: { categoryId: true },
      })
    : null;
  const skuId = order.serviceSkuId;
  const categoryId = sku?.categoryId ?? null;

  // 3. 用新的 dispatch 纯函数做推荐 — 从 DB 读规则 + 师傅
  const [masters, ruleRows, platformAreaRows, merchantAreaRows] =
    await Promise.all([
      listMasters(),
      prisma.dispatchRule.findMany({
        where: { enabled: true },
        select: {
          id: true,
          name: true,
          priority: true,
          enabled: true,
          ruleJson: true,
        },
      }),
      prisma.platformArea.findMany({
        where: { enabled: true },
        select: {
          id: true,
          province: true,
          city: true,
          district: true,
          street: true,
          enabled: true,
        },
      }),
      prisma.merchantArea.findMany({
        where: { enabled: true, merchant: { status: "active" } },
        select: {
          merchantId: true,
          platformAreaId: true,
          enabled: true,
        },
      }),
    ]);
  const rules = ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    enabled: r.enabled,
    spec: parseRuleJson(r.ruleJson) ?? { match: {}, requiredSkills: [] },
  }));
  const recommendation = recommendMastersForOrder({
    order: {
      skuId,
      categoryId,
      // [任务 20] 4 级地址字段也传 — 让 dispatch.ts 走精确 PlatformArea 匹配
      // 旧 fallback（仅 address 模糊）保留；新订单都有 4 级，精确优先
      province: order.province,
      city: order.city,
      district: order.district,
      street: order.street,
      addressDetail: order.addressDetail,
      address: order.address,
    },
    rules,
    masters,
    platformAreas: platformAreaRows,
    merchantAreas: merchantAreaRows,
  });
  const topCandidate = recommendation.candidates[0];
  if (!topCandidate) {
    // [任务 20] 透传 failureCode — 让 auto-dispatch.ts 精确分类
    throw new AssignOrderError(
      "无可用师傅",
      recommendation.reason || "没有掌握所需技能的空闲师傅",
      recommendation.failureCode,
    );
  }

  // 4. 事务里同时改两边 — 任何一个失败都回滚
  const updated = await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        masterId: topCandidate.id,
        masterName: topCandidate.name, // 冗余快照同步
        status: "assigned",
      },
      select: orderSelect,
    });
    await tx.master.update({
      where: { id: topCandidate.id },
      data: { status: "busy" },
    });
    return updatedOrder;
  });

  return { order: toOrder(updated), recommendation };
}

/**
 * 创建订单。
 * - 业务主键（订单号）由调用方生成，repo 不负责 ID 策略。
 * - SKU 名称做快照冗余：将来 SKU 改名/下架，历史订单仍显示下单时的服务名。
 * - 金额元 → 分。
 */
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const sku = await prisma.serviceSku.findUnique({
    where: { id: input.serviceSkuId },
    select: { id: true, name: true },
  });
  if (!sku) {
    throw new Error(`服务项目 ${input.serviceSkuId} 不存在`);
  }

  const row = await prisma.order.create({
    data: {
      id: await generateOrderId(),
      customerName: input.customerName.trim(),
      serviceSkuId: sku.id,
      serviceName: sku.name, // 冗余快照
      masterId: null,
      masterName: null,
      address: input.address.trim(),
      scheduledAt: input.scheduledAt,
      amount: Math.round(input.amount * 100), // 元 → 分
      status: "pending",
    },
    select: orderSelect,
  });

  return toOrder(row);
}

/**
 * 订单号生成策略：YYYYMMDD + 4 位顺序号。
 * MVP 阶段「按日期 + 当日计数」足够；将来订单量大了换成雪花 ID 或 DB sequence。
 * 这里取「当日已经创建过几个」算顺序号 — 简单但有竞态风险（同一秒并发会撞号），
 * 真实场景需要 unique 约束兜底（MVP 不做）。
 */
export async function generateOrderId(now: Date = new Date()): Promise<string> {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const todayPrefix = `O${ymd}`;
  const count = await prisma.order.count({
    where: { id: { startsWith: todayPrefix } },
  });
  return `${todayPrefix}${pad(count + 1, 4)}`;
}
