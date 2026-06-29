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

import { revalidatePath } from "next/cache";
import { createOrder, type CreateOrderResult } from "@/src/lib/orders";
import { getSkuBasePriceByCode } from "@/src/lib/customer";
import { createActivityLog } from "@/src/lib/activity-log";

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

  // 自动金额：用户端没填 amount，用 SKU basePrice
  const basePrice = await getSkuBasePriceByCode(skuCode);
  if (basePrice === null) {
    return { ok: false, error: "服务 SKU 无效或已下架", field: "skuCode" };
  }

  const result = await createOrder({
    customerName: String(formData.get("customerName") ?? ""),
    customerPhone,
    address: String(formData.get("address") ?? ""),
    skuCode,
    categoryCode: String(formData.get("categoryCode") ?? "") || undefined,
    amount: basePrice,
    scheduledAt: defaultScheduledAt(),
    remark: String(formData.get("remark") ?? "") || undefined,
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
