"use client";

// 共享表单（create / edit 复用）
// - select 选商家 + 策略类型（percentage/fixed）
// - percentage：3 个比例 input 严格 = 1
// - fixed：3 个金额 input 都 >= 0
// - enabled checkbox

import { useState } from "react";
import {
  createCommissionStrategyAction,
  updateCommissionStrategyAction,
} from "./actions";

interface MerchantOption {
  id: string;
  name: string;
}

interface Props {
  mode: "create" | "edit";
  csrfToken: string;
  merchants: MerchantOption[];
  preselectMerchantId?: string;
  initial?: {
    id: string;
    merchantId: string;
    name: string;
    strategyType: "percentage" | "fixed";
    platformRate: number;
    merchantRate: number;
    workerRate: number;
    fixedPlatformAmount: number;
    fixedMerchantAmount: number;
    fixedWorkerAmount: number;
    enabled: boolean;
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#374151",
  fontWeight: 500,
  marginBottom: 6,
};

export function CommissionStrategyForm({
  mode,
  csrfToken,
  merchants,
  preselectMerchantId,
  initial,
}: Props) {
  const [strategyType, setStrategyType] = useState<"percentage" | "fixed">(
    initial?.strategyType ?? "percentage",
  );
  const [platformRate, setPlatformRate] = useState(
    String((initial?.platformRate ?? 0.1) * 100),
  );
  const [merchantRate, setMerchantRate] = useState(
    String((initial?.merchantRate ?? 0.2) * 100),
  );
  const [workerRate, setWorkerRate] = useState(
    String((initial?.workerRate ?? 0.7) * 100),
  );

  const p = parseFloat(platformRate) || 0;
  const m = parseFloat(merchantRate) || 0;
  const w = parseFloat(workerRate) || 0;
  const sum = p + m + w;
  const isValidSum = Math.abs(sum - 100) <= 0.1;

  return (
    <form
      action={
        mode === "create"
          ? createCommissionStrategyAction
          : updateCommissionStrategyAction
      }
    >
      <input type="hidden" name="_csrf" value={csrfToken} />
      {mode === "edit" && initial && (
        <input type="hidden" name="id" value={initial.id} />
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>归属商家 *</label>
        <select
          name="merchantId"
          required
          defaultValue={initial?.merchantId ?? preselectMerchantId ?? ""}
          style={inputStyle}
        >
          <option value="">— 请选择 —</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>策略名 *</label>
        <input
          type="text"
          name="name"
          required
          maxLength={50}
          defaultValue={initial?.name ?? ""}
          placeholder="如：默认策略 / 保洁专项"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>策略类型 *</label>
        <select
          name="strategyType"
          value={strategyType}
          onChange={(e) =>
            setStrategyType(e.target.value as "percentage" | "fixed")
          }
          style={inputStyle}
        >
          <option value="percentage">按比例（三方比例之和 = 100%）</option>
          <option value="fixed">固定金额（三方金额，单位：分）</option>
        </select>
      </div>

      {strategyType === "percentage" ? (
        <>
          <div
            style={{
              padding: 12,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "1fr 1fr 1fr",
              }}
            >
              <div>
                <label style={labelStyle}>平台比例（%）</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={platformRate}
                  onChange={(e) => setPlatformRate(e.target.value)}
                  required
                  style={inputStyle}
                />
                {/* 隐藏字段：实际传给 server 的值是 0-1（schema 期望） */}
                <input type="hidden" name="platformRate" value={p / 100} />
              </div>
              <div>
                <label style={labelStyle}>商家比例（%）</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={merchantRate}
                  onChange={(e) => setMerchantRate(e.target.value)}
                  required
                  style={inputStyle}
                />
                <input type="hidden" name="merchantRate" value={m / 100} />
              </div>
              <div>
                <label style={labelStyle}>师傅比例（%）</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={workerRate}
                  onChange={(e) => setWorkerRate(e.target.value)}
                  required
                  style={inputStyle}
                />
                <input type="hidden" name="workerRate" value={w / 100} />
              </div>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: isValidSum ? "#15803d" : "#b91c1c",
              }}
            >
              {isValidSum
                ? `✓ 三方比例之和 = ${sum.toFixed(2)}%（合法）`
                : `✗ 三方比例之和 = ${sum.toFixed(2)}%（必须 = 100%）`}
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: 12,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "1fr 1fr 1fr",
            }}
          >
            <div>
              <label style={labelStyle}>平台金额（分）</label>
              <input
                type="number"
                name="fixedPlatformAmount"
                min={0}
                defaultValue={initial?.fixedPlatformAmount ?? 0}
                required
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>商家金额（分）</label>
              <input
                type="number"
                name="fixedMerchantAmount"
                min={0}
                defaultValue={initial?.fixedMerchantAmount ?? 0}
                required
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>师傅金额（分）</label>
              <input
                type="number"
                name="fixedWorkerAmount"
                min={0}
                defaultValue={initial?.fixedWorkerAmount ?? 0}
                required
                style={inputStyle}
              />
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "#374151",
            fontWeight: 500,
          }}
        >
          <input
            type="checkbox"
            name="enabled"
            value="true"
            defaultChecked={initial?.enabled ?? true}
            style={{ width: 16, height: 16 }}
          />
          启用（不勾则不参与配置）
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button
          type="submit"
          disabled={strategyType === "percentage" && !isValidSum}
          style={{
            padding: "9px 18px",
            background:
              strategyType === "percentage" && !isValidSum
                ? "#9ca3af"
                : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor:
              strategyType === "percentage" && !isValidSum
                ? "not-allowed"
                : "pointer",
          }}
        >
          保存
        </button>
        <a
          href="/commission-strategies"
          style={{
            padding: "9px 18px",
            background: "#fff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          取消
        </a>
      </div>
    </form>
  );
}
