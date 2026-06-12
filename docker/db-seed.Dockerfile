FROM postgres:17-bookworm

COPY docker/postgres-init/001_roles.sh /docker-entrypoint-initdb.d/001_roles.sh
COPY docker/postgres-init/010_core_network_schema.sql /docker-entrypoint-initdb.d/010_core_network_schema.sql
COPY docker/postgres-init/020_structure_models.sql /docker-entrypoint-initdb.d/020_structure_models.sql
COPY docker/postgres-init/030_import.sql /docker-entrypoint-initdb.d/030_import.sql
COPY data/supabase-import/20260514_new_web_data /seed/data/supabase-import/20260514_new_web_data

RUN chmod +x /docker-entrypoint-initdb.d/001_roles.sh
