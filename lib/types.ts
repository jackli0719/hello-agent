// O2O 上门服务管理后台 — 领域类型
// MVP 阶段只用最小的内存数据结构，后续接入数据库时再扩展。

export type OrderStatus =
  | "pending"    // 待派单
  | "assigned"   // 已派单
  | "in_service" // 服务中
  | "completed"  // 已完成
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
  amount: number;      // 单位：元
  status: OrderStatus;
}

export interface Technician {
  id: string;
  name: string;
  phone: string;
  skills: string[];       // 掌握的技能标签
  rating: number;         // 0~5
  completedJobs: number;  // 累计完成单数
  status: TechnicianStatus;
  serviceArea: string;
}

export interface Service {
  id: string;
  skuCode: string;
  categoryCode: string;
  name: string;
  category: string;
  basePrice: number; // 单位：元
  durationMinutes: number;
  requiredSkills: string[]; // 派单需要的技能；空数组 = 不参与自动派单
  enabled: boolean;
}