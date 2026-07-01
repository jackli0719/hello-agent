// O2O 上门服务管理后台 — 领域类型
// 这一份和 lib/types.ts 当前内容完全一致，作为「前端展示层类型」的稳定来源。
// 数据库 schema 在 prisma/schema.prisma，是数据来源真相。
// 当 Prisma 接入页面时，两边需要保持同步：业务字段（status / 枚举含义）以本文件为准，
// 字段精度（如金额用分 vs 元）以 schema 为准。

export type OrderStatus =
  | "pending" // 待派单
  | "assigned" // 已派单
  | "in_service" // 服务中
  | "completed" // 已完成
  | "cancelled"; // 已取消

export type TechnicianStatus = "available" | "busy" | "offline";

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  technicianName: string | null;
  address: string;
  scheduledAt: string; // ISO 时间字符串
  amount: number; // 单位：元（页面展示用，DB 存的是分）
  status: OrderStatus;
}

export interface Technician {
  id: string;
  name: string;
  phone: string;
  skills: string[];
  rating: number;
  completedJobs: number;
  status: TechnicianStatus;
  serviceArea: string;
  merchantId?: string;
  merchantName?: string;
}

export interface Service {
  id: string;
  skuCode: string;
  categoryCode: string;
  name: string;
  category: string;
  basePrice: number;
  durationMinutes: number;
  requiredSkills: string[];
  enabled: boolean;
}
