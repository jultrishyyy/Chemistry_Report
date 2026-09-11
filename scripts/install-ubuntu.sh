#!/usr/bin/env bash
# =============================================================================
# 化学部检测报告系统 — Ubuntu 24.04 一键安装脚本
# =============================================================================
# 在一台全新的 Ubuntu 24.04 LTS 服务器上，从零装好运行本系统所需的全部环境
# 并把应用跑起来（单进程：一个端口同时出 UI + API）。
#
# 安装内容：Node.js / pnpm / PostgreSQL / Typst / LibreOffice + 应用依赖、
#           Typst 主题包、数据库与表、前端构建、（可选）systemd 开机自启。
#
# 不安装：Conda / Python —— 系统运行时完全用不到（只有开发期的
#         scripts/convert-xls.sh 批转工具才需要，部署生产无需）。
#
# 用法：
#   - root 用户直接运行：           bash scripts/install-ubuntu.sh
#   - 或有 sudo 的普通用户运行：    bash scripts/install-ubuntu.sh
#   - 环境变量可覆盖默认值，例如：
#       APP_PORT=8080 DB_PASSWORD='强密码' bash scripts/install-ubuntu.sh
#
# 详细说明见同目录上一级的《部署说明-Ubuntu.md》。
# =============================================================================
set -euo pipefail

# ----------------------------- 可调参数（环境变量可覆盖）---------------------
APP_PORT="${APP_PORT:-5173}"            # 对外服务端口
DB_NAME="${DB_NAME:-cdr_demo}"          # 数据库名
DB_USER="${DB_USER:-cdr}"               # 数据库登录角色
DB_PASSWORD="${DB_PASSWORD:-cdr_demo_pwd}"  # 数据库密码（生产请务必改掉！）
NODE_MAJOR="${NODE_MAJOR:-22}"          # Node.js 主版本（≥20 即可，建议 22 LTS）
PNPM_VERSION="${PNPM_VERSION:-10.25.0}" # pnpm 版本（与 package.json packageManager 对齐）
TYPST_VERSION="${TYPST_VERSION:-v0.14.2}"
SETUP_SYSTEMD="${SETUP_SYSTEMD:-1}"     # 1=安装 systemd 服务并开机自启；0=跳过
SERVICE_NAME="${SERVICE_NAME:-cdr-demo}"
# Ubuntu 一键安装面向真实服务器，缺省必须使用 server 接口配置；如确实只部署演示环境，
# 可显式传 INTEGRATIONS_PROFILE=demo。不能依赖应用自身缺省值，否则会静默进入 mock。
INTEGRATIONS_PROFILE="${INTEGRATIONS_PROFILE:-server}"

# 国内镜像加速（默认开启，适合内网/国内服务器；CN_MIRROR=0 用官方源）
CN_MIRROR="${CN_MIRROR:-1}"
APT_MIRROR="${APT_MIRROR:-mirrors.tuna.tsinghua.edu.cn}"        # apt 源（不通可换 mirrors.aliyun.com）
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"  # npm/pnpm 源（淘宝）
GH_PROXY="${GH_PROXY:-https://mirror.ghproxy.com/}"            # GitHub 下载加速前缀（用于 Typst）

# ----------------------------- 路径与基础检查 -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RUN_USER="$(id -un)"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[警告] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

case "$INTEGRATIONS_PROFILE" in
  server|demo) ;;
  *) die "INTEGRATIONS_PROFILE 只能是 server 或 demo（当前：$INTEGRATIONS_PROFILE）" ;;
esac

# 以 root 运行时不需要 sudo；普通用户则要求 sudo。SUDO 变量统一前缀提权命令。
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  as_postgres() { runuser -u postgres -- "$@"; }   # root：用 runuser 切到 postgres
  warn "正在以 root 运行：应用文件与 systemd 服务都将归属 root（内网服务器常见，可接受）。"
else
  command -v sudo >/dev/null 2>&1 || die "当前为普通用户但未找到 sudo —— 请改用 root 运行，或先安装 sudo。"
  SUDO="sudo"
  as_postgres() { sudo -u postgres "$@"; }
fi
command -v apt-get >/dev/null 2>&1 || die "这个脚本只适用于 Debian/Ubuntu（apt）系统。"

