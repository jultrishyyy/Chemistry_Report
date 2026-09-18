#!/bin/sh
set -eu
if [ "${INTEGRATIONS_PROFILE:-demo}" != demo ] && [ "${INTEGRATIONS_PROFILE:-demo}" != server ]; then
  echo 'INTEGRATIONS_PROFILE must be demo or server' >&2
  exit 1
fi

# Seed uploads only when the persistent volume is new. Restarts and image
# updates never overwrite files subsequently uploaded by users.
if [ "${LOAD_SNAPSHOT_ON_EMPTY:-1}" = 1 ] && [ ! -e /data/uploads/.snapshot-loaded ]; then
  if [ -s /app/seed-data/uploads.tar.gz ]; then
    tar -xzf /app/seed-data/uploads.tar.gz -C /data/uploads
  fi
  if [ -s /app/seed-data/legacy-uploads.tar.gz ]; then
    tar -xzf /app/seed-data/legacy-uploads.tar.gz -C /app/server/uploads
  fi
  touch /data/uploads/.snapshot-loaded
fi
if [ "${RUN_MIGRATIONS:-1}" = 1 ]; then
  tsx /app/db/migrate.ts
fi
exec "$@"
