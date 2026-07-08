import Link from "next/link";
import { DispatchRuleActionsCell } from "@/components/DispatchRuleActionsCell";
import { card, th, td } from "@/components/ui";
import { listRules } from "@/src/lib/dispatch-rules";
import type { RuleListItem } from "@/src/lib/dispatch-rules";

interface PageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

const YES_NO: Record<string, { label: string; bg: string; fg: string }> = {
  true: { label: "启用", bg: "#dcfce7", fg: "#15803d" },
  false: { label: "停用", bg: "#f3f4f6", fg: "#6b7280" },
};

const codeStyle: React.CSSProperties = {
  background: "#fff",
  padding: "1px 6px",
  borderRadius: 3,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 12,
  border: "1px solid #dbeafe",
};

function StatusBadge({ enabled }: { enabled: boolean }) {
  const s = YES_NO[String(enabled)];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        background: s.bg,
        color: s.fg,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

export default async function DispatchRulesPage({ searchParams }: PageProps) {
  const { created, updated } = await searchParams;
  const rules = await listRules();

  return (
    <>
      <main
        style={{
          padding: "24px 48px 48px",
          background: "#f7f8fa",
          minHeight: "calc(100vh - 56px)",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          color: "#111827",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <h1 style={{ fontSize: 24, margin: 0 }}>派单规则</h1>
          <Link
            href="/dispatch-rules/new"
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            + 新增规则
          </Link>
        </div>
        <p style={{ color: "#6b7280", margin: "0 0 12px 0", fontSize: 14 }}>
          {rules.length} 条规则 · 按优先级从高到低排序
        </p>

        {/* 派单规则概念说明 — 给新手解释 SKU 精确 vs 类目兜底 */}
        <details
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "#1e40af",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            💡 什么是派单规则？SKU 精确 vs 类目兜底
          </summary>
          <div style={{ marginTop: 8, lineHeight: 1.7 }}>
            <div style={{ marginBottom: 6 }}>
              <strong>SKU 精确</strong>：订单的 SKU 匹配规则里写的 SKU →
              命中规则。要求师傅技能包含{" "}
              <code style={codeStyle}>requiredSkills</code>。
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>类目兜底</strong>：SKU 精确没命中 →
              退到类目级（如「家政」类目下所有 SKU 都命中）。给该类目所有 SKU
              一个统一规则。
            </div>
            <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>
              优先级 priority 高的先匹配。同优先级按 SKU 精确 &gt; 类目兜底。
            </div>
          </div>
        </details>

        {(() => {
          let banner: { message: string } | null = null;
          if (updated) banner = { message: "✓ 规则更新成功" };
          else if (created) banner = { message: "✓ 规则创建成功" };
          if (!banner) return null;
          return (
            <div
              style={{
                padding: "10px 14px",
                background: "#dcfce7",
                color: "#15803d",
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {banner.message}
            </div>
          );
        })()}

        <section style={card}>
          {rules.length === 0 ? (
            <div
              style={{
                padding: "40px 0",
                textAlign: "center",
                color: "#9ca3af",
              }}
            >
              暂无派单规则，点右上「+ 新增规则」创建第一条
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>名称</th>
                  <th style={th}>品类</th>
                  <th style={th}>SKU</th>
                  <th style={th}>所需技能</th>
                  <th style={th}>优先级</th>
                  <th style={th}>状态</th>
                  <th style={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <RuleRow key={r.id} rule={r} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}

function RuleRow({ rule }: { rule: RuleListItem }) {
  return (
    <tr>
      <td style={td}>{rule.name}</td>
      <td style={td}>
        {rule.categoryCode ? (
          <span style={{ fontFamily: "monospace" }}>{rule.categoryCode}</span>
        ) : (
          <span style={{ color: "#9ca3af" }}>—</span>
        )}
        {rule.categoryName && (
          <div style={{ color: "#6b7280", fontSize: 12 }}>
            {rule.categoryName}
          </div>
        )}
      </td>
      <td style={td}>
        {rule.skuCode ? (
          <>
            <span style={{ fontFamily: "monospace" }}>{rule.skuCode}</span>
            {rule.skuName && (
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {rule.skuName}
              </div>
            )}
          </>
        ) : (
          <span style={{ color: "#9ca3af" }}>—</span>
        )}
      </td>
      <td style={{ ...td, maxWidth: 240 }}>
        {rule.requiredSkillsStr || <span style={{ color: "#9ca3af" }}>—</span>}
      </td>
      <td style={td}>{rule.priority}</td>
      <td style={td}>
        <StatusBadge enabled={rule.enabled} />
      </td>
      <td style={td}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <DispatchRuleActionsCell
            ruleId={rule.id}
            initialEnabled={rule.enabled}
          />
          <Link
            href={`/dispatch-rules/${rule.id}/edit`}
            style={{ color: "#2563eb", fontSize: 12, textDecoration: "none" }}
          >
            编辑
          </Link>
        </div>
      </td>
    </tr>
  );
}
