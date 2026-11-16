# Native PostgreSQL business transaction verification

Later execution: [the approved original inventory import](APPROVED_INVENTORY_IMPORT_REPORT.md) has now completed in development. This report remains the earlier synthetic business-transaction verification record.

Subsequent verification: [complete source-preserving opening-stock rehearsal](SOURCE_INVENTORY_IMPORT.md) supersedes this report's earlier opening-adapter test limitation. The later run passed 74 integration tests, 86 unit tests and full isolated PostgreSQL import/replay/rollback checks; development import still requires explicit approval.

Verified on 15 November 2026 on `integration-review`, using Windows, Node 24.11.1 and native PostgreSQL 18.4. Existing uncommitted work was preserved. No application features, new migrations or dependency changes were introduced for this verification.

## Database isolation and setup

Created the disposable database `onestop_gam_integration_20261115_10ee7b60_test`, owned by `onestop_dev`, through the PostgreSQL management database. Verified the new database had an empty public schema before migrating it. The connected identity was checked as this exact database, role `onestop_dev`, server `127.0.0.1:5432`, schema `public`.

The private test URL is in ignored root `.env.integration`. It contains no administrator login credentials. Root `.env` was preserved. The test configuration accepts an explicit `TEST_DATABASE_URL` from the environment/root settings, or falls back to `.env.integration` when that value is empty. It never falls back to development `DATABASE_URL`.

Reviewed existing destructive setup before execution: `seedWorld()` truncates application tables before each integration test; other tests attempt forbidden updates/deletes to prove append-only database rules. All such operations ran exclusively in the new test database. Added URL validation, a connected-identity global setup, and identity verification in the **same transaction/connection** as every truncation. Targets must be loopback `onestop*_test` databases with credentials and only the public-schema URL option. Development and StockFlow targets are rejected. Fourteen database-free safety cases verify target and identity rejection.

All six existing migrations applied successfully using `prisma migrate deploy`; there were no PostgreSQL 18.4 errors. No reset was run. The test database remains available for repeat verification; it contains synthetic fixtures and is disposable. `npm test` will clear its application tables again.

## Commands and results

| Command executed from repository root | Result |
|---|---|
| `node data/integration-tests/setup.mjs` | Created/verified the new test database, saved a read-only development baseline, and ran `npm exec -w @onestop/api -- prisma migrate deploy` with explicitly selected test-only environment. All six migrations applied. This local setup script refuses to replace existing private test configuration; do not rerun it as a routine test command. |
| `npm run test -w @onestop/api -- --reporter=default --reporter=json --outputFile=../../data/integration-tests/existing-suite-results.json` | **65/65 integration tests passed** in five existing files. |
| `npm run test -w @onestop/api -- test/lifecycle.test.ts --reporter=default --reporter=json --outputFile=../../data/integration-tests/lifecycle-results.json` | **6/6 additional integration tests passed**. Total: **71 unique integration tests, 71 passed, none skipped**. |
| `npm run test:unit` | **75/75 passed**, including the 61 earlier tests and 14 new database-target safety tests. No database writes. |
| `node data/integration-tests/browser-draft.mjs` | Two real Edge browser checks passed through an isolated frontend proxy/API connected only to the test database. Temporary listeners on 5175/4101 were closed. |
| `npm run typecheck` | Passed for shared, API and web workspaces. |
| `npm run lint` | Passed after excluding ignored local integration artifacts from source linting. The initial run flagged Node globals in a local scratch script; no application lint defect was found. |
| `npm run build` | API and frontend builds passed. Frontend retains a non-blocking bundle-size warning (549.22 kB minified main chunk). Nothing was deployed. |
| `.venv\Scripts\python.exe data/import-review/2026-11-15/approval_process.py` | Generated two separate approval packs and a decision workbook; validated 382 unit-decision rows and 421 source/reconciliation rows. No database access. |
| `node data/integration-tests/verify-final.mjs` | Read-only final verification passed: six completed test migrations, zero ledger discrepancies, zero cross-division ledger links, zero remaining fault-injection triggers; development snapshots and both original workbook hashes unchanged. |
| `npm run db:check:local` | Development connectivity and exact identity reverified successfully against native PostgreSQL 18.4. No migration or stock write was performed. |
| `git diff --check` | Passed. |

The local scripts/results under `data/integration-tests/` are ignored artifacts. No connection strings or passwords appear in this report. The browser harness initially used an incorrect unit-label selector; it was corrected to the existing `pcs`/`pc` labels and both browser checks then passed. No application change was needed.

## Actual business transaction results

Each scenario starts from fresh synthetic fixtures, not company opening stock. Test-only prices of 10.00 selling and 4.00 cost are synthetic inputs and establish no business prices.

