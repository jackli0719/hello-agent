import { OrderActions } from "@/components/OrderActions";
import { StatusBadge, th, td, card, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { listOrdersForPage, type OrderListItem } from "@/src/lib/queries";
import { listEnabledServices } from "@/src/lib/repos/services";
import type { OrderStatus } from "@/src/types";
import Link from "next/link";

// 状态筛选 chip — 颜色一致
const FILTERS: { value: "all" | OrderStatus; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: ORDER_STATUS_LABEL.pending },
  { value: "assigned", label: ORDER_STATUS_LABEL.assigned },
  { value: "in_service", label: ORDER_STATUS_LABEL.in_service },
  { value: "completed", label: ORDER_STATUS_LABEL.completed },
  { value: "cancelled", label: ORDER_STATUS_LABEL.cancelled },
];

interface PageProps {
  searchParams: Promise<{
    keyword?: string;
    status?: string;
    skuCode?: string;
    created?: string;
    page?: string;
    pageSize?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: string;
  }>;
}

const PAGE_SIZE_OPTIONS = [2, 10, 20, 50];

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 构造 /orders 的 URL query —— 多个地方（状态 chip、表单、分页按钮）共用。
 * 空值不写入 URL。
 */
function buildOrdersUrl(params: {
  keyword?: string;
  status?: string;
  skuCode?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
  page?: string;
  pageSize?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.keyword) sp.set("keyword", params.keyword);
  if (params.skuCode) sp.set("skuCode", params.skuCode);
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  if (params.dateField && params.dateField !== "createdAt") sp.set("dateField", params.dateField);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.page && params.page !== "1") sp.set("page", params.page);
  // pageSize 总是写入（因为它改变会改变 page 总数；URL 必须显式）
  if (params.pageSize && params.pageSize !== "20") sp.set("pageSize", params.pageSize);
  const qs = sp.toString();
  return `/orders${qs ? `?${qs}` : ""}`;
}

