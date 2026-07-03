// [任务 15] Sidebar 路径匹配回归测试
//
// 覆盖：所有 admin 路径命中正确的 group + 正确的 item active
// 这是 P0 风险（改 AppNav 后子项 ✓ 不出现 → 用户不知道在哪）。
//
// 不引入 @testing-library/react（避免 jsdom 依赖）——
// 只测纯函数（detectActiveGroup / isItemActive）。
//
// 注意：lint-spec-tags 不解析 for 循环里的 it(label)，所以展开为独立 it()。

import { describe, it, expect } from "vitest";
import {
  SIDEBAR_GROUPS,
  detectActiveGroup,
  isItemActive,
} from "@/components/Sidebar";

describe("Sidebar — detectActiveGroup", () => {
  // 业务运营
  // # spec: /orders 归属「业务运营」组
  it("/orders → 业务运营", () => {
    expect(detectActiveGroup("/orders")).toBe("operations");
  });
  // # spec: 深链 /orders/new 也归属「业务运营」组（startWith 行为）
  it("/orders/new → 业务运营（深链）", () => {
    expect(detectActiveGroup("/orders/new")).toBe("operations");
  });
  // # spec: /services 归属「业务运营」组
  it("/services → 业务运营", () => {
    expect(detectActiveGroup("/services")).toBe("operations");
  });
  // # spec: 深链 /services/categories/new 也归属「业务运营」组
  it("深链 services → 业务运营", () => {
    expect(detectActiveGroup("/services/categories/new")).toBe("operations");
  });
  // # spec: /masters 归属「业务运营」组
  it("/masters → 业务运营", () => {
    expect(detectActiveGroup("/masters")).toBe("operations");
  });
  // # spec: 深链 /masters/abc/edit 也归属「业务运营」组
  it("/masters/:id/edit → 业务运营", () => {
    expect(detectActiveGroup("/masters/abc/edit")).toBe("operations");
  });
  // # spec: /dispatch-rules 归属「业务运营」组
  it("/dispatch-rules → 业务运营", () => {
    expect(detectActiveGroup("/dispatch-rules")).toBe("operations");
  });
  // # spec: 深链 /dispatch-rules/abc/edit 也归属「业务运营」组
  it("深链 dispatch-rules → 业务运营", () => {
    expect(detectActiveGroup("/dispatch-rules/abc/edit")).toBe("operations");
  });
  // # spec: /platform-areas 归属「业务运营」组
  it("/platform-areas → 业务运营", () => {
    expect(detectActiveGroup("/platform-areas")).toBe("operations");
  });

  // 商家
  // # spec: /merchants 归属「商家」组
  it("/merchants → 商家", () => {
    expect(detectActiveGroup("/merchants")).toBe("merchant");
  });
  // # spec: 深链 /merchants/abc/edit 也归属「商家」组
  it("/merchants/:id/edit → 商家", () => {
    expect(detectActiveGroup("/merchants/abc/edit")).toBe("merchant");
  });
  // # spec: /commission-strategies 归属「商家」组
  it("/commission-strategies → 商家", () => {
    expect(detectActiveGroup("/commission-strategies")).toBe("merchant");
  });
  // # spec: 深链 /commission-strategies/abc/edit 也归属「商家」组
  it("深链 commission-strategies → 商家", () => {
    expect(detectActiveGroup("/commission-strategies/abc/edit")).toBe(
      "merchant",
    );
  });

  // 财务
  // # spec: /settlements 归属「财务」组
  it("/settlements → 财务", () => {
    expect(detectActiveGroup("/settlements")).toBe("finance");
  });
  // # spec: /merchant-settlements 归属「财务」组（不是「商家」组！）
  it("/merchant-settlements → 财务", () => {
    expect(detectActiveGroup("/merchant-settlements")).toBe("finance");
  });
  // # spec: 深链 /merchant-settlements/abc 也归属「财务」组
  it("深链 merchant-settlements → 财务", () => {
    expect(detectActiveGroup("/merchant-settlements/abc")).toBe("finance");
  });
  // # spec: /payout-records 归属「财务」组
  it("/payout-records → 财务", () => {
    expect(detectActiveGroup("/payout-records")).toBe("finance");
  });
  // # spec: /withdraw-requests 归属「财务」组
  it("/withdraw-requests → 财务", () => {
    expect(detectActiveGroup("/withdraw-requests")).toBe("finance");
  });
  // # spec: /finance-ledgers 归属「财务」组
  it("/finance-ledgers → 财务", () => {
    expect(detectActiveGroup("/finance-ledgers")).toBe("finance");
  });
  // # spec: /worker-settlements 归属「财务」组
  it("/worker-settlements → 财务", () => {
    expect(detectActiveGroup("/worker-settlements")).toBe("finance");
  });

  // 系统
  // # spec: /admin/metrics 归属「系统」组（特殊前缀，因为 metrics 在 admin 路径下）
  it("/admin/metrics → 系统", () => {
    expect(detectActiveGroup("/admin/metrics")).toBe("system");
  });
  // # spec: /activity-logs 归属「系统」组
  it("/activity-logs → 系统", () => {
    expect(detectActiveGroup("/activity-logs")).toBe("system");
  });

  // 边界
  // # spec: /dashboard 不在任何 group（顶部独立入口）
  it("/dashboard 不在任何 group（顶部独立入口）", () => {
    expect(detectActiveGroup("/dashboard")).toBeUndefined();
  });
  // # spec: / 根路径不命中（root landing 不会进 admin 路径分支）
  it("/ 根路径不命中（root landing 不会进 admin 路径分支）", () => {
    expect(detectActiveGroup("/")).toBeUndefined();
  });
});

