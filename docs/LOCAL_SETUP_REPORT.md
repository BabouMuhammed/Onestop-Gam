# Local security and setup verification

## Follow-up: database verification corrected (14 November 2026)

This follow-up supersedes the missing-password and unverified-migration-status entries in the initial snapshot below. Work remains on `integration-review`; existing changes were preserved.

- Reproduced `TARGET_MISMATCH` after successful authentication. The exact failing expression was `identity.host !== '127.0.0.1'`: `inet_server_addr()::text` returned `127.0.0.1/32`. Changed only the SQL projection to `host(inet_server_addr())`, which returns the address without the netmask, as documented by [PostgreSQL](https://www.postgresql.org/docs/18/functions-net.html). Exact database, user, host, port and URL-query restrictions remain intact.
- No inherited `DATABASE_URL` was present in the agent process or Windows User/Machine environment settings. The effective URL matched the parsed root `.env`; that file contains one `DATABASE_URL` assignment. No additional application `.env` files or PostgreSQL environment overrides were found. `process.loadEnvFile` loads the absolute root path in the checker; its preservation of pre-existing environment values was also exercised by the negative checks. Neither credentials nor connection strings were printed or changed.
- `npm run db:check:local` now exits 0 and verifies `onestop_gam_dev`, `onestop_dev`, `127.0.0.1:5432`, PostgreSQL 18.4. A read-only query confirmed the current schema is `public`.
- Six negative checks invoked the actual checker with inherited environment overrides: unauthorized database, host, port, user, schema, and a query-string `host` override. All exit 1 with `TARGET_MISMATCH` before connection.
- `npm run lint` and `git diff --check` passed.
- After verification passed, `npm exec -w @onestop/api -- prisma migrate status` connected to the expected database/schema and reported all six local migrations pending (exit 1 for unapplied migrations). No migration history table exists yet.
- Read-only inspection found zero relations, types or routines in `public`. Database owner is `onestop_dev`; schema USAGE and CREATE privileges are present. Based on the empty target schema and reviewed migration files, it is safe to proceed with `npm run db:migrate` against this verified development database. Actual migration execution remains untested. No migrations, seeding, reset, truncation or deletion were performed during this follow-up.

## Initial setup snapshot

Verified on 14 November 2026, Windows, Node 24.11.1, npm 11.6.2.
Branch: `integration-review`. The working tree was clean before this work.
No deployment, database reset, truncation, migration, seed or business-data import was executed.

## Dependency investigation and changes

The initial live audit reproduced eight affected package entries: one low and seven moderate. There are two underlying advisories, not eight independent flaws. All affected entries are development dependencies in the lockfile. The production-only audit was clean before and after the changes.

| Issue | Initial dependency path and version | Fix |
| --- | --- | --- |
| [esbuild Windows file-server traversal](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | API → tsup 8.5.1 → esbuild 0.27.7; Vite also resolved this optional peer. tsx already used 0.28.2. | Root override to 0.28.2; first patched version is 0.28.1. |
| [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | typescript-eslint 8.72.2 → typescript-estree 8.72.2 → minimatch 10.2.6; ESLint already used 11.0.8. | Root override to 11.0.8; first patched version is 11.0.1. |

The esbuild issue requires its Windows `serve` API with a served directory. The repository does not directly call that API, but the affected binary was installed on Windows. The minimatch issue requires attacker-controlled patterns and optimization level at least 2; typescript-estree's inspected call uses `{ dot: true }` and this repository does not enable ESLint project service. Neither issue was found in application request handling. Updating the development toolchain still removes the vulnerable implementations.

The overrides cross tsup's esbuild range (`^0.27.0`) and typescript-estree's minimatch major range (`^10.2.2`). They are deliberate compatibility exceptions, not guaranteed upstream support. npm registry inspection found no newer stable TypeScript ESLint release than 8.72.2 or tsup 8 release than 8.5.1. tsup 9 would introduce an unnecessary parent major upgrade. React, Express, Prisma, TypeScript, Vite and their application architecture remain on their existing versions. No `npm audit fix --force` was used.

Both builds, lint, type checking, and a four-case smoke check of typescript-estree's actual minimatch invocation passed with these versions. All three consumers (tsup, tsx, Vite) were verified to resolve esbuild 0.28.2, and typescript-estree resolves minimatch 11.0.8. Replace the overrides with upstream supported ranges when available.

**Remaining package-manager issue:** npm 11.6.2 `npm ls esbuild minimatch` exits 1 with `ELSPROBLEMS`, reporting esbuild 0.28.2 against tsup's original `^0.27.0` range despite the root override. Clean installation and compilation succeed, and the audits return zero findings. This diagnostic remains unresolved; do not treat the entire dependency verification as warning-free.

## Verification commands and results

| Command | Result |
| --- | --- |
| `npm ci --no-audit --fetch-retries=0 --fetch-timeout=20000` | Passed: clean install of the updated lockfile. |
| `npm run lint` | Passed after correcting explicit Node imports in the new checker. |
| `npm run typecheck` | Passed for shared, API and web. Initial baseline failed because the Prisma client had not yet been generated; generating it resolved those errors without application code changes. |
| `npm run build` | Passed for API and web with esbuild 0.28.2. Web retains a bundle-size warning (548.72 kB JS chunk). |
| `npm test` | Exit 1 before test execution: explicit `TEST_DATABASE_URL` is missing. There are no reported executed test assertion failures. This is a configuration/safety blocker, not evidence of a dependency regression. |
| `npm run test:tools` | Passed: seven tests, using the local virtual environment on PATH. |
| `npm audit --json --fetch-retries=0 --fetch-timeout=20000` | Exit 0: zero vulnerabilities. |
| `npm audit --omit=dev --json --fetch-retries=0 --fetch-timeout=20000` | Exit 0: zero production vulnerabilities. |
| `npm exec -w @onestop/api -- prisma validate` | Passed with Prisma 7.10.1. |
| `npm run db:check:local` | Exit 1: `MISSING_PASSWORD`; no migration attempted. |
| `npm ls esbuild minimatch` | Exit 1: tsup range diagnostic described above. |
| `git diff --check` | Passed. |

Python 3.14 was available as `python`, but the Windows `python3` command was a Store alias. The tools script now uses `python`. A local ignored virtual environment was created with `python -m venv .venv`; `.venv\Scripts\python.exe -m pip install "openpyxl>=3.1.5,<4" --disable-pip-version-check` installed openpyxl 3.1.5. To rerun in PowerShell:

```powershell
$env:PATH = "$PWD\.venv\Scripts;$env:PATH"
npm run test:tools
```

## Database and migration status

- PostgreSQL 18 service is running. `psql --version` reports 18.4 and `pg_isready -h 127.0.0.1 -p 5432` reports accepting connections. These checks do not establish successful user authentication or the server's exact version.
- A read-only `psql -X -w -h 127.0.0.1 -p 5432 -U onestop_dev -d onestop_gam_dev` identity query failed because no password was supplied. No credential was present in the process environment or an existing repository `.env`.
- An ignored `.env` was created from the updated example without a password. Fill in the existing password locally, URL-encoded, and keep it out of chat and Git. Seed administrator variables are also blank.
- `npm run db:check:local` accepts only user `onestop_dev`, host `127.0.0.1`, port 5432, database `onestop_gam_dev`, and optional `schema=public`. It rejects other targets before connecting, then checks server-reported identity with a read-only query. Mismatched database and remote-host rejection were exercised. Errors do not print connection strings or credentials. This helper does not change Prisma's generic migration scripts; always require its successful result first.
- Prisma CLI loads the root `.env` through `apps/api/prisma.config.ts`. The API and seed load it via Node's env-file option. Runtime additionally accepts `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `SESSION_IDLE_MINUTES`, and `SESSION_MAX_HOURS`; see `.env.example`.
- Inspected five existing migration files: initial schema, integrity constraints/triggers, product packs/sizes, receiving, and sales. They use ordinary PostgreSQL enums, decimal values, foreign keys and PL/pgSQL triggers; inspection found no specific PostgreSQL 18 incompatibility. Prisma documents PostgreSQL support in its [database reference](https://docs.prisma.io/docs/orm/core-concepts/supported-databases). Actual compatibility, drift, migration history and data state remain unverified on this server.
- A sixth migration corrects only the old display name for code `LE_GAYE_BI` to **LEGAYEBI**. IDs, codes, SKU prefixes, counters, and historical rows are unchanged. New seed data, fixtures and current display-name documentation also use **Quality Foods** and **LEGAYEBI**. The migration has not been applied.
- API tests use `TRUNCATE ... CASCADE`; the unsafe default test URL was removed. `TEST_DATABASE_URL` must explicitly name a disposable `_test` database. Do not set it to the development database. Under the instruction against destructive commands, this suite was not allowed to truncate any database.
- StockFlow databases were not accessed or modified.

After the local password is available, run the identity check, inspect migration status, and apply the reviewed SQL only to the verified development database using `npm run db:migrate` (`prisma migrate deploy`). Do not use `migrate reset` or accept a schema reset. Configure administrator seed values locally before `npm run db:seed`, checking for existing data first.

## Running application and workflow status

Started `npm run dev:api` and `npm run dev:web` successfully:

| Check | Result |
| --- | --- |
| API at `http://localhost:4000/api/health` | HTTP 200, `{"ok":true}`. This endpoint does not query PostgreSQL. |
| Frontend at `http://localhost:5173/` | HTTP 200, HTML references the React entry point. |
| Frontend `/src/main.tsx` | HTTP 200, JavaScript transformation served. |
| Frontend proxy `/api/health` | HTTP 200; Vite-to-Express communication verified. |
| `/api/auth/me`, `/api/products`, `/api/receipts`, `/api/sales` | Direct API checks return HTTP 401 without a session. Inventory, receiving and sales were also checked through the frontend proxy. |
| Successful authentication, inventory reads, receiving, POS sales, division authorization | Blocked by missing database authentication, migrations and application credentials; not claimed as passed. No business transactions were created. |

Recommended next task: supply the existing database password in the ignored `.env`, verify identity, inspect/apply migrations, then validate authenticated Phase 1–3 workflows and division isolation. Resolve the npm dependency diagnostic and obtain an explicitly disposable, isolated test environment before running the destructive integration suite.