export default async function OrdersPage({ searchParams }: PageProps) {
  const {
    keyword = "",
    status = "all",
    skuCode = "",
    created,
    page = "1",
    pageSize: pageSizeParam = "20",
    dateFrom = "",
    dateTo = "",
    dateField = "createdAt",
  } = await searchParams;
  // 非法 status 值 fallback 到 "all"，避免 ?status=invalid 时把所有订单过滤掉
  const validStatus = (FILTERS.some((f) => f.value === status) ? status : "all") as
    | "all"
    | OrderStatus;
  const statusFilter = validStatus;

  // 时间字段校验
  const validDateField = dateField === "scheduledAt" ? "scheduledAt" : "createdAt";
  // dateFrom / dateTo 转 Date（YYYY-MM-DD 解析为本地 0 点）
  const dateFromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined;
  const dateToDate = dateTo ? new Date(`${dateTo}T00:00:00`) : undefined;
  // 分页参数
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  // 非法 pageSize 落到 20（默认）
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSizeParam))
    ? Number(pageSizeParam)
    : 20;
  // 总计数 — 反映 SKU + 时间范围筛选（不含 keyword/status，因为后两者客户端过滤）
  const totalCountAll = await (async () => {
    const data = await listOrdersForPage({
      skuCode: skuCode || undefined,
      dateFrom: dateFromDate,
      dateTo: dateToDate,
      dateField: validDateField,
      page: 1,
      pageSize: 9999, // 拿全量
    });
    return data.totalCount;
  })();

  // SKU 选项 + 订单数据并行查（带分页 + 时间范围）
  const [allOrdersData, skuOptions] = await Promise.all([
    listOrdersForPage({
      skuCode: skuCode || undefined,
      dateFrom: dateFromDate,
      dateTo: dateToDate,
      dateField: validDateField,
      page: currentPage,
      pageSize,
    }),
    listEnabledServices(),
  ]);
  const { orders: allOrders, totalCount } = allOrdersData;

  // 客户端过滤（DB 端过滤在下一阶段做）
  const kw = keyword.trim().toLowerCase();
  const filtered = allOrders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (!kw) return true;
    return (
      o.id.toLowerCase().includes(kw) ||
      o.customerName.toLowerCase().includes(kw) ||
      o.customerPhone.toLowerCase().includes(kw) ||
      o.serviceName.toLowerCase().includes(kw) ||
      (o.technicianName?.toLowerCase().includes(kw) ?? false) ||
      o.address.toLowerCase().includes(kw)
    );
  });

  // 各状态计数（基于 skuCode 过滤后的全量）
  const counts = allOrders.reduce(
    (acc, o) => {
      acc.all++;
      acc[o.status]++;
      return acc;
    },
    { all: 0, pending: 0, assigned: 0, in_service: 0, completed: 0, cancelled: 0 } as Record<
      "all" | OrderStatus,
      number
    >,
  );

  // 当前是否筛选中（决定「重置」按钮显示）
  const isFiltering =
    !!keyword || statusFilter !== "all" || !!skuCode || !!dateFrom || !!dateTo || currentPage > 1;

  return (
    <>
      <main
        style={{
          padding: "24px 48px 48px",
          background: "#f7f8fa",
          minHeight: "calc(100vh - 56px)",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          color: "#111827",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>订单管理</h1>
          <Link
            href="/orders/new"
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            + 新建订单
          </Link>
        </div>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          共 {totalCountAll} 条订单（按 SKU+时间筛选） · 当前页 {filtered.length} 条 / 第 {currentPage} 页
        </p>

        {created ? (
          <div
            style={{
              padding: "10px 14px",
              background: "#dcfce7",
              color: "#15803d",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            ✓ 订单 <strong>{created}</strong> 创建成功，默认状态为「待派单」
          </div>
        ) : null}

        {/* 筛选器 */}
        <form
          method="get"
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            name="keyword"
            defaultValue={keyword}
            placeholder="搜索：订单号 / 客户 / 手机号 / 服务 / 师傅 / 地址"
            style={{
              flex: "1 1 240px",
              minWidth: 200,
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
            }}
          />
          <select
            name="skuCode"
            defaultValue={skuCode}
            style={{
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
              minWidth: 180,
            }}
          >
            <option value="">全部 SKU</option>
            {skuOptions.map((s) => (
              <option key={s.skuCode} value={s.skuCode}>
                {s.skuCode} · {s.name}
              </option>
            ))}
          </select>
          <select
            name="dateField"
            defaultValue={validDateField}
            style={{
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
              minWidth: 120,
            }}
          >
            <option value="createdAt">按创建时间</option>
            <option value="scheduledAt">按预约时间</option>
          </select>
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom}
            placeholder="开始"
            style={{
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
            }}
          />
          <span style={{ color: "#6b7280" }}>~</span>
          <input
            type="date"
            name="dateTo"
            defaultValue={dateTo}
            placeholder="结束"
            style={{
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
            }}
          />
          {/* 提交时重置 page=1 — 加一个 hidden input 让 buildOrdersUrl 不用重置页面逻辑 */}
          <input type="hidden" name="page" value="1" />
          <button
            type="submit"
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            搜索
          </button>
          {isFiltering ? (
            <Link
              href="/orders"
              style={{
                padding: "8px 14px",
                background: "#fff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              重置
            </Link>
          ) : null}
        </form>

        {/* 状态筛选 chips */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = statusFilter === f.value;
            // 保留 keyword + skuCode + 时间范围时切换 status，page 重置为 1
            const href = buildOrdersUrl({
              keyword,
              status: f.value,
              skuCode,
              dateFrom,
              dateTo,
              dateField: validDateField,
              page: "1",
            });
            return (
              <Link
                key={f.value}
                href={href}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  fontSize: 13,
                  textDecoration: "none",
                  background: active ? "#111827" : "#fff",
                  color: active ? "#fff" : "#374151",
                  border: active ? "1px solid #111827" : "1px solid #e5e7eb",
                }}
              >
                {f.label} <span style={{ opacity: 0.7 }}>({counts[f.value]})</span>
              </Link>
            );
          })}
        </div>

        {/* 表格 */}
        <section style={card}>
          {filtered.length === 0 ? (
            // 空状态分两种：
            // - 没筛选 + 全库没订单 → 新手引导（用 /customer 下个订单）
            // - 有筛选 → 当前筛选无结果
            totalCountAll === 0 && !isFiltering ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                }}
              >
                <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 12 }}>
                  数据库里还没有订单
                </div>
                <Link
                  href="/customer"
                  style={{
                    display: "inline-block",
                    padding: "8px 18px",
                    background: "#2563eb",
                    color: "#fff",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  去用户端下一个 →
                </Link>
                <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 12 }}>
                  也可以{" "}
                  <Link href="/dashboard" style={{ color: "#2563eb" }}>
                    先看演示链路指引
                  </Link>
                </div>
              </div>
            ) : (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}>
                暂无订单
              </div>
            )
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>订单号</th>
                  <th style={th}>客户 / 手机号</th>
                  <th style={th}>服务品类 / SKU</th>
                  <th style={th}>地址</th>
                  <th style={th}>金额</th>
                  <th style={th}>已分配师傅</th>
                  <th style={th}>状态</th>
                  <th style={th}>创建时间</th>
                  <th style={{ ...th, minWidth: 260 }}>推荐 / 命中规则</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id}>
                    <td style={td}>{o.id}</td>
                    <td style={td}>
                      <div>{o.customerName}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{o.customerPhone || "—"}</div>
                    </td>
                    <td style={td}>
                      <div>{o.serviceName}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>
                        {o.categoryName ?? "未分类"}
                      </div>
                    </td>
                    <td
                      style={{
                        ...td,
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.address}
                    </td>
                    <td style={td}>¥{o.amountYuan.toFixed(2)}</td>
                    <td style={td}>
                      {o.technicianName ?? <span style={{ color: "#9ca3af" }}>未派单</span>}
                    </td>
                    <td style={td}>
                      <StatusBadge label={ORDER_STATUS_LABEL[o.status]} tone={ORDER_TONE[o.status]} />
                    </td>
                    <td style={td}>{formatDateTime(o.createdAt)}</td>
                    <td style={td}>
                      <ActionCell order={o} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 分页 — 始终显示让用户感知有分页机制；总订单少时也显示「第 1 / 1 页」 */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 16, gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "#6b7280" }}>每页</label>
            <select
              name="pageSize"
              defaultValue={String(pageSize)}
              style={{
                padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 4,
                fontSize: 13, background: "#fff", outline: "none",
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: "#6b7280" }}>条</span>
            <Link
              href={buildOrdersUrl({
                keyword, status: statusFilter, skuCode, dateFrom, dateTo, dateField: validDateField,
                page: String(Math.max(1, currentPage - 1)),
                pageSize: String(pageSize),
              })}
              style={{
                padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13,
                color: currentPage === 1 ? "#d1d5db" : "#374151",
                background: "#fff", textDecoration: "none",
                pointerEvents: currentPage === 1 ? "none" : "auto",
              }}
            >
              上一页
            </Link>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              第 {currentPage} / {Math.max(1, Math.ceil(totalCountAll / pageSize))} 页
            </span>
            <Link
              href={buildOrdersUrl({
                keyword, status: statusFilter, skuCode, dateFrom, dateTo, dateField: validDateField,
                page: String(currentPage + 1),
                pageSize: String(pageSize),
              })}
              style={{
                padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13,
                color: currentPage >= Math.ceil(totalCountAll / pageSize) ? "#d1d5db" : "#374151",
                background: "#fff", textDecoration: "none",
                pointerEvents: currentPage >= Math.ceil(totalCountAll / pageSize) ? "none" : "auto",
              }}
            >
              下一页
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

