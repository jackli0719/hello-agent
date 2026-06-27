"use client";

// 用户端下单表单 — client component。
//
// 用 useActionState 拿 server action 的内联反馈（错误字段高亮 / 成功订单号展示）。
// 联动：选品类 → SKU 下拉只显示该品类的 SKU。

import { useActionState, useState } from "react";
import { customerCreateOrderAction } from "./actions";
import type { CustomerCategoryOption, CustomerSkuOption } from "@/src/lib/customer";

interface Props {
  categories: CustomerCategoryOption[];
  skus: CustomerSkuOption[];
}

export function CustomerOrderForm({ categories, skus }: Props) {
  // 联动：选中的 categoryCode（业务编码）。
  // 注意：form submit 时 <select name="categoryCode"> 也要传业务编码（APPLIANCE / CLEAN / REPAIR ...），
  // 不是 category.id（cuid）。createOrder 的配对校验期待 categoryCode。
  // 这里直接用 categoryCode 做 state 一举两得：联动 + form value 同步。
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string>("");

  // useActionState 接 server action — 错误时 field 标红，成功时展示订单号
  const [state, formAction, pending] = useActionState<
    { ok: true; orderId: string } | { ok: false; error: string; field?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await customerCreateOrderAction(formData);
    return result;
  }, null);

  // 成功状态：展示订单号 + 重置按钮（reload 当前页）
  if (state?.ok) {
    return (
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          订单已提交
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
          我们会尽快安排师傅与您联系
        </div>
        <div
          style={{
            display: "inline-block",
            padding: "10px 16px",
            background: "#dcfce7",
            color: "#15803d",
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 500,
            marginBottom: 20,
          }}
        >
          订单号 {state.orderId}
        </div>
        <div>
          <a
            href="/customer"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            再下一单
          </a>
        </div>
      </div>
    );
  }

  // 失败时按 field 字段标红
  const errorField = state && !state.ok ? state.field : undefined;
  const errorMessage = state && !state.ok ? state.error : undefined;

  // 按选中的 categoryCode 过滤 SKU
  const visibleSkus = selectedCategoryCode
    ? skus.filter((s) => s.categoryCode === selectedCategoryCode)
    : skus;

  return (
    <form
      action={formAction}
      style={{
        background: "#fff",
        borderRadius: 8,
        padding: 16,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* 全局错误提示 */}
      {errorMessage && !errorField ? (
        <div
          style={{
            padding: "10px 12px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <FormField label="服务品类" error={errorField === "categoryCode" || errorField === "skuCode"}>
        <select
          name="categoryCode"
          value={selectedCategoryCode}
          onChange={(e) => setSelectedCategoryCode(e.target.value)}
          required
          style={selectStyle(errorField === "categoryCode")}
        >
          <option value="">— 请选择服务品类 —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.categoryCode}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="服务 SKU" error={errorField === "skuCode"}>
        <select
          name="skuCode"
          required
          defaultValue=""
          disabled={!selectedCategoryCode && categories.length > 0}
          style={selectStyle(errorField === "skuCode")}
        >
          <option value="">
            {selectedCategoryCode ? "— 请选择 SKU —" : "— 请先选择品类 —"}
          </option>
          {visibleSkus.map((s) => (
            <option key={s.id} value={s.skuCode}>
              {s.name}（¥{s.basePriceYuan.toFixed(0)} · {s.durationMinutes} 分钟）
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="姓名" error={errorField === "customerName"}>
        <input
          type="text"
          name="customerName"
          required
          maxLength={50}
          placeholder="请填写您的姓名"
          style={inputStyle(errorField === "customerName")}
        />
      </FormField>

      <FormField label="手机号" error={errorField === "customerPhone"}>
        <input
          type="tel"
          name="customerPhone"
          required
          maxLength={11}
          pattern="1\d{10}"
          placeholder="11 位手机号"
          style={inputStyle(errorField === "customerPhone")}
        />
      </FormField>

      <FormField label="服务地址" error={errorField === "address"}>
        <textarea
          name="address"
          required
          maxLength={200}
          rows={2}
          placeholder="详细地址（街道、门牌号）"
          style={{ ...inputStyle(errorField === "address"), resize: "vertical" }}
        />
      </FormField>

      <FormField label="备注（可选）" error={errorField === "remark"}>
        <textarea
          name="remark"
          maxLength={500}
          rows={2}
          placeholder="如有特殊需求请填写"
          style={{ ...inputStyle(errorField === "remark"), resize: "vertical" }}
        />
      </FormField>

      {/* 字段级错误 */}
      {errorMessage && errorField ? (
        <div
          style={{
            padding: "10px 12px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: pending ? "#93c5fd" : "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 16,
          fontWeight: 500,
          cursor: pending ? "not-allowed" : "pointer",
          marginTop: 8,
        }}
      >
        {pending ? "提交中…" : "提交订单"}
      </button>
    </form>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 13,
          color: error ? "#b91c1c" : "#374151",
          fontWeight: 500,
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function inputStyle(error: boolean | undefined): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: error ? "1px solid #fca5a5" : "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 15,
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
}

function selectStyle(error: boolean | undefined): React.CSSProperties {
  return {
    ...inputStyle(error),
    appearance: "none",
    backgroundImage:
      "url(\"data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23111827%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px top 50%",
    backgroundSize: "10px auto",
    paddingRight: 32,
  };
}