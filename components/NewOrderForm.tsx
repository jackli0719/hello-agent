"use client";

// 新建订单表单（客户端组件）。
//
// ⚠️ 这一版替换了 demo 期的旧实现（同名文件）：
// - 旧版字段：name="serviceSkuId"（DB 内部 ID） + 字段错误信息硬编码
// - 新版字段：name="skuCode"（业务编码） + name="categoryCode"（联动用）
// 旧版在 src/lib/actions/create-order.ts（已删）；新版走 app/orders/actions.ts。
// 字段名变了是因为 schema 加了 skuCode / categoryCode 业务编码，UI 也跟着升级。
//
// 表单 ↔ server action 的字段约定：
// - categoryCode: 前端联动用（选类目 → 筛 SKU），同时作为配对校验提交
// - skuCode: 真实提交的 SKU 字段；服务端用 skuCode 反查 SKU，再校验 categoryCode 配对

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  createOrderAction,
  type CreateOrderActionResult,
} from "@/app/orders/actions";

interface CategoryOption {
  id: string;
  name: string;
  categoryCode: string;
}

interface SkuOption {
  id: string;
  skuCode: string;
  name: string;
  categoryId: string;
  basePriceYuan: number;
  durationMinutes: number;
}

interface Props {
  categories: CategoryOption[];
  skus: SkuOption[];
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#374151",
  marginBottom: 6,
  fontWeight: 500,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
};
const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#b91c1c",
  marginTop: 4,
};

export function NewOrderForm({ categories, skus }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateOrderActionResult | null>(null);

  const firstCategory = categories[0];
  const [selectedCategoryCode, setSelectedCategoryCode] = useState(
    firstCategory.categoryCode,
  );

  const skusForCategory = useMemo(
    () =>
      skus.filter((s) => {
        const cat = categories.find((c) => c.id === s.categoryId);
        return cat?.categoryCode === selectedCategoryCode;
      }),
    [skus, categories, selectedCategoryCode],
  );
  const firstSkuForCategory = skusForCategory[0];
  const [selectedSkuCode, setSelectedSkuCode] = useState(
    firstSkuForCategory?.skuCode ?? "",
  );

  function handleCategoryChange(code: string) {
    setSelectedCategoryCode(code);
    const cat = categories.find((c) => c.categoryCode === code);
    const firstSku = skus.find((s) => s.categoryId === cat?.id);
    setSelectedSkuCode(firstSku?.skuCode ?? "");
  }

  function handleSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await createOrderAction(formData);
      if (r) setResult(r);
    });
  }

  return (
    <form action={handleSubmit} style={{ display: "grid", gap: 16 }}>
      {/* 服务品类 + 服务 SKU：级联 */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label style={labelStyle} htmlFor="categoryCode">
            服务品类 <span style={{ color: "#b91c1c" }}>*</span>
          </label>
          <select
            id="categoryCode"
            name="categoryCode"
            value={selectedCategoryCode}
            onChange={(e) => handleCategoryChange(e.target.value)}
            style={inputStyle}
            required
          >
            {categories.map((c) => (
              <option key={c.categoryCode} value={c.categoryCode}>
                {c.name} ({c.categoryCode})
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            选了类目后，下面的 SKU 列表会自动筛选
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="skuCode">
            服务 SKU <span style={{ color: "#b91c1c" }}>*</span>
          </label>
          <select
            id="skuCode"
            name="skuCode"
            value={selectedSkuCode}
            onChange={(e) => setSelectedSkuCode(e.target.value)}
            style={inputStyle}
            required
          >
            {skusForCategory.length === 0 ? (
              <option value="">（该类目下没有可用的 SKU）</option>
            ) : (
              skusForCategory.map((s) => (
                <option key={s.skuCode} value={s.skuCode}>
                  {s.name} · ¥{s.basePriceYuan.toFixed(2)} · {s.durationMinutes}{" "}
                  分钟
                </option>
              ))
            )}
          </select>
          {result && "field" in result && result.field === "skuCode" && (
            <div style={errorStyle}>{result.error}</div>
          )}
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="customerName">
          客户姓名 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="customerName"
          name="customerName"
          type="text"
          maxLength={50}
          placeholder="例：陈晓明"
          style={inputStyle}
          required
        />
        {result && "field" in result && result.field === "customerName" && (
          <div style={errorStyle}>{result.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="customerPhone">
          手机号 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="customerPhone"
          name="customerPhone"
          type="tel"
          inputMode="numeric"
          maxLength={11}
          placeholder="11 位手机号"
          style={inputStyle}
          required
        />
        {result && "field" in result && result.field === "customerPhone" && (
          <div style={errorStyle}>{result.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="address">
          服务地址 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="address"
          name="address"
          type="text"
          maxLength={200}
          placeholder="例：上海市浦东新区世纪大道 100 号"
          style={inputStyle}
          required
        />
        {result && "field" in result && result.field === "address" && (
          <div style={errorStyle}>{result.error}</div>
        )}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label style={labelStyle} htmlFor="scheduledAt">
            预约时间 <span style={{ color: "#b91c1c" }}>*</span>
          </label>
          <input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            defaultValue={defaultScheduledAt()}
            style={inputStyle}
            required
          />
          {result && "field" in result && result.field === "scheduledAt" && (
            <div style={errorStyle}>{result.error}</div>
          )}
        </div>
        <div>
          <label style={labelStyle} htmlFor="amount">
            金额（元） <span style={{ color: "#b91c1c" }}>*</span>
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={firstSkuForCategory?.basePriceYuan.toFixed(2) ?? "0"}
            style={inputStyle}
            required
          />
          {result && "field" in result && result.field === "amount" && (
            <div style={errorStyle}>{result.error}</div>
          )}
        </div>
      </div>

      {result && !("field" in result && result.field) && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {result.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: "10px 22px",
            background: isPending ? "#9ca3af" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "提交中…" : "创建订单"}
        </button>
        <Link
          href="/orders"
          style={{
            padding: "10px 22px",
            background: "#fff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          取消
        </Link>
      </div>
    </form>
  );
}

function defaultScheduledAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
