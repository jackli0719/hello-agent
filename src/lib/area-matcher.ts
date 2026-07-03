// [任务 4-0] 区域匹配纯函数 — 地图 API 预留位
//
// 业务背景（任务 4-0）：
// - 4 级地址精确匹配已在 lib/dispatch.ts:filterMastersByArea 完成（任务 3）
// - 本文件抽「距离/经纬度」校验为纯函数，给派单过滤链末尾调用
// - 演示期：distanceCheck 永远 return true（不挡人）
// - 后续接腾讯/高德经纬度 API 时：只改 defaultAreaMatcher.distanceCheck 函数体
//
// # MVP: 不接真实地图 API；不查 Master.serviceArea 字段（决策 2 锁定）
// # MVP: Order 暂不加 lat/lng 字段；后续接 API 时再加（KNOWN_ISSUES #11）
//
// 调用方：lib/dispatch.ts:filterMastersByArea（步骤 2 接入）

/** 订单的 4 级地址 + 预留经纬度 */
export interface OrderArea {
  province: string;
  city: string;
  district: string;
  street: string;
  // 后续接地图 API 时启用：
  // lat?: number;
  // lng?: number;
}

/** 师傅位置信息（演示期从 Master.merchantId 间接推；后续可加 master 自身经纬度） */
export interface MasterArea {
  masterId: string;
  /** 师傅归属商家 ID — 演示期用商家覆盖区域代表师傅服务范围 */
  merchantId: string;
  // 后续接地图 API 时启用：
  // lat?: number;
  // lng?: number;
}

/**
 * 区域匹配器接口
 *
 * 设计意图：
 * - 演示期默认实现永远返 true（接口位预留，不挡人）
 * - 后续接经纬度 API 时实现自己的 AreaMatcher，注入 recommendMastersForOrder
 * - 调用方不感知实现细节 → 替换实现零改动调用点
 */
export interface AreaMatcher {
  /**
   * 检查订单区域 vs 师傅服务范围是否在可派单距离内
   * @returns true = 可派；false = 距离超出
   */
  distanceCheck(orderArea: OrderArea, masterArea: MasterArea): boolean;
}

/**
 * 默认实现：永远返 true
 *
 * 演示期不接真实地图 API，所有订单都过距离校验。
 * 真实业务场景下应替换为调腾讯/高德 API 算经纬度距离。
 */
export const defaultAreaMatcher: AreaMatcher = {
  distanceCheck: () => true,
};
