// [任务 11] 商家结算 CSV 导出
//
// 设计要点：
// - UTF-8 with BOM（Excel 中文不乱码）
// - 逗号分隔（CSV 标准）
// - 只导出 status in (confirmed, archived) 的 SettlementPreview（不包含 pending）
// - 字段：orderId / 商家 / 期间 / 客户 / 服务 / 师傅 / 策略 / 订单金额 / 三方分成 / 状态 / 生成时间

import { prisma } from "@/src/lib/db";

export const SETTLEMENT_CSV_HEADERS = [
  "订单ID",
  "商家ID",
  "商家名称",
  "期间",
  "结算状态",
  "客户姓名",
  "服务名称",
  "师傅ID",
  "师傅姓名",
  "策略名",
  "策略类型",
  "订单金额(元)",
  "平台分成(元)",
  "商家分成(元)",
  "师傅分成(元)",
  "生成时间",
] as const;

type PreviewWithSettlement = Awaited<
  ReturnType<typeof loadAllExportablePreviews>
>[number];

/** 加载所有可导出的 SettlementPreview（confirmed/archived 的全部 merchant × period） */
async function loadAllExportablePreviews() {
  // 1. 找所有 confirmed/archived 的 settlement
  const settlements = await prisma.merchantSettlement.findMany({
    where: { status: { in: ["confirmed", "archived"] } },
    select: {
      id: true,
      merchantId: true,
      period: true,
      status: true,
      merchant: { select: { name: true } },
    },
  });
  if (settlements.length === 0) return [];

  // 2. 按 (merchantId, period) 找 previews — SettlementPreview 没 period 字段
  //    改成：按 merchantId 过滤（一个 period 一个 merchant 通常一个 preview）
  const merchantIds = Array.from(new Set(settlements.map((s) => s.merchantId)));
  const previews = await prisma.settlementPreview.findMany({
    where: { merchantId: { in: merchantIds } },
    include: {
      order: { select: { id: true, customerName: true, serviceName: true } },
      master: { select: { id: true, name: true } },
      strategy: { select: { id: true, name: true, strategyType: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  // 3. join preview + settlement — 用 createdAt 月份匹配 period
  //    preview.merchant 字段不存在 — 用 settlements 查的 merchant.name 映射
  const merchantNameByMerchantId = new Map<string, string>();
  for (const s of settlements) {
    merchantNameByMerchantId.set(s.merchantId, s.merchant.name);
  }
  return previews.map((p) => {
    const period = formatPeriod(p.createdAt);
    const settlement = settlements.find(
      (s) => s.merchantId === p.merchantId && s.period === period,
    );
    return {
      ...p,
      period,
      settlementStatus: settlement?.status ?? "(无对应 settlement)",
      _merchantName: merchantNameByMerchantId.get(p.merchantId) ?? "",
    };
  });
}

/** 加载单个 (merchant, period) 已确认/已归档 settlement 的 previews（用于详情页导出本条） */
async function loadOnePeriodPreviews(settlementId: string) {
  const s = await prisma.merchantSettlement.findUnique({
    where: { id: settlementId },
    select: {
      id: true,
      merchantId: true,
      period: true,
      status: true,
      merchant: { select: { name: true } },
    },
  });
  if (!s) return [];
  if (s.status === "pending") return []; // 不导 pending

  const previews = await prisma.settlementPreview.findMany({
    where: { merchantId: s.merchantId },
    include: {
      order: { select: { id: true, customerName: true, serviceName: true } },
      master: { select: { id: true, name: true } },
      strategy: { select: { id: true, name: true, strategyType: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  // 过滤：只保留匹配 period 的 preview
  return previews
    .filter((p) => formatPeriod(p.createdAt) === s.period)
    .map((p) => ({
      ...p,
      period: s.period,
      settlementStatus: s.status,
      _merchantName: s.merchant.name,
    }));
}

/** 格式化 Date 为 "YYYY-MM" */
function formatPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** CSV 字段转义 — 含 , " \n 时用双引号包，内部 " 转 "" */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function rowToCsv(p: PreviewWithSettlement): string {
  const cells = [
    p.order.id,
    p.merchantId,
    (p as PreviewWithSettlement & { _merchantName?: string })._merchantName ??
      "",
    p.period,
    p.settlementStatus,
    p.order.customerName,
    p.order.serviceName,
    p.masterId,
    p.master?.name ?? "",
    p.strategy?.name ?? "(无策略)",
    p.strategy?.strategyType ?? "",
    formatYuan(p.orderAmount),
    formatYuan(p.platformAmount),
    formatYuan(p.merchantAmount),
    formatYuan(p.workerAmount),
    formatDate(p.createdAt),
  ];
  return cells.map((c) => csvEscape(String(c))).join(",");
}

export const SETTLEMENT_CSV_BOM = "﻿";

/** 生成"所有" CSV（含 BOM） */
export async function buildAllSettlementsCsv(): Promise<string> {
  const previews = await loadAllExportablePreviews();
  const lines = [SETTLEMENT_CSV_HEADERS.join(",")];
  for (const p of previews) {
    lines.push(rowToCsv(p));
  }
  return SETTLEMENT_CSV_BOM + lines.join("\n");
}

/** 生成"本条" CSV（含 BOM） */
export async function buildOneSettlementCsv(
  settlementId: string,
): Promise<string> {
  const previews = await loadOnePeriodPreviews(settlementId);
  const lines = [SETTLEMENT_CSV_HEADERS.join(",")];
  for (const p of previews) {
    lines.push(rowToCsv(p));
  }
  return SETTLEMENT_CSV_BOM + lines.join("\n");
}

/** 文件名生成 — 含时间戳，避免缓存 */
export function makeSettlementCsvFilename(prefix: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${ts}.csv`;
}
