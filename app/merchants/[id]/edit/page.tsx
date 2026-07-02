import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { card, StatusBadge, td, th } from "@/components/ui";
import {
  bindMerchantAreaAction,
  toggleMerchantAreaAction,
  updateMerchantAction,
} from "@/app/merchants/actions";
import { DEFAULT_LANDING, getCurrentUser } from "@/src/lib/auth";
import {
  getMerchant,
  listAvailablePlatformAreas,
  listMerchantAreas,
} from "@/src/lib/merchants";
import { ensureCsrfCookie } from "@/src/lib/csrf";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; bound?: string; toggled?: string }>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

function Field({
  label,
  name,
  defaultValue,
  required = true,
  maxLength = 80,
  pattern,
}: {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  maxLength?: number;
  pattern?: string;
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        {label}
      </div>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        pattern={pattern}
        style={inputStyle}
      />
    </label>
  );
}

export default async function EditMerchantPage({
  params,
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect(DEFAULT_LANDING[user.role]);

  const [{ id }, { error, bound, toggled }, csrfToken] = await Promise.all([
    params,
    searchParams,
    ensureCsrfCookie(),
  ]);
  const [merchant, merchantAreas, availableAreas] = await Promise.all([
    getMerchant(id),
    listMerchantAreas(id),
    listAvailablePlatformAreas(id),
  ]);
  if (!merchant) notFound();

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
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/merchants"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          ← 返回商家列表
        </Link>
      </div>
      <h1 style={{ fontSize: 24, margin: "0 0 20px 0" }}>
        编辑商家：{merchant.name}
      </h1>

      <section style={{ ...card, maxWidth: 720 }}>
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
        {(bound || toggled) && (
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
            {bound ? "区域绑定成功" : "区域绑定状态已更新"}
          </div>
        )}
        <form action={updateMerchantAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="id" value={merchant.id} />
          <Field label="商家名称" name="name" defaultValue={merchant.name} />
          <Field
            label="联系人"
            name="contactName"
            defaultValue={merchant.contactName}
            maxLength={50}
          />
          <Field
            label="电话"
            name="phone"
            defaultValue={merchant.phone}
            maxLength={11}
            pattern="1[0-9]{10}"
          />
          <label style={{ display: "block", marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
              状态
            </div>
            <select
              name="status"
              defaultValue={merchant.status}
              style={inputStyle}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </label>

          {/* [任务 4] 邀请码展示 + 启用开关 */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                color: "#374151",
                fontWeight: 500,
                marginBottom: 6,
              }}
            >
              邀请码{" "}
              <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 400 }}>
                （师傅 /worker/join 入驻用）
              </span>
            </label>
            <input
              type="text"
              value={merchant.inviteCode}
              readOnly
              style={{
                ...inputStyle,
                fontFamily: "monospace",
                letterSpacing: 1,
                background: "#f3f4f6",
                color: "#374151",
              }}
            />
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
            }}
          >
            <input
              type="checkbox"
              name="inviteCodeEnabled"
              value="true"
              defaultChecked={merchant.inviteCodeEnabled}
              style={{ width: 16, height: 16 }}
            />
            <span
              style={{
                fontSize: 13,
                color: "#374151",
                fontWeight: 500,
              }}
            >
              邀请码启用（禁用后师傅无法通过此码入驻）
            </span>
          </label>
          <Field
            label="省"
            name="province"
            defaultValue={merchant.province}
            maxLength={50}
          />
          <Field
            label="市"
            name="city"
            defaultValue={merchant.city}
            maxLength={50}
          />
          <Field
            label="区县"
            name="district"
            defaultValue={merchant.district}
            maxLength={50}
          />
          <Field
            label="街道 / 乡镇"
            name="street"
            defaultValue={merchant.street}
            maxLength={50}
          />
          <Field
            label="详细地址"
            name="addressDetail"
            defaultValue={merchant.addressDetail}
            required={false}
            maxLength={200}
          />
          <button
            type="submit"
            style={{
              padding: "9px 18px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            保存
          </button>
        </form>
      </section>

      <section style={{ ...card, maxWidth: 920 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 14px 0" }}>合作区域绑定</h2>
        {/* 风险 #3: 商家已停用时,绑定按钮置灰 + tooltip */}
        {merchant.status !== "active" && (
          <div
            style={{
              padding: "8px 12px",
              background: "#fef3c7",
              color: "#92400e",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            商家已停用,不能绑定新合作区域(已绑定区域仍可启用/停用)
          </div>
        )}
        <form
          action={bindMerchantAreaAction}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="merchantId" value={merchant.id} />
          <select
            name="platformAreaId"
            required
            disabled={
              availableAreas.length === 0 || merchant.status !== "active"
            }
            style={{ ...inputStyle, maxWidth: 460 }}
            defaultValue=""
          >
            <option value="">选择平台合作区域</option>
            {availableAreas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.province} / {area.city} / {area.district} / {area.street}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={
              availableAreas.length === 0 || merchant.status !== "active"
            }
            title={
              merchant.status !== "active"
                ? "商家已停用,不能绑定新合作区域"
                : availableAreas.length === 0
                  ? "暂无可绑定的平台合作区域"
                  : ""
            }
            style={{
              padding: "9px 18px",
              background:
                availableAreas.length === 0 || merchant.status !== "active"
                  ? "#9ca3af"
                  : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor:
                availableAreas.length === 0 || merchant.status !== "active"
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            绑定区域
          </button>
        </form>

        {merchantAreas.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 14 }}>暂无绑定区域</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>省</th>
                <th style={th}>市</th>
                <th style={th}>区县</th>
                <th style={th}>街道 / 乡镇</th>
                <th style={th}>绑定状态</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {merchantAreas.map((area) => (
                <tr key={area.id}>
                  <td style={td}>{area.platformArea.province}</td>
                  <td style={td}>{area.platformArea.city}</td>
                  <td style={td}>{area.platformArea.district}</td>
                  <td style={td}>{area.platformArea.street}</td>
                  <td style={td}>
                    <StatusBadge
                      label={area.enabled ? "启用" : "停用"}
                      tone={area.enabled ? "green" : "gray"}
                    />
                  </td>
                  <td style={td}>
                    <form action={toggleMerchantAreaAction}>
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <input type="hidden" name="id" value={area.id} />
                      <input
                        type="hidden"
                        name="merchantId"
                        value={merchant.id}
                      />
                      <input
                        type="hidden"
                        name="enabled"
                        value={area.enabled ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        style={{
                          padding: "6px 12px",
                          background: "#fff",
                          color: "#2563eb",
                          border: "1px solid #bfdbfe",
                          borderRadius: 6,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        {area.enabled ? "停用" : "启用"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
