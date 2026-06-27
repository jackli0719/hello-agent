import Link from "next/link";

// 三端入口首页 — /
//
// 不 redirect 到 dashboard；让用户（演示者）一目了然三端是什么。
// 不放在 AppNav 里因为这是公开的 landing 页（AppNav 已排除 / 路径）。

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f8fa",
        padding: "32px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* 顶部标题 */}
        <header style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, margin: "0 0 8px 0" }}>O2O 上门服务</h1>
          <p style={{ color: "#6b7280", margin: 0, fontSize: 14 }}>
            第一版 MVP · 三端演示入口
          </p>
        </header>

        {/* 三端入口卡片 */}
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "1fr",
          }}
        >
          <EntryCard
            icon="🛒"
            title="用户端"
            subtitle="下单 + 查询订单状态"
            description="选择服务品类 → 填写联系信息 → 提交订单。提交后用手机号随时查询状态。"
            href="/customer"
            color="#2563eb"
          />
          <EntryCard
            icon="⚙️"
            title="后台管理"
            subtitle="服务 / 师傅 / 派单规则 / 订单"
            description="维护服务品类和 SKU、维护师傅信息、配置派单规则、给订单派单。"
            href="/login"
            color="#15803d"
            extraHint="需要登录（admin / admin123）"
          />
          <EntryCard
            icon="🛠️"
            title="师傅端"
            subtitle="查看分配订单 + 状态更新"
            description="选择师傅身份 → 查看分配给自己的订单 → 进入详情页开始服务 / 完成订单。"
            href="/worker"
            color="#b45309"
            extraHint="演示版不做真实登录"
          />
        </div>

        <footer
          style={{
            textAlign: "center",
            marginTop: 32,
            color: "#9ca3af",
            fontSize: 12,
          }}
        >
          本地演示版本 · 数据保存在本地 SQLite
        </footer>
      </div>
    </div>
  );
}

function EntryCard({
  icon,
  title,
  subtitle,
  description,
  href,
  color,
  extraHint,
}: {
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  color: string;
  extraHint?: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 20,
        textDecoration: "none",
        color: "inherit",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 24, marginRight: 10 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 13, color, marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
        {description}
      </div>
      {extraHint ? (
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
          {extraHint}
        </div>
      ) : null}
    </Link>
  );
}