# 架构（决定 Typst 二进制下载地址）
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  TYPST_ASSET="typst-x86_64-unknown-linux-musl" ;;
  aarch64) TYPST_ASSET="typst-aarch64-unknown-linux-musl" ;;
  *) die "不支持的 CPU 架构：$ARCH（仅 x86_64 / aarch64）" ;;
esac

log "安装目标确认"
echo "  项目目录   : $PROJECT_DIR"
echo "  运行用户   : $RUN_USER"
echo "  服务端口   : $APP_PORT"
echo "  数据库     : $DB_NAME (用户 $DB_USER)"
echo "  Node 版本  : $NODE_MAJOR.x    pnpm: $PNPM_VERSION    Typst: $TYPST_VERSION ($ARCH)"
echo "  systemd    : $([ "$SETUP_SYSTEMD" = 1 ] && echo "是 ($SERVICE_NAME)" || echo "否")"
echo "  外部接口   : $INTEGRATIONS_PROFILE"

# ----------------------------- 换国内镜像源（可选）--------------------------
if [ "$CN_MIRROR" = 1 ]; then
  log "换国内镜像源 (apt → $APT_MIRROR；npm → npmmirror；GitHub → 加速前缀)"
  # apt：Ubuntu 24.04 用 deb822 格式 (ubuntu.sources)，老版本用 sources.list，都兼容处理
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    $SUDO cp -n /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak || true
    $SUDO sed -i "s@//archive.ubuntu.com/ubuntu@//${APT_MIRROR}/ubuntu@g; s@//security.ubuntu.com/ubuntu@//${APT_MIRROR}/ubuntu@g" /etc/apt/sources.list.d/ubuntu.sources
  fi
  if [ -s /etc/apt/sources.list ]; then
    $SUDO cp -n /etc/apt/sources.list /etc/apt/sources.list.bak || true
    $SUDO sed -i "s@//archive.ubuntu.com/ubuntu@//${APT_MIRROR}/ubuntu@g; s@//security.ubuntu.com/ubuntu@//${APT_MIRROR}/ubuntu@g" /etc/apt/sources.list
  fi
  # npm/pnpm：用环境变量传给后续所有 pnpm install（此时 pnpm 可能还没装，故不用 pnpm config）
  export NPM_CONFIG_REGISTRY="$NPM_REGISTRY"
  # corepack 激活 pnpm 时走自己的下载逻辑，只认 COREPACK_NPM_REGISTRY（不认 NPM_CONFIG_REGISTRY），
  # 不设的话 `corepack prepare pnpm` 仍会连 registry.npmjs.org → 国内可能很慢/失败。
  export COREPACK_NPM_REGISTRY="$NPM_REGISTRY"
else
  log "CN_MIRROR=0，使用官方源（apt/npm/GitHub），海外服务器适用"
fi

# ----------------------------- 0. 基础工具 ----------------------------------
log "0/9 安装基础工具 (curl / git / gnupg / xz / ufw)"
$SUDO apt-get update -y
$SUDO apt-get install -y curl ca-certificates gnupg git xz-utils ufw

# ----------------------------- 1. Node.js ----------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$cur" -ge 20 ] 2>/dev/null && need_node=0 && log "1/9 Node.js 已存在 (v$(node -v | tr -d v))，跳过"
fi
if [ "$need_node" = 1 ]; then
  log "1/9 安装 Node.js $NODE_MAJOR.x (NodeSource)"
  # 注意：NodeSource（deb.nodesource.com）国内无可靠 apt 镜像，apt 换源不覆盖它；
  # 它走 CDN，通常可达（只是不如域内镜像快）。若此步在某网络下极慢/超时，可手动从
  # 清华 Node 二进制镜像装好 Node≥20 再重跑本脚本（会自动跳过本步）：
  #   curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v22.13.0/node-v22.13.0-linux-x64.tar.xz -o /tmp/node.tar.xz
  #   sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi
node -v

# ----------------------------- 2. pnpm --------------------------------------
log "2/9 启用 corepack 并激活 pnpm@$PNPM_VERSION"
$SUDO corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
pnpm -v

# ----------------------------- 3. PostgreSQL --------------------------------
log "3/9 安装并初始化 PostgreSQL"
$SUDO apt-get install -y postgresql postgresql-contrib
$SUDO systemctl enable --now postgresql

# 建角色（带密码登录）+ 数据库（角色为属主）。已存在则跳过。
if ! as_postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  as_postgres psql -c "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASSWORD}';"
  echo "  已创建角色 ${DB_USER}"
