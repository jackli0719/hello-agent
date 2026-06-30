// 师傅端查询 — 师傅端 H5 页面用的数据访问层。
//
// 范围（按师傅端 MVP 需求）：
// 1. 列出「可选师傅」下拉框数据（名字 + 手机号后 4 位，方便演示）
// 2. 按 masterId 查该师傅的订单，过滤掉 pending（没派单的订单不该出现在师傅端）
//
// 设计要点：
// - 不复用 queries.ts 的 listOrdersForPage：那个带「派单推荐」逻辑，师傅端不需要
// - 直接打 Prisma —— 师傅端是独立路径，跨表组装不复杂，不需要 queries 层
// - 金额单位转换（分 → 元）在这一层完成，UI 拿到的是元

import { prisma } from "@/src/lib/db";
import type { OrderStatus } from "@/src/types";

// ---------- 类型 ----------

/** 师傅端用的精简 Order 视图 */
export interface WorkerOrder {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  address: string;
  scheduledAt: string; // ISO 字符串
  amountYuan: number;
  status: OrderStatus;
  createdAt: string; // ISO 字符串
}

/** 师傅下拉框选项 */
export interface WorkerOption {
  id: string;
  name: string;
  phoneTail: string; // 手机号后 4 位，避免列表太长
  status: "available" | "busy" | "offline";
}

// ---------- 师傅下拉框数据 ----------

/**
 * 列「可选师傅」下拉框数据。
 *
 * 范围：所有师傅（不过滤 offline — MVP 演示期不分离线，师傅列表就是演示用）。
 * MVP 简化：师傅端不做真实登录，列表给得全一点方便选。
 *
 * # MVP: 不分可用/不可用 — 演示期不需要
 */
export async function listWorkerOptions(): Promise<WorkerOption[]> {
  const rows = await prisma.master.findMany({
    select: { id: true, name: true, phone: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // 手机号后 4 位：手机号长度不够时取原值
    phoneTail: r.phone.length >= 4 ? r.phone.slice(-4) : r.phone,
    status: r.status as WorkerOption["status"],
  }));
}

// ---------- 师傅订单查询 ----------

/**
 * 查一个师傅被分配的所有订单（assigned / in_service / completed / cancelled）。
 *
 * 过滤规则（按需求）：
 * - masterId 必须匹配
 * - 排除 pending（还没派单的订单不该出现在师傅端 — 还没确定师傅）
 * - 排除 cancelled 师傅被释放后的「已取消」订单也算「历史订单」要展示（便于演示看历史），
 *   但因为 masterId 关联仍在，需求 #7 明确「已取消只展示不允许操作」，所以**保留** cancelled
 *
 * 排序：按预约时间升序（师傅端要按时间接单，最近的优先）
 */
export async function listOrdersForMaster(
  masterId: string,
): Promise<WorkerOrder[]> {
  if (!masterId) return [];
  const rows = await prisma.order.findMany({
    where: {
      masterId,
      // 排除 pending：还没分配师傅的订单不该出现
      // 保留 cancelled：师傅端能看到「这单已取消」历史
      status: { in: ["assigned", "in_service", "completed", "cancelled"] },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      serviceName: true,
      address: true,
      scheduledAt: true,
      amount: true,
      status: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    serviceName: r.serviceName,
    address: r.address,
    scheduledAt: r.scheduledAt.toISOString(),
    amountYuan: r.amount / 100,
    status: r.status as OrderStatus,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------- 订单详情 ----------

/**
 * 师傅端用的订单详情（含服务品类名 + 师傅名）。
 *
 * 与 WorkerOrder 的差异：
 * - 多 categoryName（服务品类，跨 SKU 表 join 拿）
 * - 多 masterName / masterPhone（师傅名 + 手机，方便详情页展示）
 *
 * WorkerOrder（列表用）和 WorkerOrderDetail（详情用）分两个类型：
 * 列表场景需要轻量字段（少 join），详情页需要完整字段（多 join）。
 * 不共用类型避免「详情接口去查列表数据」的反向依赖。
 */
export interface WorkerOrderDetail {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  serviceCategoryName: string | null;
  address: string;
  scheduledAt: string; // ISO 字符串
  amountYuan: number;
  status: OrderStatus;
  createdAt: string; // ISO 字符串
  masterId: string | null;
  masterName: string | null;
  masterPhone: string | null;
  // [v0.7.6] 备注字段
  /** 用户下单备注 */
  remark: string | null;
  /** 后台内部备注（师傅也可见 — 帮师傅了解后台要求） */
  internalRemark: string | null;
  /** 师傅完成订单时填的服务说明（completed 状态才有） */
  serviceSummary: string | null;
}

/**
 * 按订单号查详情（师傅端用）。
 *
 * 安全设计：
 * - 可选 second 参数 masterId — 传了就校验「订单必须属于该师傅」；不传就不校验
 *   （兼容调试 / 单元测试场景）。生产环境如果做师傅登录，这里必须强制校验。
 * - 找不到订单 / masterId 不匹配 → 返 null（UI 用 notFound 渲染 404）
 *
 * 过滤：pending 订单也查不到（防御性 — 师傅端不应该有 pending 订单出现）
 *
 * # MVP: 越权靠 URL masterId 校验。真实上线必须改成 session 鉴权（师傅登录后只能看自己）。
 */
export async function getOrderForWorker(
  orderId: string,
  masterId?: string,
): Promise<WorkerOrderDetail | null> {
  if (!orderId) return null;
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      serviceName: true,
      address: true,
      scheduledAt: true,
      amount: true,
      status: true,
      createdAt: true,
      masterId: true,
      masterName: true,
      remark: true, // [v0.7.6] 用户下单备注
      internalRemark: true, // [v0.7.6] 后台内部备注
      serviceSummary: true, // [v0.7.6] 师傅完成说明
      master: { select: { name: true, phone: true } },
      serviceSku: {
        select: {
          category: { select: { name: true } },
        },
      },
    },
  });
  if (!row) return null;

  // 防御性：pending 订单不该出现在师傅端。如果意外查到（数据异常），也返 null
  if (row.status === "pending") return null;

  // 越权防护：传了 masterId 但订单不归这个师傅 → 返 null（不告诉调用方「订单存在」）
  if (masterId && row.masterId !== masterId) return null;

  return {
    id: row.id,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    serviceName: row.serviceName,
    serviceCategoryName: row.serviceSku?.category.name ?? null,
    address: row.address,
    scheduledAt: row.scheduledAt.toISOString(),
    amountYuan: row.amount / 100,
    status: row.status as OrderStatus,
    createdAt: row.createdAt.toISOString(),
    masterId: row.masterId,
    masterName: row.masterName ?? row.master?.name ?? null,
    masterPhone: row.master?.phone ?? null,
    // [v0.7.6] 备注字段
    remark: row.remark,
    internalRemark: row.internalRemark,
    serviceSummary: row.serviceSummary,
  };
}
