#!/usr/bin/env bash
# =============================================================================
# 化学部检测报告系统 — 轻量运行 / 更新脚本
# =============================================================================
# 与 install-ubuntu.sh 的区别：本脚本【不重装环境】、【不碰数据库数据】、
# 【不覆盖任何 config/*.local.json】、【不动 fonts/ 与上传文件】。
# 首次部署仍用 install-ubuntu.sh；之后日常启动 / 重启 / 看日志 / 更新代码都用本脚本。
#
# 用法：
#   bash scripts/run.sh start      启动服务（systemd；无 systemd 则提示用 serve）
#   bash scripts/run.sh stop       停止服务
#   bash scripts/run.sh restart    重启服务（改了服务端 .ts / 主题 lib.typ 后用）
#   bash scripts/run.sh status     查看服务状态
#   bash scripts/run.sh logs       实时日志（Ctrl+C 退出）
#   bash scripts/run.sh serve      前台运行（不经 systemd，调试用，Ctrl+C 退出）
#   bash scripts/run.sh build      仅重新构建前端 + 重启（只改了前端时用）
#   bash scripts/run.sh update     更新代码后一条龙：装依赖→链主题→迁移→构建→重启
#
# 环境变量：APP_PORT(默认5173) SERVICE_NAME(默认cdr-demo)
# =============================================================================
set -euo pipefail

APP_PORT="${APP_PORT:-5173}"
SERVICE_NAME="${SERVICE_NAME:-cdr-demo}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# root 直接执行，普通用户加 sudo
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[警告] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

# systemd 服务是否存在（决定 start/restart 走 systemctl 还是提示前台运行）
has_service() { systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; }

# 预检：数据库连接配置必须在（被 .gitignore 排除，不随代码走——复制代码常把它弄丢）。
# 缺它会在 migrate / 启动时报 "SCRAM ... client password must be a string"，这里提前给出可操作提示。
check_db_config() {
  local f="config/database.local.json"
  if [ ! -f "$f" ]; then
    die "缺少 $f —— 数据库连接配置丢失（它被 .gitignore 排除，复制/同步代码时常被覆盖或删掉）。
请用服务器 PostgreSQL 的真实账号密码创建它，例如：
  cat > $f <<'JSON'
  { \"host\": \"localhost\", \"port\": 5432, \"database\": \"cdr_demo\", \"user\": \"cdr\", \"password\": \"你的数据库密码\" }
  JSON
若不记得密码，可重置：sudo -u postgres psql -c \"ALTER ROLE cdr PASSWORD '新密码';\" 再把新密码写进上面文件。
创建后重新运行本命令。"
  fi
  if ! grep -q '"password"[[:space:]]*:[[:space:]]*"[^"]' "$f"; then
    die "$f 里的 password 为空 —— 请填入数据库密码后重试。"
  fi
}

cmd_serve() {
  warn "前台运行（不经 systemd），关闭终端即停止。正式运行请用 start/restart。"
  log "前台启动：端口 $APP_PORT"
  exec env PORT="$APP_PORT" HOST=0.0.0.0 pnpm serve
}

cmd_start() {
  if has_service; then
    log "启动 systemd 服务 $SERVICE_NAME"
    $SUDO systemctl start "$SERVICE_NAME"
    $SUDO systemctl --no-pager status "$SERVICE_NAME" | head -n 6 || true
  else
    warn "未安装 systemd 服务 $SERVICE_NAME（首次部署请先跑 install-ubuntu.sh，或用本脚本 serve 前台运行）。"
    cmd_serve
  fi
}

cmd_stop() {
  has_service || die "未安装 systemd 服务 $SERVICE_NAME（前台运行用 Ctrl+C 停止）。"
  log "停止服务 $SERVICE_NAME"
  $SUDO systemctl stop "$SERVICE_NAME"
}

cmd_restart() {
  has_service || die "未安装 systemd 服务 $SERVICE_NAME（前台运行请先 Ctrl+C 再 serve）。"
  log "重启服务 $SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME"
  sleep 2
  $SUDO systemctl --no-pager status "$SERVICE_NAME" | head -n 6 || true
}

cmd_status() {
  has_service || die "未安装 systemd 服务 $SERVICE_NAME。"
  $SUDO systemctl --no-pager --full status "$SERVICE_NAME" || true
}

cmd_logs() {
  has_service || die "未安装 systemd 服务 $SERVICE_NAME（前台运行的日志直接看终端）。"
  log "实时日志（Ctrl+C 退出）"
  $SUDO journalctl -u "$SERVICE_NAME" -f
}

cmd_build() {
  log "重新构建前端 (client/dist)"
  pnpm build
  if has_service; then cmd_restart; else warn "无 systemd 服务，构建完请自行 serve。"; fi
}

cmd_update() {
  log "更新代码后一条龙（不动数据库数据、不覆盖配置、不动字体）"
  check_db_config   # 预检：缺 database.local.json 就早停并给出修复指引（而非到 migrate 才报 SCRAM）
  log "1/4 安装依赖（根 + client + server；无变化时很快）"
  pnpm install
  ( cd client && pnpm install )
  ( cd server && pnpm install )
  log "2/4 链接 Typst 本地主题包（幂等，确保改过的 lib.typ 生效）"
  bash scripts/install-typst-packages.sh
  log "3/4 数据库迁移（增量、幂等，不动已有数据）"
  pnpm migrate
  log "4/4 构建前端"
  pnpm build
  if has_service; then cmd_restart; else warn "无 systemd 服务，更新完请自行 serve。"; fi
  log "✅ 更新完成"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  serve)   cmd_serve ;;
  build)   cmd_build ;;
  update)  cmd_update ;;
  *)
    cat <<EOF
用法: bash scripts/run.sh <命令>

  start      启动服务（systemd）
  stop       停止服务
  restart    重启服务（改了服务端 .ts / 主题 lib.typ 后用）
  status     查看服务状态
  logs       实时日志（Ctrl+C 退出）
  serve      前台运行（无 systemd，调试用）
  build      仅重新构建前端 + 重启（只改了前端时用）
  update     更新代码后一条龙：装依赖→链主题→迁移→构建→重启

环境变量: APP_PORT(默认5173) SERVICE_NAME(默认cdr-demo)
EOF
    exit 1 ;;
esac
