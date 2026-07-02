// middleware 跳转规则测试 — 不连 DB，覆盖 stale session cookie 的跳转回归。

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { SESSION_COOKIE } from "@/src/lib/auth";

function request(pathname: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("middleware", () => {
  // # spec: stale session cookie — 登录页必须放行，否则目标页跳 /login 后会被错误送回 /dashboard
  it("访问 /login 且存在 Fe26 cookie → 放行，不跳 dashboard", () => {
    const res = middleware(
      request("/login", `${SESSION_COOKIE}=Fe26.2**stale-session`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // # spec: 受保护路径未登录 — 跳登录页，并保留 next
  it("未登录访问受保护路径 → /login?next=原路径", () => {
    const res = middleware(request("/platform-areas"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fplatform-areas");
  });

  // # spec: [任务 12] /payout-records 受保护，未登录跳登录页
  it("未登录访问 /payout-records → /login?next=%2Fpayout-records", () => {
    const res = middleware(request("/payout-records"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fpayout-records");
  });

  // # spec: [任务 13] /withdraw-requests 受保护，未登录跳登录页
  it("未登录访问 /withdraw-requests → /login?next=%2Fwithdraw-requests", () => {
    const res = middleware(request("/withdraw-requests"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fwithdraw-requests");
  });

  // # spec: [任务 14] /finance-ledgers 受保护，未登录跳登录页
  it("未登录访问 /finance-ledgers → /login?next=%2Ffinance-ledgers", () => {
    const res = middleware(request("/finance-ledgers"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Ffinance-ledgers");
  });
});
