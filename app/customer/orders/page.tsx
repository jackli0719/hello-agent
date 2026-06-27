// 用户端查询订单 — /customer/orders
//
// MVP 范围（按需求）：
// 1. 输入手机号 → 查该手机号的所有订单
// 2. 展示订单号 / 服务 / 服务品类 / 状态 / 预约时间 / 金额 / 师傅名 / 备注
// 3. 状态用中文徽标（复用 /orders 的 ORDER_TONE + StatusBadge）
// 4. 空状态「暂无查询结果」
// 5. 手机号格式校验（11 位 1 开头 — 和 createOrder 一致）
//
// 设计：
// - 用 server component + form GET（?phone=...）— 简单、能复用浏览器历史
// - 不做短信验证 / 不做验证码（演示期）
// - 隐私：演示期任何手机号都能查，上线前必须加验证码 + 限流

import Link from "next/link";
import { listOrdersForCustomerPhone } from "@/src/lib/customer";
import { StatusBadge, ORDER_TONE } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/mock-data";

interface PageProps {
  searchParams: Promise<{ phone?: string }>;
}

export default async function CustomerOrdersPage({ searchParams }: PageProps) {
  const { phone: phoneParam } = await searchParams;
  const phone = (phoneParam ?? "").trim();

  // 手机号格式校验
  const isValidPhone = /^1\d{10}$/.test(phone);
  const orders = isValidPhone ? await listOrdersForCustomerPhone(phone) : [];

  // 时间格式
  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

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
      {/* 极简顶部 */}
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
        <Link
          href="/customer"
          style={{
            fontSize: 13,
            color: "#2563eb",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
          }}
        >
          ← 下单
        </Link>
        <div style={{ fontSize: 13, color: "#6b7280" }}>查询我的订单</div>
        <div style={{ width: 56 }} />
      </header>

      {/* 查询表单 */}
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
          htmlFor="phone"
          style={{
            display: "block",
            fontSize: 13,
            color: "#374151",
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          手机号
        </label>
        <input
          type="tel"
          id="phone"
          name="phone"
          defaultValue={phone}
          required
          pattern="1\d{10}"
          maxLength={11}
          placeholder="11 位手机号"
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
        />
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
          查询
        </button>
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8, lineHeight: 1.5 }}>
          演示版不验证手机号归属，任何手机号都可查询。上线前会加验证码。
        </div>
      </form>

      {/* 查询结果 */}
      {phone && !isValidPhone ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            padding: 24,
            textAlign: "center",
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          手机号格式不正确，请输入 11 位以 1 开头的手机号
        </div>
      ) : !phone ? (
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
          请输入手机号查询
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
          暂无查询结果
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
            {phone} 的订单 · 共 {orders.length} 单
          </div>
          {orders.map((o) => (
            <div
              key={o.id}
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
                  marginBottom: 10,
                  paddingBottom: 10,
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <div style={{ fontSize: 13, color: "#6b7280" }}>{o.id}</div>
                <StatusBadge
                  label={ORDER_STATUS_LABEL[o.status]}
                  tone={ORDER_TONE[o.status]}
                />
              </div>

              {/* 字段 */}
              <Field label="服务品类" value={o.serviceCategoryName ?? "—"} />
              <Field label="服务" value={o.serviceName} />
              <Field label="金额" value={`¥${o.amountYuan.toFixed(2)}`} />
              <Field label="预约时间" value={formatDateTime(o.scheduledAt)} />
              <Field label="分配师傅" value={o.technicianName ?? "—（未派单）"} />
              {o.remark ? <Field label="备注" value={o.remark} /> : null}
              <Field label="下单时间" value={formatDateTime(o.createdAt)} />
            </div>
          ))}
        </div>
      )}
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
          width: 72,
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