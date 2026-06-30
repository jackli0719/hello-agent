"use client";

// 后台内部备注编辑表单 — [v0.7.6] / [v0.7.7] 加 CSRF
// 调 updateInternalRemarkAction（admin 专属）

import { useState, useTransition } from "react";
import { updateInternalRemarkAction } from "@/app/orders/actions";
import { CSRF_FORM_FIELD } from "@/src/lib/csrf-constants";

export function InternalRemarkForm({
  orderId,
  initialRemark,
  csrfToken, // [v0.7.7] RSC 阶段通过 ensureCsrfCookie 写入 cookie 的 token
}: {
  orderId: string;
  initialRemark: string | null;
  csrfToken: string;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialRemark ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("orderId", orderId);
    fd.set("internalRemark", value);
    fd.set(CSRF_FORM_FIELD, csrfToken); // [v0.7.7]
    startTransition(async () => {
      const result = await updateInternalRemarkAction(fd);
      if (!result.ok) {
        setError(result.error);
      } else {
        setSaved(true);
      }
    });
  };

  return (
    <div style={{ marginTop: 4 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "#6b7280",
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        后台内部备注
      </label>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="如：客户是老用户，优先派王师傅"
        maxLength={500}
        rows={2}
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          fontSize: 12,
          boxSizing: "border-box",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div
        style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          style={{
            padding: "4px 12px",
            background: pending ? "#93c5fd" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "保存中…" : "保存备注"}
        </button>
        {error && (
          <span style={{ fontSize: 11, color: "#b91c1c" }}>{error}</span>
        )}
        {saved && !error && (
          <span style={{ fontSize: 11, color: "#16a34a" }}>✓ 已保存</span>
        )}
      </div>
    </div>
  );
}
