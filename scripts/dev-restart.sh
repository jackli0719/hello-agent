#!/usr/bin/env bash
#
# dev:restart — 一键重启 dev server，修 .next 状态错乱
#
# 背景：FEEDBACK-self-v0.10.0 R2 记录的 Next 15 dev 缓存坑
#  - 半清 .next → page.js 引用 vs vendor-chunks 文件不一致 → 500
#  - dev 跑久了 + 中途改文件 → webpack cache 漂移 → 报 "Cannot find module './XXXX.js'"
#
# 现象（任一即触发）：
#   - GET /xxx 报 "Cannot find module './vendor-chunks/<name>.js'"
#   - GET /xxx 报 "Cannot find module './7627.js'"（webpack 报"最深找不到"，不是真 7627）
#   - ls .next/server/vendor-chunks/ 文件数 < 5（应有 7：@swc/bcryptjs/cookie/iron-session/iron-webcrypto/next/uncrypto）
#   - 改 schema/文件后 dev server 状态混乱
#
# 用法：
#   npm run dev:restart
#   或：bash scripts/dev-restart.sh
#
# 流程：
#   1. pkill -f "next dev"
#   2. rm -rf .next（全清，不只清 .next/types）
#   3. nohup npm run dev > /tmp/dev-server.log 2>&1 &
#   4. 等 8 秒 + 验证 /login 200 + vendor-chunks ≥ 5
#
# 注意：
#   - 此操作**丢失 dev 编译缓存**，下次访问页面会重新编译（首次 1-3s）
#   - **不丢**业务数据（prisma DB / .env 都不动）
#   - 浏览器 session cookie 保留（o2o_session 在客户端）

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

# ============================================================
# 0. 在项目根目录运行
# ============================================================
cd "$(dirname "$0")/.."

# ============================================================
# 1. 杀掉旧 dev server
# ============================================================
if pgrep -f "next dev" >/dev/null 2>&1; then
  warn "杀掉旧 dev server"
  pkill -f "next dev" || true
  sleep 2
else
  info "没有 dev server 在跑"
fi

# ============================================================
# 2. 清掉 .next
# ============================================================
if [ -d .next ]; then
  warn "删除 .next 目录"
  rm -rf .next
  info ".next 已清空"
else
  info ".next 不存在，跳过"
fi

# ============================================================
# 3. 启动 dev server
# ============================================================
info "启动 dev server..."
nohup npm run dev > /tmp/dev-server.log 2>&1 &
DEV_PID=$!
echo "  PID=${DEV_PID}"

# ============================================================
# 4. 等 dev server ready
# ============================================================
info "等 dev server ready（最多 30s）..."
READY=false
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 2
  if curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/login 2>/dev/null | grep -q "^200$"; then
    READY=true
    break
  fi
done

if [ "$READY" != "true" ]; then
  err "dev server 30s 内未 ready — 看 /tmp/dev-server.log"
  echo ""
  echo "最近 30 行日志："
  tail -30 /tmp/dev-server.log
  exit 1
fi

info "dev server ready"

# ============================================================
# 5. 验证 vendor-chunks 完整
# ============================================================
# 触发 /login 编译（middleware + 基础 chunk）
sleep 2
VENDOR_COUNT=$(ls .next/server/vendor-chunks/ 2>/dev/null | wc -l | tr -d ' ')

if [ "$VENDOR_COUNT" -lt 5 ]; then
  warn "vendor-chunks 只有 ${VENDOR_COUNT} 个文件 — 状态可能还是错的"
  echo "  期望 ≥ 5（@swc / bcryptjs / cookie / iron-session / iron-webcrypto / next / uncrypto）"
  echo "  如果是 0-1 个，访问一个页面后再看（page 编译会触发 vendor chunk 生成）"
else
  info "vendor-chunks 完整（${VENDOR_COUNT} 个）"
fi

# ============================================================
# 6. 触发 1 个 page 编译做冒烟
# ============================================================
info "冒烟：访问 /login 触发 middleware 编译"
curl -sS -o /dev/null http://localhost:3000/login

# 触发 /merchants（看完整 vendor chunks）
warn "冒烟：访问 /merchants 触发 page 编译（首次会慢 1-3s）"
curl -sS -b "o2o_session=fake" -o /dev/null http://localhost:3000/merchants 2>/dev/null || true

# 等编译结束
sleep 3

echo ""
info "✅ dev server 重启完成"
echo ""
echo "日志：tail -f /tmp/dev-server.log"
echo "进程：ps aux | grep 'next dev' | grep -v grep"
echo ""
