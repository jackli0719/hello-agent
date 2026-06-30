// 登录限流 — [v0.5.0] 修 ADR-013 A3 P0 风险
//
// 设计：
// - in-memory Map（演示期）。生产换 Redis：把 checkAndRecord → Redis INCR
// - key: IP（dev 退化为 'local'）
// - 阈值: 5 次/分钟，锁定 60 秒
// - 失败定义: authenticate 返回 null（账号不存在 + 密码错 都算）
// - 成功登录: clearAttempts（正常用户体验）
//
// 不做（按需求 / 演示期）：
// - 分布式限流（需要 Redis）
// - IP 黑名单 / 白名单
// - 验证码（按需求不做）

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000; // 1 分钟窗口
const LOCKOUT_MS = 60 * 1000; // 锁定 60 秒

interface AttemptRecord {
  count: number;
  firstAt: number;
  lockedUntil: number | null;
}

// in-memory store（演示期单实例 OK；生产换 Redis）
const store = new Map<string, AttemptRecord>();

/** 取客户端 IP（dev 退化为 'local'） */
export function getClientIp(headers?: Headers): string {
  if (!headers) return "local";
  // Vercel / Cloudflare / nginx 标准头
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "local";
  return headers.get("x-real-ip") ?? "local";
}

/** 检查 IP 是否在锁定期内 */
export function isLocked(ip: string): { locked: boolean; remainingMs: number } {
  const rec = store.get(ip);
  if (!rec) return { locked: false, remainingMs: 0 };
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return { locked: true, remainingMs: rec.lockedUntil - Date.now() };
  }
  return { locked: false, remainingMs: 0 };
}

/** 记录一次失败尝试，返回是否触发锁定 */
export function recordFailure(ip: string): {
  locked: boolean;
  remainingMs: number;
  attemptsLeft: number;
} {
  const now = Date.now();
  let rec = store.get(ip);

  // 窗口已过 → 重置
  if (rec && now - rec.firstAt > WINDOW_MS) {
    rec = undefined;
  }

  if (!rec) {
    rec = { count: 0, firstAt: now, lockedUntil: null };
    store.set(ip, rec);
  }

  rec.count += 1;

  // 超过阈值 → 锁定
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS;
    return { locked: true, remainingMs: LOCKOUT_MS, attemptsLeft: 0 };
  }

  return {
    locked: false,
    remainingMs: 0,
    attemptsLeft: MAX_ATTEMPTS - rec.count,
  };
}

/** 成功登录后清零 */
export function clearAttempts(ip: string): void {
  store.delete(ip);
}

/** 单元测试用 — 清空所有记录 */
export function _resetAllForTests(): void {
  store.clear();
}
