"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  createRuleAction,
  updateRuleAction,
  type DispatchRuleActionResult,
} from "@/app/dispatch-rules/actions";
import { parseSkillsString } from "@/src/lib/masters";

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
const helpStyle: React.CSSProperties = { fontSize: 11, color: "#9ca3af", marginTop: 4 };
const errorStyle: React.CSSProperties = { fontSize: 12, color: "#b91c1c", marginTop: 4 };

interface CategoryOption {
  categoryCode: string;
  name: string;
}

interface SkuOption {
  skuCode: string;
  name: string;
  categoryName: string;
}

interface Props {
  mode: "create" | "edit";
  initial?: {
    id: string;
    name: string;
    categoryCode: string | null;
    skuCode: string | null;
    requiredSkillsStr: string;
    priority: number;
    enabled: boolean;
  };
  categories: CategoryOption[];
  skus: SkuOption[];
}

export function DispatchRuleForm({ mode, initial, categories, skus }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<DispatchRuleActionResult | null>(null);
  // UI 互斥：「sku」= SKU 精确 / 「category」= 类目兜底 / 选哪个就只填哪个，另一个 disable
  // 初始值由 initial 决定（编辑时按已有规则选）
  const initialMode: "sku" | "category" = initial?.skuCode ? "sku" : "category";
  const [matchType, setMatchType] = useState<"sku" | "category">(initialMode);
  const skuSelectRef = useRef<HTMLSelectElement>(null);
  const categorySelectRef = useRef<HTMLSelectElement>(null);

  // matchType 变化时清空另一个字段（避免提交时一个被 disable 拿不到值）
  function handleMatchTypeChange(next: "sku" | "category") {
    if (next === matchType) return;
    setMatchType(next);
    if (next === "sku") {
      // 切到 SKU：清空 categoryCode
      if (categorySelectRef.current) categorySelectRef.current.value = "";
    } else {
      if (skuSelectRef.current) skuSelectRef.current.value = "";
    }
  }

  function handleSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = mode === "create" ? await createRuleAction(formData) : await updateRuleAction(formData);
      if (r) setResult(r);
    });
  }

  const submitLabel = mode === "create" ? "创建规则" : "保存修改";
  const submittingLabel = mode === "create" ? "提交中…" : "保存中…";

  const error = result && !result.ok ? result : null;

  return (
    <form action={handleSubmit} style={{ display: "grid", gap: 16 }}>
      {mode === "edit" && initial && (
        <input type="hidden" name="id" value={initial.id} />
      )}

      <div>
        <label style={labelStyle} htmlFor="name">
          规则名称 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={50}
          defaultValue={initial?.name ?? ""}
          placeholder="例：SKU 精确 - 空调清洗"
          style={inputStyle}
          required
        />
        {error?.field === "name" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div>
        <label style={labelStyle}>匹配类型 <span style={{ color: "#b91c1c" }}>*</span></label>
        <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              border: "1px solid " + (matchType === "sku" ? "#2563eb" : "#d1d5db"),
              borderRadius: 6,
              background: matchType === "sku" ? "#eff6ff" : "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="radio"
              name="matchType"
              value="sku"
              checked={matchType === "sku"}
              onChange={() => handleMatchTypeChange("sku")}
            />
            按 SKU 精确匹配
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              border: "1px solid " + (matchType === "category" ? "#2563eb" : "#d1d5db"),
              borderRadius: 6,
              background: matchType === "category" ? "#eff6ff" : "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="radio"
              name="matchType"
              value="category"
              checked={matchType === "category"}
              onChange={() => handleMatchTypeChange("category")}
            />
            按类目兜底匹配
          </label>
        </div>
        <div style={helpStyle}>两种互斥 —— 选哪个另一个会清空</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle} htmlFor="skuCode">
            SKU 编码（精确匹配）
          </label>
          <select
            ref={skuSelectRef}
            id="skuCode"
            name="skuCode"
            defaultValue={initial?.skuCode ?? ""}
            style={{
              ...inputStyle,
              background: matchType === "sku" ? "#fff" : "#f3f4f6",
              color: matchType === "sku" ? "#111827" : "#9ca3af",
              cursor: matchType === "sku" ? "pointer" : "not-allowed",
            }}
            disabled={matchType !== "sku"}
          >
            <option value="">— 选择 SKU —</option>
            {skus.map((s) => (
              <option key={s.skuCode} value={s.skuCode}>
                {s.skuCode} · {s.name}（{s.categoryName}）
              </option>
            ))}
          </select>
          {error?.field === "skuCode" && <div style={errorStyle}>{error.error}</div>}
        </div>

        <div>
          <label style={labelStyle} htmlFor="categoryCode">
            品类编码（兜底匹配）
          </label>
          <select
            ref={categorySelectRef}
            id="categoryCode"
            name="categoryCode"
            defaultValue={initial?.categoryCode ?? ""}
            style={{
              ...inputStyle,
              background: matchType === "category" ? "#fff" : "#f3f4f6",
              color: matchType === "category" ? "#111827" : "#9ca3af",
              cursor: matchType === "category" ? "pointer" : "not-allowed",
            }}
            disabled={matchType !== "category"}
          >
            <option value="">— 选择品类 —</option>
            {categories.map((c) => (
              <option key={c.categoryCode} value={c.categoryCode}>
                {c.categoryCode} · {c.name}
              </option>
            ))}
          </select>
          {error?.field === "categoryCode" && <div style={errorStyle}>{error.error}</div>}
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="requiredSkills">
          所需技能
        </label>
        <input
          id="requiredSkills"
          name="requiredSkills"
          type="text"
          defaultValue={initial?.requiredSkillsStr ?? ""}
          placeholder="例：空调维修,家电清洗"
          style={inputStyle}
        />
        <div style={helpStyle}>
          用逗号分隔多个技能。留空表示「不要求特定技能，所有 available 师傅都候选」。
          师傅必须掌握全部列出技能才能接这单。
        </div>
        {error?.field === "requiredSkills" && <div style={errorStyle}>{error.error}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle} htmlFor="priority">
            优先级（数字越大越优先）<span style={{ color: "#b91c1c" }}>*</span>
          </label>
          <input
            id="priority"
            name="priority"
            type="number"
            min="0"
            max="10000"
            defaultValue={initial?.priority ?? 0}
            style={inputStyle}
            required
          />
          <div style={helpStyle}>0-10000。同类型多条规则选 priority 最高</div>
          {error?.field === "priority" && <div style={errorStyle}>{error.error}</div>}
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
            <input name="enabled" type="checkbox" defaultChecked={initial?.enabled ?? true} />
            <span style={{ fontSize: 14 }}>禁用后不会参与订单推荐</span>
          </label>
        </div>
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
        <SubmitButton isPending={isPending} label={submitLabel} submittingLabel={submittingLabel} />
        <CancelLink />
      </div>
    </form>
  );
}

function SubmitButton({
  isPending,
  label,
  submittingLabel,
}: {
  isPending: boolean;
  label: string;
  submittingLabel: string;
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
      {isPending ? submittingLabel : label}
    </button>
  );
}

function CancelLink() {
  return (
    <Link
      href="/dispatch-rules"
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