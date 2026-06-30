"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  createCategoryAction,
  createSkuAction,
  updateSkuAction,
  type ServiceActionResult,
} from "@/app/services/actions";
import { parseSkillsString, skillsToString } from "@/src/lib/masters";

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
const helpStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  marginTop: 4,
};
const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#b91c1c",
  marginTop: 4,
};

// ============================================================
// 新增品类
// ============================================================

export function NewCategoryForm() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ServiceActionResult | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // [v0.9.1] 修 legacy bug：跟 NewOrderForm 同问题
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      const r = await createCategoryAction(formData);
      if (r) setResult(r);
    });
  }

  const error = result && !result.ok ? result : null;

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      <div>
        <label style={labelStyle} htmlFor="name">
          品类名称 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={30}
          placeholder="例：家政"
          style={inputStyle}
          required
        />
        {error?.field === "name" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="code">
          品类编码 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="code"
          name="code"
          type="text"
          maxLength={32}
          placeholder="例：CLEAN"
          style={inputStyle}
          required
        />
        <div style={helpStyle}>
          只允许大写字母 / 数字 / 连字符，长度 2-32（应用层会自动转大写）
        </div>
        {error?.field === "code" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div>
        <label style={labelStyle}>是否启用</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          <input name="enabled" type="checkbox" defaultChecked />
          <span style={{ fontSize: 14 }}>
            启用后该品类下的 SKU 才能在创建订单时显示
          </span>
        </label>
      </div>

      {error && !error.field && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <SubmitButton isPending={isPending} label="创建品类" />
        <CancelLink />
      </div>
    </form>
  );
}

// ============================================================
// 新增 SKU
// ============================================================

interface CategoryOption {
  categoryCode: string;
  name: string;
  enabled: boolean;
}

export function NewSkuForm({ categories }: { categories: CategoryOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ServiceActionResult | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // [v0.9.1] 修 legacy bug
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      const r = await createSkuAction(formData);
      if (r) setResult(r);
    });
  }

  const error = result && !result.ok ? result : null;

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      <div>
        <label style={labelStyle} htmlFor="name">
          SKU 名称 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={60}
          placeholder="例：深度保洁 3 小时"
          style={inputStyle}
          required
        />
        {error?.field === "name" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="code">
          SKU 编码 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="code"
          name="code"
          type="text"
          maxLength={32}
          placeholder="例：CLEAN-DEEP-3H"
          style={inputStyle}
          required
        />
        <div style={helpStyle}>
          只允许大写字母 / 数字 / 连字符，长度 2-32（应用层会自动转大写）
        </div>
        {error?.field === "code" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="categoryCode">
          所属品类 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <select
          id="categoryCode"
          name="categoryCode"
          style={inputStyle}
          required
          defaultValue=""
        >
          <option value="" disabled>
            请选择品类
          </option>
          {categories.map((c) => (
            <option key={c.categoryCode} value={c.categoryCode}>
              {c.name} ({c.categoryCode}){c.enabled ? "" : " · 已禁用"}
            </option>
          ))}
        </select>
        {error?.field === "categoryCode" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="basePrice">
          基础价格（元）<span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="basePrice"
          name="basePrice"
          type="number"
          min="0"
          step="0.01"
          placeholder="例：268.00"
          style={inputStyle}
          required
        />
        <div style={helpStyle}>DB 存的是「分」，这里录入的是「元」</div>
        {error?.field === "basePrice" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="requiredSkills">
          派单所需技能
        </label>
        <input
          id="requiredSkills"
          name="requiredSkills"
          type="text"
          placeholder="例：空调维修,家电清洗"
          style={inputStyle}
        />
        <div style={helpStyle}>
          留空表示「不参与自动派单」（如应急服务）。
          师傅必须掌握全部列出技能才能接这单。
        </div>
        {error?.field === "requiredSkills" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle}>是否启用</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          <input name="enabled" type="checkbox" defaultChecked />
          <span style={{ fontSize: 14 }}>禁用后不会在创建订单时显示</span>
        </label>
      </div>

      {error && !error.field && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <SubmitButton isPending={isPending} label="创建 SKU" />
        <CancelLink />
      </div>
    </form>
  );
}

// ============================================================
// 编辑 SKU（按需求范围：只改 name / basePrice / enabled）
// ============================================================

export interface EditSkuInitial {
  id: string;
  name: string;
  basePriceYuan: number;
  enabled: boolean;
  requiredSkillsStr: string; // 编辑页直接传字符串（数组 → 字符串），避免前端重复 join
  // 只读展示
  skuCode: string;
  categoryName: string;
  categoryCode: string;
  durationMinutes: number;
}

export function EditSkuForm({ initial }: { initial: EditSkuInitial }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ServiceActionResult | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // [v0.9.1] 修 legacy bug
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      const r = await updateSkuAction(formData);
      if (r) setResult(r);
    });
  }

  const error = result && !result.ok ? result : null;

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      <input type="hidden" name="id" value={initial.id} />

      {/* 只读字段：编码 + 类目 + 时长 — 展示但不让改（需求范围） */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}
      >
        <ReadonlyField label="SKU 编码" value={initial.skuCode} />
        <ReadonlyField
          label="所属品类"
          value={`${initial.categoryName} (${initial.categoryCode})`}
        />
        <ReadonlyField
          label="标准时长"
          value={`${initial.durationMinutes} 分钟`}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="name">
          SKU 名称 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={60}
          defaultValue={initial.name}
          style={inputStyle}
          required
        />
        {error?.field === "name" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="basePrice">
          基础价格（元）<span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="basePrice"
          name="basePrice"
          type="number"
          min="0"
          step="0.01"
          defaultValue={initial.basePriceYuan.toFixed(2)}
          style={inputStyle}
          required
        />
        {error?.field === "basePrice" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="requiredSkills">
          派单所需技能
        </label>
        <input
          id="requiredSkills"
          name="requiredSkills"
          type="text"
          defaultValue={initial.requiredSkillsStr}
          placeholder="例：空调维修,家电清洗"
          style={inputStyle}
        />
        <div style={helpStyle}>
          留空表示「不参与自动派单」。 师傅必须掌握全部列出技能才能接这单。
        </div>
        {error?.field === "requiredSkills" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      <div>
        <label style={labelStyle}>是否启用</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={initial.enabled}
          />
          <span style={{ fontSize: 14 }}>禁用后不会在创建订单时显示</span>
        </label>
      </div>

      {error && !error.field && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <SubmitButton isPending={isPending} label="保存修改" />
        <CancelLink />
      </div>
    </form>
  );
}

// ============================================================
// 共享小组件
// ============================================================

function SubmitButton({
  isPending,
  label,
}: {
  isPending: boolean;
  label: string;
}) {
  return (
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
      {isPending ? "提交中…" : label}
    </button>
  );
}

function CancelLink() {
  return (
    <Link
      href="/services"
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
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ ...labelStyle, color: "#6b7280" }}>{label}</div>
      <div
        style={{
          padding: "8px 12px",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          background: "#f9fafb",
          fontSize: 13,
          color: "#6b7280",
          fontFamily: label.includes("编码") ? "monospace" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
