// /demo — 三栏演示模式
//
// 一屏展示三端：用户端 / 后台 / 师傅端。演示者不用切 Tab。
//
// 设计：
// - 三个 iframe 并排（同源 → cookie 自动共享 → 后台登录一次就够）
// - 移动端友好：宽屏三栏 / 窄屏竖排
// - 顶部有「刷新全部」按钮（演示中卡了可一键重置三端视图）
//
// 注意事项：
// - iframe 不参与父页面 hydration（独立 React 树）—— 这正是想要的隔离
// - 同源 cookie 共享：父页面登录后台 → 子 iframe /orders 自动登录
// - iframe sandbox 默认同源完全权限，没加 sandbox 属性

import Link from "next/link";
import { RefreshAllButton } from "./RefreshAllButton";

export const dynamic = "force-static";

export default function DemoPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f8fa",
        padding: 16,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      {/* 顶部控制条 */}
      <header
        style={{
          maxWidth: 1400,
          margin: "0 auto 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>🎬 三栏演示模式</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            用户端 · 后台管理 · 师傅端 — 一屏全看
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <RefreshAllButton />
          <Link
            href="/"
            style={{
              padding: "6px 12px",
              background: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            ← 返回首页
          </Link>
        </div>
      </header>

      {/* 三栏 */}
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 12,
        }}
      >
        <DemoFrame
          title="🛒 用户端"
          subtitle="/customer"
          src="/customer"
          hint="选品类 → 选 SKU → 填信息 → 提交"
        />
        <DemoFrame
          title="⚙️ 后台管理"
          subtitle="/orders"
          src="/orders"
          hint="需先在 /login 用 admin / admin123 登录"
        />
        <DemoFrame
          title="🛠️ 师傅端"
          subtitle="/worker"
          src="/worker"
          hint="选师傅 → 看分配订单 → 进详情操作"
        />
      </div>
    </div>
  );
}

function DemoFrame({
  title,
  subtitle,
  src,
  hint,
}: {
  title: string;
  subtitle: string;
  src: string;
  hint: string;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "min(720px, calc(100vh - 100px))",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
          {subtitle} · {hint}
        </div>
      </div>
      <iframe
        data-demo-frame
        src={src}
        title={title}
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          background: "#fff",
        }}
      />
    </section>
  );
}
