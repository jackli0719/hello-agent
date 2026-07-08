// 师傅通过商家邀请码入驻 — /worker/join
//
// MVP 范围（任务 4）：
// 1. 师傅输入：姓名 / 手机 / 技能 / 邀请码
// 2. 提交后：
//    - 查邀请码 → 商家存在 + active + inviteCodeEnabled
//    - 校验师傅姓名/手机/技能
//    - 手机号对应 Master：
//      - 已绑定商家 → 拒绝重复绑定
//      - 未绑定 → 绑到该商家
//    - 手机号不存在 → 创建 Master，绑定到该商家
// 3. 成功展示："已成功绑定商家：{商家名称}"
// 4. 失败展示具体原因（邀请码无效 / 商家 inactive / 邀请码禁用 / 师傅已绑定）

import Link from "next/link";
import { JoinWorkerForm } from "./JoinWorkerForm";

export default function JoinWorkerPage() {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        background: "#f7f8fa",
        padding: "16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        color: "#111827",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "16px",
          marginBottom: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>师傅入驻</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          通过商家邀请码绑定商家，开始接单
        </div>
      </header>

      <Link
        href="/"
        style={{
          display: "inline-block",
          fontSize: 13,
          color: "#2563eb",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        ← 返回首页
      </Link>

      <JoinWorkerForm />
    </div>
  );
}
