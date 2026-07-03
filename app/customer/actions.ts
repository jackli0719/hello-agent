"use server";

// 用户端 server action — 创建订单。
//
// 设计：
// - 复用 src/lib/orders.ts:createOrder 的全部业务校验（手机号 11 位、配对校验、撞号重试）
// - 不复用 app/orders/actions.ts:createOrderAction — 后台那个会 redirect /orders，
//   用户端不能跳后台
// - 用户端没填「金额 / 预约时间」：自动用 SKU basePrice（amount）+ 明天 10:00（scheduledAt）
//
// # MVP: 金额默认走 SKU basePrice；预约时间默认明天 10:00。
//   演示期没真实日历控件，后台仍可在订单详情编辑这两个字段。
//
// [v0.5.0] 修 ADR-013 A5 P0：已登录 customer 下单 phone 必须等于 user.phone
//   防止「公开下单页 + customer1 账号 + 任何手机号」组合的隐私漏洞
//   未登录场景：仍允许（按需求保留 /customer 公开下单）

import { revalidatePath } from "next/cache";
import {
  createOrder,
  payOrder,
  type CreateOrderResult,
  type PayOrderResult,
} from "@/src/lib/orders";
import { getSkuBasePriceByCode } from "@/src/lib/customer";
import { createActivityLog } from "@/src/lib/activity-log";
import { getCurrentUser } from "@/src/lib/auth";
import { requireCsrf, requireRole } from "@/src/lib/auth-helpers";

export type CustomerCreateOrderResult = CreateOrderResult;

/** 默认预约时间：明天 10:00（演示期简化）。后台订单详情页可改 */
function defaultScheduledAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

/**
 * 用户端创建订单。
 * 接 FormData（前端 form action 直接传），调用 src/lib/orders.ts:createOrder。
 *
 * 成功：返回 { ok: true, orderId }，让 UI 展示订单号
 * 失败：返回 { ok: false, error, field }，让 UI 内联展示错误
 *
 * 注意：成功路径不 redirect — 用户端就在 /customer 页面展示成功提示
 */
export async function customerCreateOrderAction(
  formData: FormData,
): Promise<CustomerCreateOrderResult> {
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();

  // [v0.5.0] 修 A5：已登录 customer 时 phone 必须等于 user.phone
  const currentUser = await getCurrentUser();
  if (currentUser && currentUser.role === "customer" && currentUser.phone) {
    if (customerPhone !== currentUser.phone) {
      return {
        ok: false,
        error: `已登录账号绑定的手机号是 ${currentUser.phone}，请用该手机号下单`,
        field: "customerPhone",
      };
    }
  }

  // 自动金额：用户端没填 amount，用 SKU basePrice
  const basePrice = await getSkuBasePriceByCode(skuCode);
  if (basePrice === null) {
    return { ok: false, error: "服务 SKU 无效或已下架", field: "skuCode" };
  }

  // [任务 3] 4 级地址 — 派单匹配必用
  const province = String(formData.get("province") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const district = String(formData.get("district") ?? "").trim();
  const street = String(formData.get("street") ?? "").trim();
  const addressDetail = String(formData.get("addressDetail") ?? "").trim();
  // 旧 address 字段 = 4 级 + 详细拼接（保持展示冗余，不参与匹配）
  const fullAddress = [province, city, district, street, addressDetail]
    .filter(Boolean)
    .join("");

  const result = await createOrder({
    customerName: String(formData.get("customerName") ?? ""),
    customerPhone,
    address: fullAddress,
    skuCode,
    categoryCode: String(formData.get("categoryCode") ?? "") || undefined,
    amount: basePrice,
    scheduledAt: defaultScheduledAt(),
    remark: String(formData.get("remark") ?? "") || undefined,
    // [任务 3] 4 级地址字段
    province,
    city,
    district,
    street,
    addressDetail,
  });

  if (!result.ok) {
    return result;
  }

  // 写操作日志（失败不影响主流程）
  const customerName = String(formData.get("customerName") ?? "");
  await createActivityLog({
    action: "order_created",
    targetType: "order",
    targetId: result.orderId,
    message: `客户 ${customerName}（手机 ${customerPhone}）创建了订单 ${result.orderId}`,
    metadata: {
      skuCode,
      customerPhone,
      amount: basePrice,
    },
  });

  // 刷新后台订单列表和 dashboard，让后台立刻看到
  try {
    revalidatePath("/orders");
    revalidatePath("/");
  } catch {
    // 单测环境无 Next runtime
  }

  return { ok: true, orderId: result.orderId };
}

// ============================================================
// [任务 X] 支付下单闭环 — 客户/管理员触发「模拟支付成功」
// ============================================================

export type CustomerPayOrderResult = PayOrderResult;

/**
 * 客户/管理员触发「模拟支付成功」。
 *
 * 规则：
 * - customer 只能付自己手机号下的订单（user.phone === order.customerPhone）
 * - admin 可以代付（演示用，admin 是平台运维）
 * - worker 角色拒绝
 * - 调 src/lib/orders.ts:payOrder（事务 + 乐观锁）
 *
 * 成功 → 刷新订单详情页 + 列表 + 后台 /orders
 * 失败 → 返回结构化错误
 */
export async function customerPayOrderAction(
  formData: FormData,
): Promise<CustomerPayOrderResult> {
  // 鉴权：customer 或 admin
  const auth = await requireRole(["customer", "admin"]);
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  // [v0.5.0] 修 A5 思路：customer 只能付自己手机号下的订单
  // 加载订单校验 customer phone === session phone
  if (auth.user.role === "customer") {
    const { prisma } = await import("@/src/lib/db");
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerPhone: true },
    });
    if (!order) {
      return {
        ok: false,
        category: "validation",
        error: `订单 ${orderId} 不存在`,
      };
    }
    if (auth.user.phone && order.customerPhone !== auth.user.phone) {
      return {
        ok: false,
        category: "validation",
        error: "无权支付他人订单",
      };
    }
  }

  const result = await payOrder(orderId);
  if (!result.ok) {
    return result;
  }

  // 刷新相关页面
  try {
    revalidatePath("/customer/orders");
    revalidatePath(`/customer/orders/${orderId}`);
    revalidatePath("/orders"); // 后台订单列表（admin 派单视图）
  } catch {
    // 单测环境无 Next runtime
  }

  return { ok: true, orderId: result.orderId, paidAt: result.paidAt };
}
