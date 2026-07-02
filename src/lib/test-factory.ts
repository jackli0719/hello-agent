import { createOrder, type CreateOrderInput } from "@/src/lib/orders";
import { prisma } from "@/src/lib/db";

let phoneSeq = 1;

function nextPhone(): string {
  const n = String(phoneSeq++).padStart(8, "0");
  return `139${n}`;
}

export function makeTestOrderInput(
  overrides: Partial<CreateOrderInput> = {},
): CreateOrderInput {
  return {
    customerName: "_test_customer",
    customerPhone: nextPhone(),
    address: "广东省深圳市南山区粤海街道科技园 1 号楼",
    // [任务 3] 4 级地址
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    street: "粤海街道",
    addressDetail: "科技园 1 号楼",
    skuCode: "CLEAN-DAILY-2H",
    categoryCode: "CLEAN",
    amount: 158,
    scheduledAt: new Date("2026-06-26T10:00:00"),
    ...overrides,
  };
}

export async function createTestOrder(
  overrides: Partial<CreateOrderInput> = {},
): Promise<string> {
  const result = await createOrder(makeTestOrderInput(overrides));
  if (!result.ok) {
    throw new Error(`createTestOrder failed: ${result.error}`);
  }
  return result.orderId;
}

export async function cleanupTestOrders(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
}
