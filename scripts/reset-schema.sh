#!/bin/bash

set -euo pipefail

# Load env vars
set -a
source scripts/.env
set +a

if [ -z "$DB_SCHEMA" ]; then
  echo "❌ DB_SCHEMA is not set in api/.env"
  exit 1
fi

echo "🧨 Resetting schema: $DB_SCHEMA"

# Step 0: Ensure we own the schema (avoid "must be owner" errors)
psql "$DATABASE_URL" -v schema="$DB_SCHEMA" <<'EOF'
ALTER SCHEMA :"schema" OWNER TO CURRENT_USER;
EOF

# Step 1: Drop PostGIS and other extensions first
psql "$DATABASE_URL" <<EOF
DO \$\$
DECLARE
    ext RECORD;
BEGIN
    FOR ext IN
        SELECT extname FROM pg_extension
        WHERE extname IN ('postgis', 'postgis_topology', 'postgis_raster', 'pg_trgm', 'citext', 'uuid-ossp')
    LOOP
        EXECUTE format('DROP EXTENSION IF EXISTS %I CASCADE', ext.extname);
    END LOOP;
END
\$\$;
EOF

# Step 2: Drop dependent objects (tables, views, sequences, etc.)
psql "$DATABASE_URL" <<EOF
DO \$\$
DECLARE
    r RECORD;
BEGIN
    -- Drop views
    FOR r IN (
        SELECT table_name FROM information_schema.views
        WHERE table_schema = '$DB_SCHEMA'
    ) LOOP
        EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', '$DB_SCHEMA', r.table_name);
    END LOOP;

    -- Drop tables
    FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = '$DB_SCHEMA'
    ) LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', '$DB_SCHEMA', r.tablename);
    END LOOP;

    -- Drop sequences
    FOR r IN (
        SELECT sequence_name FROM information_schema.sequences
        WHERE sequence_schema = '$DB_SCHEMA'
    ) LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS %I.%I CASCADE', '$DB_SCHEMA', r.sequence_name);
    END LOOP;

    -- Drop functions
    FOR r IN (
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = '$DB_SCHEMA'
    ) LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I CASCADE', '$DB_SCHEMA', r.routine_name);
    END LOOP;

    -- Drop indexes
    FOR r IN (
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '$DB_SCHEMA'
    ) LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I.%I CASCADE', '$DB_SCHEMA', r.indexname);
    END LOOP;

    -- Drop ENUM types
    FOR r IN (
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e'
          AND n.nspname = '$DB_SCHEMA'
    ) LOOP
        EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', '$DB_SCHEMA', r.typname);
    END LOOP;
END
\$\$;
EOF

echo "✅ Schema $DB_SCHEMA has been fully reset."
