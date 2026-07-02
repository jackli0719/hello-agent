import Link from "next/link";

// 三端入口首页 — /
//
// 不放在 AppNav 里因为这是公开的 landing 页（AppNav 已排除 / 路径）。
// 设计目标：30 秒让观众看明白这是什么 / 怎么演示 / 工程化做得多扎实。

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
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Hero — 30 秒 hook */}
        <header style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 32, margin: "0 0 12px 0" }}>
            🛠️ O2O 上门服务 SaaS 雏形
          </h1>
          <p
            style={{
              color: "#374151",
              margin: "0 0 4px 0",
              fontSize: 16,
              lineHeight: 1.6,
            }}
          >
            一个平台，三个角色，一套数据
          </p>
          <p style={{ color: "#6b7280", margin: 0, fontSize: 13 }}>
            客户下单 → 后台派单 → 师傅履约 → 状态实时同步
          </p>
        </header>

        {/* 三端入口 */}
        <SectionTitle title="三端入口" />
        <div style={{ display: "grid", gap: 12, marginBottom: 32 }}>
          <EntryCard
            icon="🛒"
            title="用户端"
            subtitle="下单 + 查询订单"
            href="/customer"
            color="#2563eb"
          />
          <EntryCard
            icon="⚙️"
            title="后台管理"
            subtitle="服务 / 师傅 / 派单规则 / 订单"
            href="/login"
            color="#15803d"
            hint="admin / admin123"
          />
          <EntryCard
            icon="🛠️"
            title="师傅端"
            subtitle="查看分配订单 + 状态更新"
            href="/worker"
            color="#b45309"
            hint="演示版不做真实登录"
          />
          <EntryCard
            icon="📨"
            title="师傅入驻"
            subtitle="[任务 4] 师傅通过商家邀请码绑定商家"
            href="/worker/join"
            color="#7c3aed"
            hint="输入邀请码自助入驻"
          />
        </div>

        {/* 演示助手 */}
        <SectionTitle title="演示助手" />
        <div style={{ display: "grid", gap: 12, marginBottom: 32 }}>
          <ActionCard
            title="🎬 三栏演示模式"
            description="一屏展示三端（用户 / 后台 / 师傅），不用切 Tab。"
            href="/demo"
            color="#7c3aed"
          />
          <ActionCard
            title="📖 完整演示脚本"
            description="4 步演示 + 异常演示 + 验收打勾表。"
            href="/docs/DEMO.md"
            color="#0ea5e9"
          />
        </div>

        {/* 技术亮点 — 让观众第一眼看到工程化能力 */}
        <SectionTitle title="工程化亮点" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <HighlightCard
            icon="✅"
            title="222 自动化测试"
            sub="业务逻辑 + 端到端"
          />
          <HighlightCard
            icon="🔁"
            title="GitHub Actions CI"
            sub="check + lint + test + build"
          />
          <HighlightCard
            icon="🔒"
            title="乐观锁防并发"
            sub="派单/状态流转零脏数据"
          />
          <HighlightCard
            icon="🔄"
            title="三端状态同步"
            sub="revalidate 即时刷新"
          />
          <HighlightCard
            icon="📊"
            title="业务指标页"
            sub="创建/派单/状态成功率"
          />
          <HighlightCard
            icon="📱"
            title="移动端友好"
            sub="用户端 / 师傅端 H5"
          />
        </div>

        <footer
          style={{
            textAlign: "center",
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #e5e7eb",
            color: "#9ca3af",
            fontSize: 12,
          }}
        >
          第一版 MVP · 本地 SQLite 演示 · 生产需迁移 PostgreSQL
        </footer>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "#374151",
        marginBottom: 12,
        marginTop: 8,
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      {title}
    </div>
  );
}

function EntryCard({
  icon,
  title,
  subtitle,
  href,
  color,
  hint,
}: {
  icon: string;
  title: string;
  subtitle: string;
  href: string;
  color: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        textDecoration: "none",
        color: "inherit",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 22, marginRight: 10 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color, marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      {hint ? (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
          {hint}
        </div>
      ) : null}
    </Link>
  );
}

function ActionCard({
  title,
  description,
  href,
  color,
}: {
  title: string;
  description: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 14,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{description}</div>
    </Link>
  );
}

function HighlightCard({
  icon,
  title,
  sub,
}: {
  icon: string;
  title: string;
  sub: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 14,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{sub}</div>
    </div>
  );
}