else
  as_postgres psql -c "ALTER ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASSWORD}';"
  echo "  角色 ${DB_USER} 已存在，已同步密码"
fi
if ! as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  as_postgres createdb -O "${DB_USER}" "${DB_NAME}"
  echo "  已创建数据库 ${DB_NAME}"
else
  echo "  数据库 ${DB_NAME} 已存在，跳过创建"
fi

# ----------------------------- 4. Typst -------------------------------------
if command -v typst >/dev/null 2>&1; then
  log "4/9 Typst 已存在 ($(typst --version))，跳过"
else
  log "4/9 安装 Typst $TYPST_VERSION"
  tmp="$(mktemp -d)"
  typst_url="https://github.com/typst/typst/releases/download/${TYPST_VERSION}/${TYPST_ASSET}.tar.xz"
  [ "$CN_MIRROR" = 1 ] && typst_url="${GH_PROXY}${typst_url}"   # 国内走 GitHub 加速前缀
  curl -fsSL "$typst_url" -o "$tmp/typst.tar.xz"
  tar -xf "$tmp/typst.tar.xz" -C "$tmp"
  $SUDO install "$tmp/${TYPST_ASSET}/typst" /usr/local/bin/typst
  rm -rf "$tmp"
  typst --version
fi

# ----------------------------- 5. 文档处理工具 ------------------------------
if command -v soffice >/dev/null 2>&1; then
  log "5/9 LibreOffice 已存在，跳过"
else
  log "5/9 安装 LibreOffice (calc + writer, headless)"
  $SUDO apt-get install -y libreoffice-calc libreoffice-writer
fi
if command -v gs >/dev/null 2>&1; then
  log "5/9 Ghostscript 已存在，跳过"
else
  log "5/9 安装 Ghostscript（异常大 PDF 自动压缩）"
  $SUDO apt-get install -y ghostscript
fi

