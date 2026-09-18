#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG="$ROOT/deploy/system.env"
COMPOSE="$ROOT/deploy/docker/compose.yaml"

if [ ! -f "$CONFIG" ]; then
  echo "缺少统一配置：$CONFIG" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a

compose() {
  docker compose --env-file "$CONFIG" -f "$COMPOSE" "$@"
}

select_mode() {
  case "$1" in
    mock)
      export INTEGRATIONS_PROFILE=demo
      export PUBLIC_BASE_URL=$MOCK_PUBLIC_BASE_URL
      export AUTH_COMMON_LOGIN_URL=
      export AUTH_LOCAL_ADMIN=$MOCK_LOCAL_ADMIN
      export AUTH_LOCAL_ADMIN_PWD=$MOCK_LOCAL_ADMIN_PASSWORD
      export DELIVERY_SOAP_ENDPOINT=
      ;;
    server)
      if [ "$DB_PASSWORD" = "cdr-local-demo" ] || [ -z "$DB_PASSWORD" ]; then
        echo "server 模式拒绝使用默认数据库密码；请先修改 deploy/system.env 的 DB_PASSWORD。" >&2
        exit 1
      fi
      if [ -z "$SERVER_OA_LOGIN_URL" ] || [ -z "$SERVER_SOAP_ENDPOINT" ]; then
        echo "server 模式必须在 deploy/system.env 填写 OA 和 SOAP 地址。" >&2
        exit 1
      fi
      export INTEGRATIONS_PROFILE=server
      export PUBLIC_BASE_URL=$SERVER_PUBLIC_BASE_URL
      export AUTH_COMMON_LOGIN_URL=$SERVER_OA_LOGIN_URL
      export AUTH_LOCAL_ADMIN=$SERVER_LOCAL_ADMIN
      export AUTH_LOCAL_ADMIN_PWD=$SERVER_LOCAL_ADMIN_PASSWORD
      export DELIVERY_SOAP_ENDPOINT=$SERVER_SOAP_ENDPOINT
      ;;
    *)
      echo "模式只能是 mock 或 server" >&2
      exit 1
      ;;
  esac
}

ensure_image() {
  if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
    if [ ! -f "$ROOT/Dockerfile" ]; then
      echo "未找到镜像 $APP_IMAGE，也没有源码 Dockerfile。离线包请先执行：docker load -i images.tar" >&2
      exit 1
    fi
    echo "首次运行：构建应用镜像 $APP_IMAGE"
    compose build app
  fi
}

start_mode() {
  select_mode "$1"
  ensure_image
  compose up -d
  echo "已启动 $1 模式：http://127.0.0.1:${HTTP_PORT}"
  echo "检查状态：./system.sh status"
}

package_offline() {
  platform=${1:-$DOCKER_PLATFORM}
  export DOCKER_PLATFORM=$platform
  compose build app
  docker pull --platform "$platform" "$POSTGRES_IMAGE"
  release="$ROOT/release/cdr-report-offline-${platform#linux/}"
  rm -rf "$release"
  mkdir -p "$release/deploy/docker" "$release/seed-data"
  docker image save -o "$release/images.tar" "$APP_IMAGE" "$POSTGRES_IMAGE"
  cp "$ROOT/system.sh" "$release/system.sh"
  awk -v platform="$platform" '/^DOCKER_PLATFORM=/{print "DOCKER_PLATFORM=" platform; next} {print}' \
    "$CONFIG" > "$release/deploy/system.env"
  cp "$COMPOSE" "$release/deploy/docker/compose.yaml"
  cp "$ROOT/deploy/docker/init-db.sh" "$release/deploy/docker/init-db.sh"
  cp "$ROOT/seed-data/cdr_demo.dump" "$release/seed-data/cdr_demo.dump"
  cp "$ROOT/seed-data/uploads.tar.gz" "$release/seed-data/uploads.tar.gz"
  cp "$ROOT/seed-data/legacy-uploads.tar.gz" "$release/seed-data/legacy-uploads.tar.gz"
  cp "$ROOT/seed-data/manifest.json" "$release/seed-data/manifest.json"
  cp "$ROOT/部署说明.md" "$release/部署说明.md"
  cat > "$release/离线部署.txt" <<'EOF'
1. docker load -i images.tar
2. 修改 deploy/system.env（至少修改 DB_PASSWORD 和服务器地址）
3. chmod +x system.sh deploy/docker/init-db.sh
4. ./system.sh server
EOF
  tar -czf "$release.tar.gz" -C "$(dirname "$release")" "$(basename "$release")"
  echo "离线包已生成：$release.tar.gz"
}

command=${1:-help}
case "$command" in
  mock|server) start_mode "$command" ;;
  snapshot) node "$ROOT/scripts/export-deployment-data.mjs" ;;
  package) package_offline "${2:-$DOCKER_PLATFORM}" ;;
  status) compose ps; compose logs --tail=80 app ;;
  stop) compose stop ;;
  down) compose down ;;
  logs) compose logs -f --tail=200 app ;;
  rebuild)
    compose build --no-cache app
    echo "镜像已重建；执行 ./system.sh mock 或 ./system.sh server 启动。"
    ;;
  help|*)
    cat <<'EOF'
用法：
  ./system.sh mock                 本机 mock，一条命令启动
  ./system.sh server               内网真实接口，一条命令切换/启动
  ./system.sh snapshot             导出当前本机数据库和上传文件
  ./system.sh package [linux/amd64|linux/arm64]
                                   构建一个离线部署包
  ./system.sh status|logs|stop|down
  ./system.sh rebuild              重新构建应用镜像
EOF
    ;;
esac
