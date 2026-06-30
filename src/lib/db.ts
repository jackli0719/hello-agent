// Prisma Client 单例。
//
// Next.js dev 模式下模块会被反复热重载，每次 new PrismaClient() 都会开新连接，
// 不一会儿内存就炸了。用 globalThis 缓存一个实例，dev/prod 都安全。

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn", "query"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
