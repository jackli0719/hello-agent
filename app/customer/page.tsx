// 用户下单 H5 — /customer
//
// MVP 范围（按需求）：
// 1. mobile 友好表单
// 2. 选品类 + 选 SKU（联动 — 选品类后只显示该品类 SKU）
// 3. 5 个输入：姓名 / 手机 / 地址 / 备注 / 品类 / SKU
// 4. 提交后展示订单号 + 成功提示
// 5. 不做支付、登录、地图、短信、复杂 UI
//
// 设计：
// - 主表单是 client component（用 useActionState 拿内联反馈）
// - server 端拉品类+SKU 通过 prop 传给 client 组件
// - 表单 action 调 customerCreateOrderAction（已带 createOrder 全部校验）

import { listCustomerCategoriesAndSkus } from "@/src/lib/customer";
import Link from "next/link";
import { CustomerOrderForm } from "./CustomerOrderForm";

export default async function CustomerPage() {
  const { categories, skus } = await listCustomerCategoriesAndSkus();
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
      {/* 极简顶部 — 标题 + 两个入口（查询 + 后台） */}
      <header
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "16px",
          marginBottom: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>下单</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            演示版 · 不验证手机号归属
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/customer/orders"
            style={{
              fontSize: 13,
              color: "#2563eb",
              textDecoration: "none",
              padding: "6px 10px",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
            }}
          >
            查询订单
          </Link>
          <a
            href="/login"
            style={{
              fontSize: 13,
              color: "#6b7280",
              textDecoration: "none",
              padding: "6px 10px",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
            }}
          >
            后台 →
          </a>
        </div>
      </header>

      {/* 流程说明 */}
      <div
        style={{
          padding: "10px 14px",
          background: "#eff6ff",
          color: "#1d4ed8",
          borderRadius: 6,
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        填写下方信息提交订单 → 后台分配师傅 → 师傅上门服务 →
        完成后可在「查询订单」随时查看进度
      </div>

      <CustomerOrderForm categories={categories} skus={skus} />
    </div>
  );
}
