#!/bin/sh
set -eu

# The official PostgreSQL image executes this only for a newly created data
# volume. Existing databases are never overwritten.
if [ "${LOAD_SNAPSHOT_ON_EMPTY:-1}" != 1 ]; then
  echo '[seed] snapshot disabled; leaving the new database empty'
  exit 0
fi
if [ ! -s /seed/cdr_demo.dump ]; then
  echo '[seed] cdr_demo.dump not found; leaving the new database empty'
  exit 0
fi

echo '[seed] restoring transferred database snapshot'
pg_restore --exit-on-error --no-owner --no-privileges \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" /seed/cdr_demo.dump
echo '[seed] database snapshot restored'
