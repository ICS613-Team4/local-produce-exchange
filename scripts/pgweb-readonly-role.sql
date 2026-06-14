-- Makes sure a read-only login named pgweb_ro exists for the pgweb browser
-- tool. The pgweb-init helper in docker-compose.yml runs this every time the
-- database comes up, so the role is created on a brand-new database and is
-- also added to a database that already existed before pgweb was introduced -
-- without anyone running anything by hand.
--
-- It is idempotent: it makes the role if it is missing, then re-asserts the
-- password and the read-only grants. Because pgweb signs in as this role,
-- PostgreSQL itself refuses any write from pgweb, so every real change has to
-- go through an Alembic migration, which connects as the normal owner role.
--
-- The :ro_pass value is passed in by pgweb-init: a built-in default locally,
-- or the strong password from the .env file in production.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgweb_ro') THEN
        CREATE ROLE pgweb_ro LOGIN;
    END IF;
END
$$;

ALTER ROLE pgweb_ro WITH LOGIN PASSWORD :'ro_pass';

-- Let pgweb_ro read everything in the public schema. The GRANT covers tables
-- that exist now; the ALTER DEFAULT PRIVILEGES makes every table a future
-- Alembic migration creates grant read access on its own. None of this grants
-- write.
GRANT USAGE ON SCHEMA public TO pgweb_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgweb_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgweb_ro;
