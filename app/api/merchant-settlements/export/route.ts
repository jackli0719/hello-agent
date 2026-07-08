import { NextRequest, NextResponse } from "next/server";
import { ensureCsrfCookie } from "@/src/lib/csrf";
import { getCurrentUser } from "@/src/lib/auth";
import { createActivityLog } from "@/src/lib/activity-log";
import {
  buildAllSettlementsCsv,
  buildOneSettlementCsv,
  makeSettlementCsvFilename,
} from "@/src/lib/merchant-settlement-csv";

// GET /api/merchant-settlements/export?scope=all|one&id=...
// - scope=all: 所有 confirmed/archived 的 SettlementPreview
// - scope=one&id=xxx: 单条 (merchant, period)
export async function GET(req: NextRequest) {
  // 鉴权：admin
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return new NextResponse("forbidden", { status: 403 });
  }
  // ensure CSRF cookie 也生成（同其他 GET admin 页面）
  await ensureCsrfCookie();

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const id = url.searchParams.get("id");

  let csv: string;
  let filename: string;
  let targetId: string;
  let logMessage: string;

  if (scope === "one" && id) {
    csv = await buildOneSettlementCsv(id);
    filename = makeSettlementCsvFilename(`settlement-${id}`);
    targetId = id;
    logMessage = `导出单条结算 CSV：${filename}`;
  } else {
    csv = await buildAllSettlementsCsv();
    filename = makeSettlementCsvFilename("settlements-all");
    targetId = "batch";
    logMessage = `导出全部已确认/已归档结算 CSV：${filename}`;
  }

  try {
    await createActivityLog({
      action: "merchant_settlement_csv_exported",
      targetType: "merchantSettlement",
      targetId,
      message: logMessage,
      metadata: { filename, scope, id: id ?? null },
    });
  } catch {
    // 写日志失败不阻塞
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
