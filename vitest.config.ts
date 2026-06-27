import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    // 单测运行不依赖 Next runtime；revalidate / cookies 等 Next API 在 server action
    // 测试里走 try/catch 或被 mock，这里不强制设置 environment
    // 文件间串行 — 共享 SQLite dev.db，并行会互相污染订单状态
    fileParallelism: false,
  },
});