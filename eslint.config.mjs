// ESLint v9 flat config
// 用 Next.js 16 内置的 ESLint preset（next/core-web-vitals + next/typescript）
// 不引入额外插件，避免 plugin not found 错误

import nextPlugin from "eslint-config-next";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "prisma/dev.db",
      "next-env.d.ts",
      "*.tsbuildinfo",
      // Mock data 是演示期遗留
      "lib/**",
    ],
  },
  ...nextPlugin,
];