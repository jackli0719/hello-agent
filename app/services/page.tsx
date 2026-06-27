import Link from "next/link";
import { card, th, td } from "@/components/ui";
import { listCategories, listSkus } from "@/src/lib/services";

interface PageProps {
  searchParams: Promise<{ category?: string; sku?: string; updated?: string }>;
}

const YES_NO: Record<string, { label: string; bg: string; fg: string }> = {
  true: { label: "已启用", bg: "#dcfce7", fg: "#15803d" },
  false: { label: "已禁用", bg: "#f3f4f6", fg: "#6b7280" },
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

export default async function ServicesPage({ searchParams }: PageProps) {
  const { category, sku, updated } = await searchParams;
  const [categories, skus] = await Promise.all([listCategories(), listSkus()]);

  // 按 categoryCode 分组 SKU
  const skuByCategory = new Map<string, typeof skus>();
  for (const s of skus) {
    const arr = skuByCategory.get(s.categoryCode) ?? [];
    arr.push(s);
    skuByCategory.set(s.categoryCode, arr);
  }

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
        <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>服务品类 / SKU</h1>
        <p style={{ color: "#6b7280", margin: "0 0 20px 0", fontSize: 14 }}>
          {categories.length} 个品类 · {skus.length} 个 SKU
        </p>

        {(() => {
          // 多个 query 同时存在时只显示一个横幅 — 用「最后写」语义
          // updated 优先于 sku，sku 优先于 category
          let banner: { message: string } | null = null;
          if (updated) banner = { message: `✓ SKU 更新成功` };
          else if (sku) banner = { message: `✓ SKU 创建成功` };
          else if (category) banner = { message: `✓ 品类创建成功` };
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

        {/* 类目卡片 + SKU 折叠列表 */}
        <section style={{ ...card, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>服务品类</h2>
            <Link
              href="/services/categories/new"
              style={{
                padding: "6px 14px",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 6,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              + 新增品类
            </Link>
          </div>

          {categories.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af" }}>
              暂无品类
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>名称</th>
                  <th style={th}>编码</th>
                  <th style={th}>SKU 数</th>
                  <th style={th}>状态</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>{c.name}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{c.categoryCode}</td>
                    <td style={td}>{skuByCategory.get(c.categoryCode)?.length ?? 0}</td>
                    <td style={td}><StatusBadge enabled={c.enabled} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* SKU 卡片 — 按类目分组，每个类目默认显示前 3 个 SKU */}
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>服务 SKU</h2>
            <Link
              href="/services/skus/new"
              style={{
                padding: "6px 14px",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 6,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              + 新增 SKU
            </Link>
          </div>

          {skus.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af" }}>
              暂无 SKU
            </div>
          ) : (
            <div>
              {categories.map((c) => {
                const items = skuByCategory.get(c.categoryCode) ?? [];
                // 空类目不展示折叠
                if (items.length === 0) return null;
                return (
                  <details
                    key={c.id}
                    style={{ borderTop: "1px solid #e5e7eb" }}
                    open
                  >
                    <summary
                      style={{
                        cursor: "pointer",
                        padding: "12px 0",
                        fontSize: 14,
                        fontWeight: 500,
                        color: "#111827",
                        listStyle: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>
                        {c.name} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({c.categoryCode})</span>
                      </span>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>
                        {items.length} 个 SKU
                      </span>
                    </summary>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={th}>名称</th>
                          <th style={th}>编码</th>
                          <th style={th}>价格</th>
                          <th style={th}>状态</th>
                          <th style={th}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((s) => (
                          <tr key={s.id}>
                            <td style={td}>{s.name}</td>
                            <td style={{ ...td, fontFamily: "monospace" }}>{s.skuCode}</td>
                            <td style={td}>¥{s.basePriceYuan.toFixed(2)}</td>
                            <td style={td}><StatusBadge enabled={s.enabled} /></td>
                            <td style={td}>
                              <Link
                                href={`/services/skus/${s.id}/edit`}
                                style={{ color: "#2563eb", fontSize: 13, textDecoration: "none" }}
                              >
                                编辑
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}