| Observed transaction | Quality Foods / QUALITY_FOODS | LEGAYEBI / LE_GAYE_BI |
|---|---|---|
| Create supplier and product through API | 201; own division | 201; own division |
| Fill receiving form with 50 units, review, cancel | 0 receipt POSTs; database unchanged | 0 receipt POSTs; database unchanged |
| Post receipt for 50 units | 201; stock 50 | 201; stock 50 |
| Retry same receipt concurrently three times | Replayed original; no additional records | Replayed original; no additional records |
| Create customer; sell 10 units | 201; paid 100.00; balance 0; stock 40 | 201; paid 100.00; balance 0; stock 40 |
| Retry same sale concurrently three times | Replayed original; no additional records | Replayed original; no additional records |
| Attempt to sell 41 remaining units | 409 OUT_OF_STOCK; stock stays 40 | 409 OUT_OF_STOCK; stock stays 40 |
| Ledger and history | RECEIPT +50 / balance 50; SALE -10 / balance 40; linked receipt/sale/payment and API history verified | Same results, division-scoped |
| Late receiving failure | Synthetic audit trigger raises after stock/cost writes; receipt, lines, stock, cost, audit and retry state roll back; same key succeeds after fault removal | Same |
| Late sale failure | Synthetic audit trigger raises after stock/payment writes; sale, lines, payment, stock, ledger, audit and retry state roll back; same sale ID succeeds after fault removal | Same |

The injected failures intentionally return 500. They are test faults, not unexplained application errors. Trigger creation/removal is also guarded by an identity check in the same test-database transaction; all injected triggers were removed.

Existing tests additionally passed concurrent last-unit sales/withdrawals, multi-location stock allocation, receiving reversals, sale voids/refunds, credit/payment collection, immutable ledger/receipt/sale/payment rules, authentication, first-login password changes, CSRF and role permissions.

## Division isolation and preservation

Both directions were tested: each division's manager was signed in while requesting the other division's ID. Foreign products, locations, suppliers and customers were rejected without transaction effects; foreign product/receipt/sale details returned 404 and foreign transaction lists stayed empty. Ledger links remained within the owning product/location/receipt/sale division. Existing CEO/Finance switching and cashier restrictions also passed.

Before/after read-only snapshots matched for all 15 development business tables, including division counters. Administrator credential fields matched; credentials were neither reset nor recreated. Development opening-import audit count remained **zero**. Original Quality Foods and LEGAYEBI XLSX SHA-256 hashes matched the original analysis. No company inventory was imported anywhere.

## Business approval process

Local business files remain ignored and contain no approved import authorization:

- [Quality Foods approval pack](../data/import-review/2026-11-15/QF_APPROVAL.md): 139 source lines, **118 missing units**, nine unit categories, seven similar-name variant pairs, six locations; count date 10 November 2026.
- [LEGAYEBI approval pack](../data/import-review/2026-11-15/LEGAYEBI_APPROVAL.md): 282 source lines, **264 missing units**, eight unit categories, six repeated-name groups, 13 possible alias groups, 43 similar-name variant pairs, eight locations; count date 11 November 2026.
- [Approval decisions workbook](../data/import-review/2026-11-15/APPROVAL_DECISIONS.xlsx): separate unit registers, full 421-line review and reconciliation registers, variants, locations, LEGAYEBI aliases and duplicates. All decision, conversion, price and sign-off fields remain pending/blank.

Review units by explicitly identified category subsets with exceptions, then resolve identity, packaging, variants, locations and unclear descriptions. Separately reconcile each historical count to an agreed cutoff, with evidence for intervening sales/receipts/transfers/returns/damage. Regenerate a final preview only after these decisions; the named approver must review its fingerprint and explicitly authorize execution. No missing unit defaults to pieces, and package capacities/dimensions are not quantity conversions. Thirteen LEGAYEBI price-like suffixes remain unapproved.

## Remaining limitations and import readiness

No stock, payment or division-isolation defect was found in the executed scenarios. Receiving has an unsaved client-side form and confirmation dialog, **not a persisted draft status or draft-receipt API**. The real browser checks establish that an unposted form has no stock effect; persisted drafts were not implemented as part of this verification.

The business transaction engine passes its PostgreSQL checks. **Opening-stock release readiness is conditional, not authorization to import.** This run exercised real receiving/sales and their stock-ledger writer; the complete opening-stock persistence adapter was not executed against PostgreSQL. Its existing validation/replay/rollback tests use mocked persistence. Do not interpret the 71 workflow tests as a full database rehearsal of that adapter.

Company stock remains blocked by unresolved units, duplicates/aliases, packaging, mixed variants, description/location decisions, historical reconciliation and final fingerprint approval. After those decisions, the next technical gate is a synthetic or approved-preview rehearsal of the opening-stock persistence path in an isolated test target, preserving the current development-target safety gate. Recheck that the actual destination still has no inventory before an explicitly authorized real import. No company import, destructive development operation or deployment was performed.
