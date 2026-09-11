#!/usr/bin/env bash
# 把某委托单【已送审】的报告重置回「未送审」，以便在系统上重新点「送审」测试回传（接口 1.4）。
# 只改回传相关列（delivery_status/delivered_at/delivery_error + reports.external_status），
# 不动报告内容、不动录入数据、不重新生成。可反复使用。
#
# 用法：  bash scripts/reset-delivery.sh [委托单号]
#         不传参数默认 C202606166519。
set -euo pipefail
cd "$(dirname "$0")/.."           # scripts/ 的上一级 = 项目根

ORDER="${1:-C202606166519}"

# 数据库连接：database.local.json（部署真实值）→ database.json → DB_* 环境变量
jget(){ for f in config/database.local.json config/database.json; do
  v=$(grep -o "\"$1\"[[:space:]]*:[^,}]*" "$f" 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*//; s/^"//; s/"[[:space:]]*$//; s/[[:space:]]*$//')
  [ -n "$v" ] && { printf '%s' "$v"; return; }
done; }
export PGHOST="${DB_HOST:-$(jget host)}" PGPORT="${DB_PORT:-$(jget port)}" \
       PGUSER="${DB_USER:-$(jget user)}" PGDATABASE="${DB_DATABASE:-$(jget database)}" \
       PGPASSWORD="${DB_PASSWORD:-$(jget password)}"

echo "== 目标委托单：$ORDER   （库 ${PGDATABASE}@${PGHOST}:${PGPORT}）=="

psql -v ON_ERROR_STOP=1 -v ord="$ORDER" <<'SQL'
\echo '--- 重置前 ---'
SELECT id, sys_number, report_id, delivery_status, delivered_at
FROM report_requisitions WHERE order_no = :'ord' ORDER BY id;

BEGIN;

-- 1) 取号单：回传状态清回未送审（仅动 sent 的那些）
UPDATE report_requisitions
   SET delivery_status='none', delivered_at=NULL, delivery_error=NULL, updated_at=NOW()
 WHERE order_no = :'ord' AND delivery_status='sent';

-- 2) 对应报告：退出"已回传外部待审"态，回到未送审初始态 'none'（该列 NOT NULL，不能置空）
UPDATE reports
   SET external_status='none', stale=false
 WHERE id IN (SELECT report_id FROM report_requisitions
              WHERE order_no = :'ord' AND report_id IS NOT NULL)
   AND external_status='submitted_external';

COMMIT;

\echo '--- 重置后（delivery_status 应为 none）---'
SELECT id, sys_number, report_id, delivery_status, delivered_at
FROM report_requisitions WHERE order_no = :'ord' ORDER BY id;
SQL

echo "== 完成。回系统刷新报告工作台，该单应显示「待送审」，即可点「送审」重发。=="
