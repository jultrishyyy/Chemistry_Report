#!/usr/bin/env bash
# 接口 1.4 / 1.5 / 1.6 SOAP 联通与发送留痕排查脚本（只读，不改任何东西）
# 用法：在服务器上执行：  bash scripts/diag-delivery.sh   （从任意目录都可，脚本会自动切到项目根）
set -uo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || true   # scripts/ 的上一级 = 项目根

line(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

line "1) 运行中的服务进程 + 启动时间（判断改 json 后有没有重启）"
# tsx src/index.ts 是长驻进程；配置只在启动那一刻读一次，改 json 必须重启才生效。
ps -eo pid,lstart,etime,cmd | grep -E "tsx .*index\.ts|node .*index" | grep -v grep \
  || echo "（没匹配到 tsx/node 进程——确认服务是不是用 pm2/systemd 起的：pm2 ls / systemctl status）"
echo "提示：上面的 STARTED 时间若早于你改 json 的时间，就是没重启 → 配置没生效。"

line "2) 当前接口配置（服务器必须使用 interfaces.server.json）"
if [ -f config/interfaces.server.json ]; then
  cat config/interfaces.server.json
else
  echo "!! 找不到 config/interfaces.server.json；请由 interfaces.server.json.example 复制并填写"
fi
echo "提示：服务进程必须设置 INTEGRATIONS_PROFILE=server；report-delivery*.json 已不再由统一配置加载器读取。"

line "3) 服务进程的 profile / DELIVERY_* 环境变量"
# 注意：要看的是【服务进程】的环境，不是当前 shell。取进程 pid 后读 /proc/<pid>/environ。
PID=$(ps -eo pid,cmd | grep -E "tsx .*index\.ts|node .*index" | grep -v grep | awk '{print $1}' | head -1)
if [ -n "${PID:-}" ] && [ -r "/proc/$PID/environ" ]; then
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Ei "^(INTEGRATIONS_PROFILE|DELIVERY_)" \
    || echo "!! 未读到 INTEGRATIONS_PROFILE；默认会进入 demo/mock，不会真实发送"
else
  echo "（拿不到进程环境，退而查当前 shell）"; env | grep -Ei "^(INTEGRATIONS_PROFILE|DELIVERY_)" || true
fi

line "4) 从部署服务器探测 SOAP 端点 / WSDL"
SOAP_ENDPOINT=$(grep -o '"soap_endpoint"[[:space:]]*:[[:space:]]*"[^"]*"' config/interfaces.server.json 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
if [ -z "${SOAP_ENDPOINT:-}" ]; then
  echo "!! soap_endpoint 为空：当前只能 mock"
elif command -v curl >/dev/null 2>&1; then
  echo "端点：$SOAP_ENDPOINT"
  curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'endpoint HTTP=%{http_code} connect=%{time_connect}s total=%{time_total}s\n' "$SOAP_ENDPOINT" || echo "!! 端点连接失败"
  curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'WSDL HTTP=%{http_code} connect=%{time_connect}s total=%{time_total}s\n' "${SOAP_ENDPOINT}?wsdl" || echo "!! WSDL 连接失败"
else
  echo "未安装 curl，请手工访问：${SOAP_ENDPOINT}?wsdl"
fi

line "5) 最近的 SOAP 发送留痕"
# 数据库连接按应用真实合并顺序取值：database.json（base）→ database.local.json（覆盖，部署机真实值）→ DB_* 环境变量（最高）。
# 注意：base 里 user 是开发机的（trish、无密码），部署机真正生效的是 database.local.json（安装脚本写入 user=cdr / password=cdr_demo_pwd）。
jget(){ # jget <字段>：先查 local.json 再查 base.json，取第一个命中的值
  for f in config/database.local.json config/database.json; do
    v=$(grep -o "\"$1\"[[:space:]]*:[^,}]*" "$f" 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*//; s/^"//; s/"[[:space:]]*$//; s/[[:space:]]*$//')
    [ -n "$v" ] && { printf '%s' "$v"; return; }
  done
}
PGHOST="${DB_HOST:-$(jget host)}"
PGPORT="${DB_PORT:-$(jget port)}"
PGUSER="${DB_USER:-$(jget user)}"
PGDATABASE="${DB_DATABASE:-$(jget database)}"
export PGPASSWORD="${DB_PASSWORD:-$(jget password)}"
echo "连接：user=${PGUSER:-?} db=${PGDATABASE:-?} host=${PGHOST:-localhost}:${PGPORT:-5432}（密码取自 DB_PASSWORD 或 database.local.json）"
if command -v psql >/dev/null 2>&1; then
  psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -c \
  "SELECT id, sys_number, delivery_status, delivered_at,
          left(delivery_error,160) AS delivery_error
     FROM report_requisitions
    WHERE delivery_status IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST LIMIT 10;" \
  || echo "!! psql 连接失败——手动用你的连库方式跑上面这条 SQL"
  psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -c \
  "SELECT id, task_id, test_state, delivery_status, attempts, delivered_at,
          left(delivery_error,160) AS delivery_error, next_retry_at
     FROM external_task_state_deliveries
    ORDER BY updated_at DESC LIMIT 20;" \
  || echo "!! 查不到 1.6 队列表；请先执行 pnpm migrate"
else
  echo "没装 psql。手动执行这条 SQL 查最近送审结果："
  echo "  SELECT id, sys_number, delivery_status, delivered_at, delivery_error FROM report_requisitions WHERE delivery_status IS NOT NULL ORDER BY updated_at DESC LIMIT 10;"
fi

line "判读"
cat <<'EOF'
- report_requisitions.delivery_status = 'sent' → 1.4 我方发成功（HTTP 2xx 且无 SOAP Fault）。
    · 对方仍没收到 = 进程可能未重启（见第1项），或 WSDL 的方法名/参数/SOAPAction 与配置不一致。
- delivery_status = 'failed' → 看 delivery_error：
    · 'SOAP Fault: ...' → 对方拒绝：方法名/参数名不符，或缺 jobNo。
    · 'HTTP 5xx' / 超时 / 连不上 → 网络或对方服务问题。
- 日志里出现 '[external-delivery] (mock) ...' → endpoint 被当成空，根本没真发（检查 profile、interfaces.server.json 和环境变量）。
- external_task_state_deliveries：sent=1.6 已收到 Msg=OK；failed=待后台重试；pending 且错误含 mock=演示模式从未真发。
- 1.5 为同步撤回：失败时 HTTP 返回 502，本地仍保持已送审；成功必须同时收到 Msg=OK、RecordState=草稿。

最常见结论：改 json 后【没重启服务进程】。重启后再点一次送审，重跑本脚本第5项确认 delivery_status。
EOF
