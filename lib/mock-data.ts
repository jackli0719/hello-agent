import type {
  Order,
  OrderStatus,
  Service,
  Technician,
  TechnicianStatus,
} from "./types";

// ============================================================
// lib/ 目录说明（重要）
// ============================================================
// 这是项目**演示期遗留**的目录 — 包含纯函数 + 类型 + mock 数据，
// 早期用来跑 demo（无 DB 时代）。
//
// 新业务代码请写到 src/lib/（src/lib/orders.ts / masters.ts / services.ts /
// queries.ts / repos/ / auth.ts / dispatch-rules.ts / worker.ts / customer.ts），
// import 路径用 `@/src/lib/xxx`。
//
// 这个文件保留是因为 pages/components 大量 import 了 `lib/mock-data` 里的常量
//（ORDER_STATUS_LABEL 等），重命名 / 搬迁是大改动，本期 MVP 不做。
// ============================================================

// 中文标签：避免页面里到处散落映射，集中在这里好维护。

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "待派单",
  assigned: "已派单",
  in_service: "服务中",
  completed: "已完成",
  cancelled: "已取消",
};

export const TECHNICIAN_STATUS_LABEL: Record<TechnicianStatus, string> = {
  available: "空闲",
  busy: "服务中",
  offline: "离线",
};

// ---------- 订单 ----------
// MVP 演示期数据，DB 已上线后这里只作为 seed 来源。
export const MOCK_ORDERS: Order[] = [
  {
    id: "O20260624001",
    customerName: "陈晓明",
    customerPhone: "13900000001",
    serviceName: "深度保洁 3 小时",
    technicianName: "李师傅",
    address: "上海市浦东新区世纪大道 100 号",
    scheduledAt: "2026-06-24T10:00:00+08:00",
    amount: 268,
    status: "in_service",
  },
  {
    id: "O20260624002",
    customerName: "王芳",
    customerPhone: "13900000002",
    serviceName: "空调清洗（挂机）",
    technicianName: null,
    address: "上海市徐汇区漕溪北路 88 号",
    scheduledAt: "2026-06-24T14:00:00+08:00",
    amount: 128,
    status: "pending",
  },
  {
    id: "O20260624003",
    customerName: "刘建国",
    customerPhone: "13900000003",
    serviceName: "水管维修",
    technicianName: "赵师傅",
    address: "上海市闵行区莘庄镇 1234 弄",
    scheduledAt: "2026-06-24T16:30:00+08:00",
    amount: 180,
    status: "assigned",
  },
  {
    id: "O20260623007",
    customerName: "Sarah Liu",
    customerPhone: "13900000007",
    serviceName: "月嫂服务（住家）",
    technicianName: "周姐",
    address: "上海市长宁区中山公园路 12 号",
    scheduledAt: "2026-06-23T09:00:00+08:00",
    amount: 12800,
    status: "completed",
  },
  {
    id: "O20260623005",
    customerName: "赵敏",
    customerPhone: "13900000005",
    serviceName: "家电维修",
    technicianName: null,
    address: "上海市黄浦区南京东路 200 号",
    scheduledAt: "2026-06-23T11:00:00+08:00",
    amount: 0,
    status: "cancelled",
  },
  {
    id: "O20260625009",
    customerName: "林晓梅",
    customerPhone: "13900000009",
    serviceName: "日常保洁 2 小时",
    technicianName: null,
    address: "上海市虹口区四川北路 1888 号",
    scheduledAt: "2026-06-25T09:00:00+08:00",
    amount: 158,
    status: "pending",
  },
];

// ---------- 师傅 ----------
export const MOCK_TECHNICIANS: Technician[] = [
  {
    id: "T001",
    name: "李师傅",
    phone: "138****1234",
    skills: ["保洁", "家电清洗"],
    rating: 4.9,
    completedJobs: 326,
    status: "available",
    serviceArea: "上海",
  },
  {
    id: "T002",
    name: "赵师傅",
    phone: "139****5678",
    skills: ["水电维修", "管道疏通"],
    rating: 4.8,
    completedJobs: 412,
    status: "busy",
    serviceArea: "上海, 苏州",
  },
  {
    id: "T003",
    name: "周姐",
    phone: "137****9012",
    skills: ["月嫂", "育儿嫂"],
    rating: 5.0,
    completedJobs: 89,
    status: "busy",
    serviceArea: "上海",
  },
  {
    id: "T004",
    name: "孙师傅",
    phone: "136****3456",
    skills: ["空调维修", "家电维修"],
    rating: 4.6,
    completedJobs: 207,
    status: "available",
    serviceArea: "上海, 北京",
  },
  {
    id: "T005",
    name: "吴师傅",
    phone: "135****7890",
    skills: ["开锁", "管道疏通"],
    rating: 4.7,
    completedJobs: 153,
    status: "offline",
    serviceArea: "上海",
  },
];

// ---------- 服务项目 ----------
// requiredSkills 是数组：派单规则要求师傅 skills 覆盖（superset）requiredSkills
export const MOCK_SERVICES: Service[] = [
  {
    id: "S001",
    skuCode: "CLEAN-DAILY-2H",
    categoryCode: "CLEAN",
    name: "日常保洁 2 小时",
    category: "家政",
    basePrice: 158,
    durationMinutes: 120,
    requiredSkills: ["保洁"],
    enabled: true,
  },
  {
    id: "S002",
    skuCode: "CLEAN-DEEP-3H",
    categoryCode: "CLEAN",
    name: "深度保洁 3 小时",
    category: "家政",
    basePrice: 268,
    durationMinutes: 180,
    requiredSkills: ["保洁"],
    enabled: true,
  },
  {
    id: "S003",
    skuCode: "APPLIANCE-AC-WALL",
    categoryCode: "APPLIANCE",
    name: "空调清洗（挂机）",
    category: "家电清洗",
    basePrice: 128,
    durationMinutes: 60,
    requiredSkills: ["空调维修"],
    enabled: true,
  },
  {
    id: "S004",
    skuCode: "APPLIANCE-AC-CABINET",
    categoryCode: "APPLIANCE",
    name: "空调清洗（柜机）",
    category: "家电清洗",
    basePrice: 168,
    durationMinutes: 90,
    requiredSkills: ["空调维修"],
    enabled: true,
  },
  {
    id: "S005",
    skuCode: "REPAIR-PIPE",
    categoryCode: "REPAIR",
    name: "水管维修",
    category: "维修",
    basePrice: 80,
    durationMinutes: 60,
    requiredSkills: ["水电维修"],
    enabled: true,
  },
  {
    id: "S006",
    skuCode: "MATERNITY-MONTH",
    categoryCode: "MATERNITY",
    name: "月嫂服务（住家）",
    category: "母婴",
    basePrice: 12800,
    durationMinutes: 720 * 30,
    requiredSkills: ["月嫂"],
    enabled: true,
  },
  {
    id: "S007",
    skuCode: "EMERGENCY-LOCK",
    categoryCode: "EMERGENCY",
    name: "开锁换锁",
    category: "应急",
    basePrice: 199,
    durationMinutes: 30,
    requiredSkills: [],
    enabled: false,
  },
  {
    id: "S008",
    skuCode: "REPAIR-APPLIANCE",
    categoryCode: "REPAIR",
    name: "家电维修",
    category: "维修",
    basePrice: 100,
    durationMinutes: 60,
    requiredSkills: ["家电维修"],
    enabled: true,
  },
];
