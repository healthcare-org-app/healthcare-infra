#!/bin/bash
# Postgres entrypoint: creates one database per domain listed in
# POSTGRES_MULTIPLE_DATABASES (comma-separated). Each service owns its own DB.
set -euo pipefail

if [[ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]]; then
  IFS=',' read -ra DBS <<< "$POSTGRES_MULTIPLE_DATABASES"
  for db in "${DBS[@]}"; do
    db="$(echo "$db" | xargs)"
    echo "creating database: $db"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
      CREATE DATABASE "$db";
      GRANT ALL PRIVILEGES ON DATABASE "$db" TO "$POSTGRES_USER";
EOSQL
  done
fi
