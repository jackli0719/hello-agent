"use client";

// 师傅入驻表单 — client component。
// 用 useActionState 接 server action 的内联反馈。

import { useActionState } from "react";
import { joinByInviteCodeAction } from "./actions";

type JoinResult =
  | { ok: true; merchantName: string }
  | { ok: false; error: string; field?: string }
  | null;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 15,
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export function JoinWorkerForm() {
  const [state, formAction, pending] = useActionState<JoinResult, FormData>(
    async (_prev, formData) => joinByInviteCodeAction(formData),
    null,
  );

  // 成功
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
          入驻成功
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
          已成功绑定商家：{state.merchantName}
        </div>
        <div>
          <a
            href="/worker"
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
            前往师傅端
          </a>
        </div>
      </div>
    );
  }

  const errorMessage = state && !state.ok ? state.error : undefined;

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
      {errorMessage && (
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
      )}

      <Field label="邀请码" required>
        <input
          type="text"
          name="inviteCode"
          required
          maxLength={20}
          placeholder="商家提供的 8 字符邀请码"
          style={{
            ...inputStyle,
            fontFamily: "monospace",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        />
      </Field>

      <Field label="姓名" required>
        <input
          type="text"
          name="name"
          required
          maxLength={50}
          placeholder="请填写您的姓名"
          style={inputStyle}
        />
      </Field>

      <Field label="手机号" required>
        <input
          type="tel"
          name="phone"
          required
          maxLength={11}
          pattern="1\d{10}"
          placeholder="11 位手机号（用于识别老师傅）"
          style={inputStyle}
        />
      </Field>

      <Field label="技能" required hint="逗号分隔，如：保洁, 家电清洗">
        <input
          type="text"
          name="skills"
          required
          maxLength={200}
          placeholder="保洁, 家电清洗"
          style={inputStyle}
        />
      </Field>

      <Field label="服务区域" hint="可选，如：深圳">
        <input
          type="text"
          name="serviceArea"
          maxLength={100}
          placeholder="深圳"
          style={inputStyle}
        />
      </Field>

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
        {pending ? "提交中…" : "提交入驻"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 13,
          color: "#374151",
          fontWeight: 500,
          marginBottom: 6,
        }}
      >
        {label}
        {required && <span style={{ color: "#b91c1c" }}> *</span>}
        {hint && (
          <span
            style={{
              color: "#6b7280",
              fontSize: 12,
              fontWeight: 400,
              marginLeft: 6,
            }}
          >
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
