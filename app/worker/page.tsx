// 师傅端 H5 — /worker
//
// MVP 范围（按需求）：
// 1. 顶部「选择师傅」下拉框
// 2. 选择师傅后展示该师傅被分配的订单（卡片）
// 3. assigned → 「开始服务」按钮
// 4. in_service → 「完成订单」按钮
// 5. completed / cancelled 只展示
// 6. 无订单 → 「暂无分配订单」
// 7. mobile 友好（卡片 + 大按钮）
//
// 设计：
// - 极简导航（不含后台链接 + 退出按钮）— 由 AppNav 检测 /worker 不渲染实现
// - 这里只渲染页面主体 + 极简顶部
// - 操作按钮是 client component（包 server action）— 用 useTransition 给反馈
// - 不做真实登录（按需求 #1）

import { redirect } from "next/navigation";
import Link from "next/link";
import { listWorkerOptions, listOrdersForMaster } from "@/src/lib/worker";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";
import { WorkerOrderActions } from "./WorkerOrderActions";

interface PageProps {
  searchParams: Promise<{
    masterId?: string;
  }>;
}

export default async function WorkerPage({ searchParams }: PageProps) {
  const { masterId } = await searchParams;

  // 1. 拉师傅下拉选项
  const options = await listWorkerOptions();

  // 2. 选了师傅 → 拉订单；没选 → 空
  let orders: Awaited<ReturnType<typeof listOrdersForMaster>> = [];
  let selectedName: string | undefined;
  if (masterId) {
    // 校验 masterId 是否在选项里 — 防止 ?masterId=garbage
    const found = options.find((o) => o.id === masterId);
    if (!found) {
      // 非法 masterId → 当作没选
      selectedName = undefined;
    } else {
      selectedName = found.name;
      orders = await listOrdersForMaster(masterId);
    }
  }

  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        background: "#f7f8fa",
        padding: "16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      {/* 极简顶部 — 不继承 AppNav */}
      <header
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>师傅端</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            MVP 演示 · 不做真实登录
          </div>
        </div>
        <Link
          href="/orders"
          style={{
            fontSize: 13,
            color: "#2563eb",
            textDecoration: "none",
            padding: "6px 12px",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
          }}
        >
          后台 →
        </Link>
      </header>

      {/* 师傅选择 */}
      <form
        method="get"
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <label
          htmlFor="masterId"
          style={{
            display: "block",
            fontSize: 13,
            color: "#374151",
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          选择师傅
        </label>
        <select
          id="masterId"
          name="masterId"
          defaultValue={masterId ?? ""}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 15,
            background: "#fff",
            outline: "none",
            boxSizing: "border-box",
          }}
        >
          <option value="">— 请选择 —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}（手机尾号 {o.phoneTail}）· {o.status}
            </option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            marginTop: 12,
            width: "100%",
            padding: "12px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          查看我的订单
        </button>
      </form>

      {/* 订单列表 */}
      {!masterId ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            padding: 40,
            textAlign: "center",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          请先选择师傅
        </div>
      ) : orders.length === 0 ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            padding: 40,
            textAlign: "center",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          暂无分配订单
        </div>
      ) : (
        <div>
          <div
            style={{
              fontSize: 13,
              color: "#6b7280",
              marginBottom: 12,
              paddingLeft: 4,
            }}
          >
            {selectedName} 的订单 · 共 {orders.length} 单
          </div>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} masterId={masterId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 单个订单卡片 ----------

function OrderCard({
  order,
  masterId,
}: {
  order: Awaited<ReturnType<typeof listOrdersForMaster>>[number];
  masterId: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* 顶部：订单号 + 状态 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "#6b7280" }}>{order.id}</div>
        <StatusBadge
          label={ORDER_STATUS_LABEL[order.status]}
          tone={ORDER_TONE[order.status]}
        />
      </div>

      {/* 客户信息 */}
      <div style={{ marginBottom: 10 }}>
        <Field label="客户" value={order.customerName} />
        <Field label="手机" value={order.customerPhone} />
        <Field label="地址" value={order.address} />
        <Field label="服务" value={order.serviceName} />
        <Field label="金额" value={`¥${order.amountYuan.toFixed(2)}`} />
      </div>

      {/* 操作按钮区 — 状态操作 + 查看详情 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <WorkerOrderActions orderId={order.id} status={order.status} />
        <Link
          href={`/worker/orders/${encodeURIComponent(order.id)}?masterId=${encodeURIComponent(masterId)}`}
          style={{
            display: "block",
            textAlign: "center",
            padding: "12px 16px",
            background: "#fff",
            color: "#2563eb",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          查看详情 →
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: 14,
        lineHeight: 1.6,
        padding: "2px 0",
      }}
    >
      <div
        style={{
          color: "#6b7280",
          width: 56,
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        {label}
      </div>
      <div style={{ color: "#111827", flex: 1, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}