describe("Sidebar — isItemActive", () => {
  // # spec: 完全匹配（pathname === href）
  it("完全匹配", () => {
    expect(isItemActive("/orders", "/orders")).toBe(true);
  });
  // # spec: worker-settlements 完全匹配
  it("worker-settlements 完全匹配", () => {
    expect(isItemActive("/worker-settlements", "/worker-settlements")).toBe(
      true,
    );
  });
  // # spec: 深链 startsWith 命中（pathname startsWith href + "/"）
  it("深链 startsWith", () => {
    expect(isItemActive("/orders/abc/edit", "/orders")).toBe(true);
  });
  // # spec: metrics 完全匹配
  it("metrics 完全匹配", () => {
    expect(isItemActive("/admin/metrics", "/admin/metrics")).toBe(true);
  });
  // # spec: /admin 前缀匹配 metrics（admin 子路径全部归属 metrics）
  it("/admin 前缀匹配 metrics", () => {
    expect(isItemActive("/admin", "/admin/metrics")).toBe(true);
  });
  // # spec: 财务流水页完全匹配
  it("流水页", () => {
    expect(isItemActive("/finance-ledgers", "/finance-ledgers")).toBe(true);
  });
  // # spec: 深链 流水页
  it("深链 流水页", () => {
    expect(isItemActive("/finance-ledgers/abc", "/finance-ledgers")).toBe(true);
  });
  // # spec: 前缀 ≠ 全词（/withdraw 不会误命中 /withdraw-requests）
  it("前缀 ≠ 全词（避免误命中）", () => {
    expect(isItemActive("/withdraw-requests", "/withdraw")).toBe(false);
  });
  // # spec: settlements 不被 /settle 匹配
  it("settlements 不被 /settle 匹配", () => {
    expect(isItemActive("/settlements", "/settle")).toBe(false);
  });
  // # spec: 完全不相关的两个路径
  it("不相关", () => {
    expect(isItemActive("/dashboard", "/orders")).toBe(false);
  });
  // # spec: 关键回归——/merchant-settlements 绝不能被 /merchants 命中
  it("/merchant-settlements 不被 /merchants 命中（startsWith bug 回归）", () => {
    expect(isItemActive("/merchant-settlements", "/merchants")).toBe(false);
  });
});

describe("Sidebar — SIDEBAR_GROUPS 完整性", () => {
  const allHrefs = SIDEBAR_GROUPS.flatMap((g) => g.items.map((it) => it.href));

  // # spec: 共 15 个 sidebar 入口（dashboard 不在 group 内）
  it("覆盖所有 sidebar 入口（共 15 个；dashboard 在顶部独立入口）", () => {
    expect(allHrefs.length).toBe(15);
  });
  // # spec: group key 唯一性（防配置错误导致 React key 冲突）
  it("每个 group key 唯一", () => {
    const keys = SIDEBAR_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  // # spec: item href 唯一性（防同一页面在 sidebar 出现两次）
  it("每个 item href 唯一", () => {
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
  });
  // # spec: 所有 href 必须以 / 开头（绝对路径，避免 Next.js 路由解析异常）
  it("每个 item href 以 / 开头", () => {
    for (const href of allHrefs) {
      expect(href.startsWith("/")).toBe(true);
    }
  });
  // # spec: 业务运营组 5 项固定（订单 / 服务 / 师傅 / 派单规则 / 平台合作区域）
  it("业务运营组包含 5 项", () => {
    const ops = SIDEBAR_GROUPS.find((g) => g.key === "operations");
    expect(ops?.items.length).toBe(5);
  });
  // # spec: 商家组 2 项固定（商家管理 / 分成策略）
  it("商家组包含 2 项", () => {
    const m = SIDEBAR_GROUPS.find((g) => g.key === "merchant");
    expect(m?.items.length).toBe(2);
  });
  // # spec: 财务组 6 项固定（结算预览 / 商家结算汇总 / 师傅结算汇总 / 打款记录 / 提现申请 / 财务流水）
  it("财务组包含 6 项", () => {
    const f = SIDEBAR_GROUPS.find((g) => g.key === "finance");
    expect(f?.items.length).toBe(6);
  });
  // # spec: 财务组含 worker-settlements
  it("财务组含 worker-settlements", () => {
    const f = SIDEBAR_GROUPS.find((g) => g.key === "finance");
    const has = f?.items.some((it) => it.href === "/worker-settlements");
    expect(has).toBe(true);
  });
  // # spec: 系统组 2 项固定（业务指标 / 操作日志）
  it("系统组包含 2 项", () => {
    const s = SIDEBAR_GROUPS.find((g) => g.key === "system");
    expect(s?.items.length).toBe(2);
  });
});

describe("Sidebar — AppNav 路径过滤一致性", () => {
  // # spec: AppNav 对 /worker 路径 return null，sidebar 不会渲染
  it("worker 路径不在 group 中", () => {
    expect(detectActiveGroup("/worker/orders")).toBeUndefined();
    expect(detectActiveGroup("/worker/dashboard")).toBeUndefined();
  });
  // # spec: AppNav 对 /customer 路径 return null，sidebar 不会渲染
  it("customer 路径不在 group 中", () => {
    expect(detectActiveGroup("/customer")).toBeUndefined();
    expect(detectActiveGroup("/customer/orders")).toBeUndefined();
  });
});
