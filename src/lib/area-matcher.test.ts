// [任务 4-0] 区域匹配纯函数单测
//
// 覆盖：
// 1. defaultAreaMatcher.distanceCheck 任何输入都返 true（演示期行为）
// 2. distanceCheck 对空地址也返 true（兼容旧订单 4 级填空）

import { describe, expect, it } from "vitest";
import {
  defaultAreaMatcher,
  type OrderArea,
  type MasterArea,
} from "./area-matcher";

describe("defaultAreaMatcher", () => {
  // # spec: 演示期 distanceCheck 永远通过 — 不管订单/师傅地址如何组合
  it("distanceCheck 永远返 true（演示期行为）", () => {
    const orderArea: OrderArea = {
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      street: "粤海街道",
    };
    const masterArea: MasterArea = {
      masterId: "T001",
      merchantId: "M001",
    };
    expect(defaultAreaMatcher.distanceCheck(orderArea, masterArea)).toBe(true);
  });

  // # spec: distanceCheck 对空地址也返 true（兼容旧订单 4 级填空）
  it("distanceCheck 对空地址也返 true（兼容旧订单 fallback）", () => {
    const emptyOrder: OrderArea = {
      province: "",
      city: "",
      district: "",
      street: "",
    };
    const masterArea: MasterArea = {
      masterId: "T-LEGACY",
      merchantId: "M-LEGACY",
    };
    expect(defaultAreaMatcher.distanceCheck(emptyOrder, masterArea)).toBe(true);
  });
});
