#!/usr/bin/env bash
#
# db:start — 一键恢复本地开发数据库
#
# 流程：
#   1. 检查 docker compose 容器状态
#   2. 如果没起：docker compose up -d
#   3. 等 Postgres ready（healthcheck）
#   4. 跑 prisma migrate deploy（应用 schema）
#   5. 跑 db:seed（如果数据空）
#
# 用法：
#   npm run db:start
#
# 配套：
#   - docker-compose.yml 定义容器配置
#   - .env 配 DATABASE_URL

set -e

# ============================================================
# 颜色
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

# ============================================================
# 0. 加载 .env
# ============================================================
if [ ! -f .env ]; then
  err ".env 文件不存在 — 请先 cp .env.example .env 并填入 DATABASE_URL"
  exit 1
fi

# ============================================================
# 1. 检查 docker compose
# ============================================================
if ! command -v docker >/dev/null 2>&1; then
  err "docker 未安装"
  exit 1
fi

# ============================================================
# 2. 检查 / 启动容器
# ============================================================
CONTAINER_NAME="o2o-pg-keepalive"

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  info "容器 ${CONTAINER_NAME} 已在运行"
elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  warn "容器 ${CONTAINER_NAME} 存在但未运行 — 启动中"
  docker start "${CONTAINER_NAME}"
else
  info "容器 ${CONTAINER_NAME} 不存在 — 启动新容器"
  docker compose up -d
fi

# ============================================================
# 3. 等 Postgres ready
# ============================================================
info "等待 Postgres ready..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "${CONTAINER_NAME}" pg_isready -U o2o >/dev/null 2>&1; then
    info "Postgres ready"
    break
  fi
  if [ "$i" = "10" ]; then
    err "Postgres 启动超时"
    exit 1
  fi
  sleep 2
done

# ============================================================
# 4. Apply migrations
# ============================================================
info "应用 schema migrations..."
npx prisma migrate deploy >/dev/null 2>&1
info "Migrations 已应用"

# ============================================================
# 5. 检查是否需要 seed
# ============================================================
# 用 psql 查 ServiceCategory 行数
COUNT=$(docker exec "${CONTAINER_NAME}" psql -U o2o -d o2o -tAc "SELECT COUNT(*) FROM \"ServiceCategory\"" 2>/dev/null || echo "0")

if [ "${COUNT}" = "0" ]; then
  warn "数据库为空 — 灌种子"
  npm run db:seed
else
  info "数据库已有 ${COUNT} 个 ServiceCategory — 跳过 seed"
fi

echo ""
info "✅ 本地数据库就绪 — 可以跑 npm run dev"
