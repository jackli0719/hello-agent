import Link from "next/link";
import { StatusBadge, th, td, card } from "@/components/ui";
import { listCommissionStrategies } from "@/src/lib/commission";
import { listMerchants } from "@/src/lib/merchants";

interface PageProps {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    merchantId?: string;
    error?: string;
  }>;
}

export default async function CommissionStrategiesPage({
  searchParams,
}: PageProps) {
  const { created, updated, merchantId, error } = await searchParams;

  // 并行加载策略 + 商家（用于下拉过滤）
  const [strategies, merchants] = await Promise.all([
    listCommissionStrategies(merchantId),
    listMerchants(),
  ]);

  return (
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
        <h1 style={{ fontSize: 24, margin: 0 }}>分成策略管理</h1>
        <Link
          href="/commission-strategies/new"
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
          + 新增策略
        </Link>
      </div>
      <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
        共 {strategies.length} 条策略
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          （仅做配置，不做真实结算）
        </span>
      </p>

      {created && (
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
          ✓ 策略 <strong>{created}</strong> 创建成功
        </div>
      )}
      {updated && (
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
          ✓ 策略 <strong>{updated}</strong> 更新成功
        </div>
      )}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* 商家过滤 */}
      <form
        method="get"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <label style={{ fontSize: 13, color: "#6b7280" }}>按商家过滤：</label>
        <select
          name="merchantId"
          defaultValue={merchantId ?? ""}
          style={{
            padding: "8px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 14,
            background: "#fff",
            outline: "none",
            minWidth: 220,
          }}
        >
          <option value="">全部商家</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            padding: "8px 18px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          过滤
        </button>
        {merchantId && (
          <Link
            href="/commission-strategies"
            style={{
              padding: "8px 14px",
              background: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            重置
          </Link>
        )}
      </form>

      <section style={card}>
        {strategies.length === 0 ? (
          <div
            style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af" }}
          >
            暂无分成策略
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>策略名</th>
                <th style={th}>归属商家</th>
                <th style={th}>类型</th>
                <th style={th}>规则</th>
                <th style={th}>状态</th>
                <th style={th}>创建时间</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => {
                const rule =
                  s.strategyType === "percentage"
                    ? `平台 ${(s.platformRate * 100).toFixed(0)}% / 商家 ${(s.merchantRate * 100).toFixed(0)}% / 师傅 ${(s.workerRate * 100).toFixed(0)}%`
                    : `平台 ¥${(s.fixedPlatformAmount / 100).toFixed(2)} / 商家 ¥${(s.fixedMerchantAmount / 100).toFixed(2)} / 师傅 ¥${(s.fixedWorkerAmount / 100).toFixed(2)}`;
                return (
                  <tr key={s.id}>
                    <td style={td}>{s.name}</td>
                    <td style={td}>{s.merchant.name}</td>
                    <td style={td}>
                      {s.strategyType === "percentage" ? "按比例" : "固定金额"}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: "#374151" }}>
                      {rule}
                    </td>
                    <td style={td}>
                      <StatusBadge
                        label={s.enabled ? "启用" : "停用"}
                        tone={s.enabled ? "green" : "gray"}
                      />
                    </td>
                    <td style={td}>{s.createdAt.toLocaleString("zh-CN")}</td>
                    <td style={td}>
                      <Link
                        href={`/commission-strategies/${s.id}/edit`}
                        style={{
                          color: "#2563eb",
                          fontSize: 13,
                          textDecoration: "none",
                        }}
                      >
                        编辑
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
