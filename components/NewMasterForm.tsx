"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  createMasterAction,
  updateMasterAction,
  type MasterActionResult,
} from "@/app/masters/actions";

type Mode = "create" | "edit";

// edit 模式下 initial 还要传当前 status，给 UI 只读展示
interface EditInitial {
  id: string;
  name: string;
  phone: string;
  skills: string;
  rating: number;
  status: "available" | "busy" | "offline";
  serviceArea: string;
}

interface Props {
  mode: Mode;
  initial?: EditInitial;
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

// status 中文 + 配色（与 /masters 列表保持一致）
const STATUS_LABEL: Record<string, string> = {
  available: "可接单",
  busy: "服务中",
  offline: "离线",
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  available: { bg: "#dcfce7", fg: "#15803d" },
  busy: { bg: "#dbeafe", fg: "#1d4ed8" },
  offline: { bg: "#f3f4f6", fg: "#6b7280" },
};

/**
 * 新增 / 编辑师傅的客户端表单。
 *
 * 字段（create / edit 通用）：name / phone / skills / rating / serviceArea
 *
 * status 字段**不在表单里编辑** — 它由派单/释放自动管理。
 * edit 模式下用只读 chip 展示当前 status，让用户能看到但不能改。
 */
export function NewMasterForm({ mode, initial }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<MasterActionResult | null>(null);

  function handleSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r =
        mode === "create"
          ? await createMasterAction(formData)
          : await updateMasterAction(formData);
      // 成功路径由 server action 的 redirect 处理；这里只接失败
      if (r) setResult(r);
    });
  }

  const submitLabel = mode === "create" ? "创建师傅" : "保存修改";
  const submittingLabel = mode === "create" ? "提交中…" : "保存中…";

  // narrow result 到失败分支 — TS 才会让 .field / .error 通过
  const error = result && !result.ok ? result : null;

  return (
    <form action={handleSubmit} style={{ display: "grid", gap: 16 }}>
      {mode === "edit" && initial && (
        <input type="hidden" name="id" value={initial.id} />
      )}

      {/* 姓名 */}
      <div>
        <label style={labelStyle} htmlFor="name">
          师傅姓名 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={50}
          defaultValue={initial?.name ?? ""}
          placeholder="例：李师傅"
          style={inputStyle}
          required
        />
        {error?.field === "name" && <div style={errorStyle}>{error.error}</div>}
      </div>

      {/* 手机号 */}
      <div>
        <label style={labelStyle} htmlFor="phone">
          手机号 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          maxLength={11}
          defaultValue={initial?.phone ?? ""}
          placeholder="11 位手机号（1 开头）"
          style={inputStyle}
          required
        />
        {error?.field === "phone" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      {/* 技能 */}
      <div>
        <label style={labelStyle} htmlFor="skills">
          技能 <span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="skills"
          name="skills"
          type="text"
          defaultValue={initial?.skills ?? ""}
          placeholder="例：空调维修,家电清洗"
          style={inputStyle}
          required
        />
        <div style={helpStyle}>用逗号（中英文都可）分隔多个技能标签</div>
        {error?.field === "skills" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      {/* 评分（独占一行，因为右侧要放状态 chip） */}
      <div>
        <label style={labelStyle} htmlFor="rating">
          评分（0-5）<span style={{ color: "#b91c1c" }}>*</span>
        </label>
        <input
          id="rating"
          name="rating"
          type="number"
          min="0"
          max="5"
          step="0.1"
          defaultValue={initial?.rating ?? 5.0}
          style={inputStyle}
          required
        />
        {error?.field === "rating" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      {/* 服务区域 */}
      <div>
        <label style={labelStyle} htmlFor="serviceArea">
          服务区域
        </label>
        <input
          id="serviceArea"
          name="serviceArea"
          type="text"
          maxLength={100}
          defaultValue={initial?.serviceArea ?? ""}
          placeholder="例：上海 / 上海, 苏州"
          style={inputStyle}
        />
        <div style={helpStyle}>MVP 阶段存为文本，多区域用逗号分隔</div>
        {error?.field === "serviceArea" && (
          <div style={errorStyle}>{error.error}</div>
        )}
      </div>

      {/* edit 模式下展示当前状态 — 只读 chip，让用户能看到不能改 */}
      {mode === "edit" &&
        initial &&
        (() => {
          const s = initial.status;
          const c = STATUS_COLOR[s] ?? STATUS_COLOR.offline;
          return (
            <div>
              <label style={labelStyle}>当前状态</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    background: c.bg,
                    color: c.fg,
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {STATUS_LABEL[s] ?? s}
                </span>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  状态由派单 / 释放自动管理，不在此处手动修改
                </span>
              </div>
            </div>
          );
        })()}

      {/* 通用错误 */}
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
          {isPending ? submittingLabel : submitLabel}
        </button>
        <Link
          href="/masters"
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
