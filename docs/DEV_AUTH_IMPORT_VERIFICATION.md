# Development authentication and import-safety verification

15 November 2026, branch `integration-review`. Existing uncommitted work was preserved. Inventory import remains unapproved and was not executed.

## Authentication and environment

The previous SCRAM error came from the running API retaining an incomplete database URL loaded at process startup. A later standalone connection check could succeed while that API still had its earlier environment. The old Zod configuration accepted any nonempty DATABASE_URL, including a URL without a password, allowing the PostgreSQL adapter to reach SCRAM negotiation without a password string.

The API now loads the absolute repository `.env` in application code before constructing PrismaPg. Development rejects missing passwords, wrong database targets, invalid origins, duplicate URL definitions, and conflicts between root settings and inherited DATABASE_URL/WEB_ORIGIN/PORT. Diagnostic messages omit values. Production/test environments do not load the development file. Prisma CLI and seed use the same loader; no credentials were changed.

`npm run dev:api` explicitly watches the root `.env`. A metadata-only touch was verified to restart the API listener while preserving the file's exact bytes. Startup executes a database connectivity query before opening HTTP; a failed connection exits with a generic, credential-free message.

Read-only inspection found the existing CEO active, unlocked, with `mustChangePassword=false`. The initial password change has already been completed. The original seed password no longer matches, so no real invalid-password attempts were made and no reset/recreation was performed. The owner confirmed successful live sign-in through the frontend using the current password, without disclosing it to the agent.

The isolated authentication tests invoke the real Express routes and Argon2 password functions with mocked persistence. They cover successful sign-in/cookie attributes, safe user responses, required password change blocking inventory/receiving/sales, invalid current/short replacement passwords, successful synthetic password replacement, invalidation of other sessions, unconfigured origins, and unauthenticated reads. They do not modify the real administrator.

## Frontend routing

Vite reads only the routing settings WEB_ORIGIN, PORT and optional API_URL from root configuration. Reading them does not inject database/seed secrets or the root development NODE_ENV into browser builds. The proxy targets the local configured API port; the server listens at the configured browser origin with strictPort enabled. Both frontend and backend reject conflicting inherited routing settings.

Live verification after startup:

- Frontend proxy `/api/health`: HTTP 200 after API database readiness succeeded.
- Frontend proxy `/api/auth/me` without a cookie: HTTP 401, as expected.
- API CORS preflight from `http://localhost:5173`: HTTP 204 with that allowed origin and credentials enabled.
- Login POST from unconfigured origin `http://localhost:5174`: HTTP 403 before authentication.
- Login POST with missing credentials from the configured origin: HTTP 400.
- A second `npm run dev:web` instance exits 1 with “Port 5173 is already in use”, rather than switching to 5174. This failure is the intended port-protection result.

## Import safety

See [IMPORT_SAFETY.md](IMPORT_SAFETY.md) for validation, explicit business approval fingerprints, same-division replay prevention, and the single transaction shared by all input files. No database schema change was needed. No `--apply` command was run.

The input validator rejects repeated product/location pairs and repeated source cells before database initialization. Missing units never become PIECE by default. It also rejects conflicting units, packaging, names, prices, location types, invalid dates, duplicate division files, and excess quantity precision. Name normalization detects ambiguity rather than silently merging variants or aliases.

The persistence adapter locks Division rows in deterministic order, then rechecks state inside a READ COMMITTED transaction. A recorded matching import fingerprint returns without any stock writes. Other existing products, locations, balances, movements or prior import audits cause refusal. Validated writes use the existing `nextSku`, `changeStock`, OPENING ledger and append-only AuditLog; stock, counters and import markers share the transaction.

The PostgreSQL lock primitive was tested using two connections to the verified development database: the first held a Division row lock, the second NOWAIT request returned lock-not-available, then succeeded after rollback. Both transactions were rolled back without any INSERT/UPDATE/DELETE/DDL or stock import. A full real write-path/rollback integration test remains unexecuted under the instruction not to import or alter stock.

## Commands and results

| Command/check | Result |
| --- | --- |
| `npm run db:check:local` | Passed: isolated development database, PostgreSQL 18.4. |
| `npm run test:unit` | 61 tests passed across four files; no real DB persistence. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed for API, web and shared. |
| `npm run build` | Passed for API and web; existing web chunk-size warning remains. |
| `npm run import:opening-stock -- --dry-run data/opening-stock/sample.json` | Passed: three made-up products, locations and stock lines; databaseAccessed=false. |
| CLI regression from an unrelated working directory without DATABASE_URL | Passed; relative paths resolve from the repository root. |
| Duplicate-row CLI regression without DATABASE_URL | Exit 1 with duplicate product/location explanation before DB initialization. |
| Root `.env` watcher restart | Passed; file content unchanged. |
| Division lock contention/release probe | Passed without modifying business records. |
| Live CEO sign-in through frontend | Owner confirmed success using the current password; no credential disclosure. |
| Read-only before/after database snapshots | Administrator credentials/mandatory-password flag unchanged; products, locations, balances, movements and import records remain zero. |

The existing `npm test` integration suite truncates tables and was not run. The new `test:unit` configuration explicitly avoids root secrets and that suite. No reset, truncate, deletion, migration, seed or deployment was performed.

## Business approval package

The private local directory `data/import-review/2026-11-15` now also contains:

- `BUSINESS_APPROVAL_CHECKLIST.md` — concise grouped decisions.
- `BUSINESS_APPROVAL_CHECKLIST.xlsx` — 17 category decisions plus every missing-unit source row.
- `missing-unit-decisions.csv` — exactly 382 rows: 118 Quality Foods and 264 LEGAYEBI, each assigned once to a descriptive category.

All unit, conversion, exception and approval fields are blank. Categories do not establish stocking units. Packaging, six repeated-name groups, 13 possible-alias groups, product variants and the 13 price candidates are separate decisions. Original report/preview data was retained, not turned into an approved import file.

Remaining blockers: business decisions, an explicitly signed final preview, and eventual write-path integration verification in an explicitly authorized disposable environment. Stop before the actual inventory import.
