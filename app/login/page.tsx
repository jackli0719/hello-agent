"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginAction } from "./actions";

/**
 * 登录页 — MVP 阶段固定账号 + cookie session。
 *
 * 不接第三方登录、不做用户管理 / 注册 / 忘记密码（按需求）。
 */

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    // 直接把 formData 整个传给 server action — 校验由 server action 负责
    // 不要 client 端重复校验（之前的硬编码 admin/admin123 容易和 server action 不一致）
    startTransition(async () => {
      const r = await loginAction(formData);
      if (r.ok) {
        router.push(r.next);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f8fa",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <form
        action={handleSubmit}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 32,
          width: 360,
          boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px 0" }}>
          管理员登录
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 24px 0" }}>
          演示账号 <code style={codeStyle}>admin</code> / 密码{" "}
          <code style={codeStyle}>admin123</code>
        </p>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              color: "#374151",
              marginBottom: 6,
              fontWeight: 500,
            }}
            htmlFor="username"
          >
            用户名
          </label>
          <input
            id="username"
            name="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
              boxSizing: "border-box",
            }}
            required
            autoComplete="username"
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              color: "#374151",
              marginBottom: 6,
              fontWeight: 500,
            }}
            htmlFor="password"
          >
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              background: "#fff",
              outline: "none",
              boxSizing: "border-box",
            }}
            required
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "#fee2e2",
              color: "#b91c1c",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          style={{
            width: "100%",
            padding: "10px 16px",
            background: isPending ? "#9ca3af" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
            marginTop: 4,
          }}
        >
          {isPending ? "登录中…" : "登录"}
        </button>

        <p
          style={{
            color: "#9ca3af",
            fontSize: 11,
            marginTop: 16,
            textAlign: "center",
          }}
        >
          演示阶段 — 账号硬编码在源码
        </p>
      </form>
    </main>
  );
}

const codeStyle: React.CSSProperties = {
  background: "#f3f4f6",
  padding: "1px 6px",
  borderRadius: 3,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 12,
  border: "1px solid #e5e7eb",
  color: "#111827",
};
