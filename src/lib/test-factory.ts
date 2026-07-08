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
    address: "_test_address",
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