// 推荐 / 派单结果展示单元格
function ActionCell({ order }: { order: OrderListItem }) {
  const { recommendation } = order;
  const rule = recommendation.rule;

  // pending 状态：派单按钮列表（候选可能为空，OrderActions 自己处理）
  // assigned / in_service / completed / cancelled：OrderActions 按 status 分发
  if (order.status !== "pending") {
    return (
      <OrderActions
        orderId={order.id}
        status={order.status}
        ruleName={null}
        candidates={[]}
      />
    );
  }

  // pending 但没命中规则：显示「人工指派」提示，不让 OrderActions 渲染按钮
  if (!rule) {
    return (
      <div style={{ fontSize: 12 }}>
        <div style={{ color: "#b91c1c" }}>{recommendation.reason}</div>
        <div style={{ color: "#6b7280", marginTop: 2 }}>暂无可派单师傅</div>
      </div>
    );
  }

  // pending 命中规则但没候选：理由 + 取消订单按钮
  if (recommendation.candidates.length === 0) {
    return (
      <div style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 4 }}>
          <span
            style={{
              display: "inline-block",
              padding: "1px 8px",
              background: "#eff6ff",
              color: "#1d4ed8",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            命中规则：{rule.name}
          </span>
        </div>
        <div style={{ color: "#b91c1c" }}>{recommendation.reason}</div>
        <div style={{ color: "#6b7280", marginTop: 2 }}>暂无可派单师傅</div>
        <div style={{ marginTop: 8 }}>
          <OrderActions
            orderId={order.id}
            status={order.status}
            ruleName={null}
            candidates={[]}
          />
        </div>
      </div>
    );
  }

  // pending + 有候选：派单按钮列表 + 取消订单按钮
  return (
    <OrderActions
      orderId={order.id}
      status={order.status}
      ruleName={rule.name}
      candidates={recommendation.candidates}
    />
  );
}