# ----------------------------- 6. 字体检查 ----------------------------------
log "6/9 检查报告字体 (fonts/)"
if ls "$PROJECT_DIR"/fonts/*.tt[fc] >/dev/null 2>&1; then
  echo "  ✓ 已检测到字体文件，报告版面将与开发机一致"
else
  warn "fonts/ 下没有字体文件！这些是专有字体、被 .gitignore 排除，git clone 拿不到。"
  warn "请手动把开发机的 fonts/*.ttf / *.ttc 拷到 $PROJECT_DIR/fonts/，否则报告会缺字或版面错乱。"
fi

# ----------------------------- 7. 应用依赖 + 配置 + 建表 + 构建 --------------
cd "$PROJECT_DIR"

log "7/9 安装应用依赖 (根 + client + server)"
pnpm install
( cd client && pnpm install )
( cd server && pnpm install )

log "7/9 安装 Typst 本地主题包"
bash scripts/install-typst-packages.sh

log "7/9 写入数据库配置 config/database.local.json"
# local.json 会覆盖 database.json 里硬编码的 user（开发机用户名），并提供密码
cat > config/database.local.json <<EOF
{
  "host": "localhost",
  "port": 5432,
  "database": "${DB_NAME}",
  "user": "${DB_USER}",
  "password": "${DB_PASSWORD}"
}
EOF

# 外部接口统一由 interfaces.{server|demo}.json 管理。Ubuntu 生产安装默认 server；
# 已存在的服务器配置必须保留，重跑安装脚本不能覆盖现场地址/账号配置。
if [ "$INTEGRATIONS_PROFILE" = "server" ]; then
  if [ ! -f config/interfaces.server.json ]; then
    [ -f config/interfaces.server.json.example ] || die "缺少 config/interfaces.server.json.example，无法创建真实接口配置"
    cp config/interfaces.server.json.example config/interfaces.server.json
    warn "已创建 config/interfaces.server.json，请核对 public_base_url、OA 地址和 SOAP 地址是否为本服务器现场值。"
  else
    echo "  ✓ 保留现有 config/interfaces.server.json（不覆盖现场配置）"
  fi
  node -e "const c=JSON.parse(require('fs').readFileSync('config/interfaces.server.json','utf8')); if(!String(c?.report_delivery?.soap_endpoint||'').trim()) throw new Error('report_delivery.soap_endpoint 不能为空')" \
    || die "config/interfaces.server.json 非法，或真实 SOAP 地址 report_delivery.soap_endpoint 为空（禁止以 server 名义静默进入 mock）"
else
  echo "  演示安装：使用 config/interfaces.demo.json，OA / SOAP 均为 mock"
fi

log "7/9 执行数据库迁移 (建表)"
pnpm migrate

log "7/9 构建前端 (产出 client/dist，后端会托管)"
pnpm build

# ----------------------------- 8. 防火墙 ------------------------------------
log "8/9 开放防火墙端口 $APP_PORT/tcp"
if command -v ufw >/dev/null 2>&1; then
  $SUDO ufw allow "${APP_PORT}/tcp" || warn "ufw allow 失败（可能 ufw 未启用），如启用了防火墙请手动放行 $APP_PORT。"
else
  warn "未检测到 ufw，若服务器有其它防火墙请手动放行 $APP_PORT/tcp。"
fi

# ----------------------------- 9. systemd 自启（可选）------------------------
if [ "$SETUP_SYSTEMD" = 1 ]; then
  log "9/9 安装 systemd 服务 ${SERVICE_NAME}（开机自启 + 崩溃重启）"
  PNPM_BIN="$(command -v pnpm)"
  NODE_DIR="$(dirname "$(command -v node)")"
  $SUDO tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=化学部检测报告系统
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=PORT=${APP_PORT}
Environment=HOST=0.0.0.0
Environment=INTEGRATIONS_PROFILE=${INTEGRATIONS_PROFILE}
Environment=PATH=${NODE_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=${PNPM_BIN} serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "${SERVICE_NAME}"
  # 服务可能已在运行；必须 restart 才会读取刚写入的 INTEGRATIONS_PROFILE。
  $SUDO systemctl restart "${SERVICE_NAME}"
  sleep 2
  $SUDO systemctl --no-pager --full status "${SERVICE_NAME}" || true
else
  log "9/9 跳过 systemd（SETUP_SYSTEMD=0）"
fi

# ----------------------------- 完成提示 -------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
log "✅ 安装完成"
cat <<EOF

访问地址（单进程，UI 与 API 同源同端口）：
  http://${IP:-<服务器IP>}:${APP_PORT}

⚠️ 当前是【全新空库 + 演示数据】。开发机/旧机上录的数据、调好的报告模板与页眉页脚
   都在数据库 + server/uploads/ + fonts/ 里，【不随代码打包过来】。要把现有系统整体
   搬过来（否则数据为空、页眉页脚会乱），见《部署说明-Ubuntu.md》四点六：
   数据库 pg_dump/restore + 拷 server/uploads/ + 拷 fonts/*.ttf。

后续运维：
  查看日志   : $([ "$SETUP_SYSTEMD" = 1 ] && echo "${SUDO:+$SUDO }journalctl -u ${SERVICE_NAME} -f" || echo "见下方手动启动")
  重启服务   : $([ "$SETUP_SYSTEMD" = 1 ] && echo "${SUDO:+$SUDO }systemctl restart ${SERVICE_NAME}" || echo "—")
  手动启动   : cd ${PROJECT_DIR} && INTEGRATIONS_PROFILE=${INTEGRATIONS_PROFILE} PORT=${APP_PORT} pnpm serve
  更新代码后 : pnpm install && pnpm migrate && pnpm build$([ "$SETUP_SYSTEMD" = 1 ] && echo " && ${SUDO:+$SUDO }systemctl restart ${SERVICE_NAME}")

外部接口模式：${INTEGRATIONS_PROFILE}
  server：实际读取 config/interfaces.server.json，调用真实 OA / SOAP；报告页眉页脚严格读取上游 POST /api/external/reports 推送值，不回退示例。
  demo  ：使用 config/interfaces.demo.json，OA / SOAP 均为 mock（仅显式传 INTEGRATIONS_PROFILE=demo 时启用）。
运行后可访问 http://${IP:-<服务器IP>}:${APP_PORT}/api/health；server 模式应返回 integrations_profile=server、report_meta_source=external_interface。
真实服务器应确认能访问 OA(172.19.0.27) 与回传 WSDL(172.18.0.97:8003)。

⚠️ 数据库密码当前为：${DB_PASSWORD}
   生产环境请用 DB_PASSWORD='强密码' 重新运行，或手动改库密码 + config/database.local.json。
EOF
