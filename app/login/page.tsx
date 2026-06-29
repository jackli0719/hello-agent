"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginAction } from "./actions";

/**
 * 登录页 — [账号阶段] 2026-06-29 升级为多角色。
 *
 * 三个测试账号：
 *   - admin / admin123 → 后台管理
 *   - worker1 / worker123 → 师傅端
 *   - customer1 / customer123 → 用户端（用手机号登录也可）
 *
 * 不接第三方登录、不做注册 / 忘记密码（按需求）。
 */

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "";

  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
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
          width: 380,
          boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px 0" }}>
          账号登录
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 24px 0" }}>
          演示账号（密码对应）
        </p>

        {/* 三个测试账号快捷按钮 */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => {
              setAccount("admin");
              setPassword("admin123");
            }}
            style={quickBtn}
          >
            admin
          </button>
          <button
            type="button"
            onClick={() => {
              setAccount("worker1");
              setPassword("worker123");
            }}
            style={quickBtn}
          >
            worker1
          </button>
          <button
            type="button"
            onClick={() => {
              setAccount("customer1");
              setPassword("customer123");
            }}
            style={quickBtn}
          >
            customer1
          </button>
        </div>

        <input type="hidden" name="next" value={nextPath} />

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="account">
            账号（用户名或手机号）
          </label>
          <input
            id="account"
            name="account"
            type="text"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            style={inputStyle}
            required
            autoComplete="username"
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="password">
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            required
            autoComplete="current-password"
          />
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <button
          type="submit"
          disabled={isPending}
          style={{
            ...submitBtn,
            background: isPending ? "#9ca3af" : "#2563eb",
            cursor: isPending ? "not-allowed" : "pointer",
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
          演示阶段 — 密码明文存（生产前必须哈希）
        </p>
      </form>
    </main>
  );
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

const quickBtn: React.CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  fontSize: 12,
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  cursor: "pointer",
  color: "#374151",
};

const errorStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 6,
  fontSize: 13,
  marginBottom: 12,
};

const submitBtn: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  marginTop: 4,
};
