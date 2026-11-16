# Approved original inventory import

Executed 15 November 2026 on `integration-review`, following the owner's explicit authorization of batch:

```text
103ab8a13b639f6311b01abe37830fab2ecfa940bcc22f009f511e369b7bd54e
```

Target verified before backup, migration, import and reconciliation: **onestop_gam_dev**, role **onestop_dev**, PostgreSQL **127.0.0.1:5432**, schema **public**. No production or StockFlow database was changed. No existing database was reset.

## Imported and reconciled records

| Business | Division | Products | Stock balances | OPENING ledger entries | Locations | Historical count date |
|---|---|---:|---:|---:|---:|---|
| Quality Foods | QUALITY_FOODS | 139 | 139 | 139 | 6 | 2026-11-10 |
| LEGAYEBI | LE_GAYE_BI | 282 | 282 | 282 | 8 | 2026-11-11 |
| Total | | **421** | **421** | **421** | **14** | |

All 421 source entries matched persisted product descriptions, exact decimal quantities, supported units, original quantity/unit expressions, file/hash, worksheet, name cell, quantity cell and original note cells. Each balance has exactly one corresponding historical OPENING movement; there are **zero ledger mismatches and zero cross-division links**.

Source entries have independent SKUs, including repeated names. Similar descriptions, galvanized/non-galvanized products, sizes, brands, colours and materials were not merged. The mixed-size source line remains an unsplit flagged original entry. No entry was omitted and no quantity was multiplied by a package size or capacity.

Prices, cost prices and packaging conversions are all null. All 14 original location titles are retained in their own division, with generic OTHER classifications. Historical movements use the original count dates, not today's date. These records establish the authorized original opening counts; they do not certify current physical stock.

## Backup and migration

A PostgreSQL 18 custom-format backup was created **before any schema or stock change**, in a private execution directory whose filesystem access was restricted to the current Windows user and SYSTEM. Passwords were supplied only through the child process environment, never in command arguments or reports.

- Backup: `data/import-review/2026-11-15/final-source-import/execution-2026-11-15T06-22-44-141Z/onestop_gam_dev-before-import.dump`
- Size: **58,336 bytes**.
- SHA-256: `ae85c7b9b8ca54dc436c968f9ddfd2a0749888ff8039dd47d77bb2ac7ae589c7`.
- `pg_restore --list` succeeded. A full restore with `--exit-on-error` into the new disposable database `onestop_gam_backup_verify_bd2886edbf_test` succeeded; business/user/audit snapshot digests matched the pre-import database. No existing database was overwritten by this verification.

Only `20261115000000_source_stock_and_unspecified_units` was pending. Its SQL checksum matched the migration applied in the successful final rehearsal. `npm run db:migrate` applied that migration only. Development now has **seven completed migrations**.

## Execution and safety results

The original preview/input artifacts and both source XLSX hashes were rechecked and preserved. Authorization metadata was added to separate input copies under the private execution directory. The original unapproved preview inputs were not overwritten.

The existing approved CLI and PostgreSQL adapter imported both divisions within one transaction, using division locks, source-row identities, existing SKU generation and `changeStock`. It created exactly two append-only `stock.opening_imported` audit markers, carrying the authorized division fingerprints and approval record. SKU counters advanced by 139 for Quality Foods and 282 for LEGAYEBI; existing division IDs/codes/display names and administrator credential fields were preserved. Receipt and sale numbering counters were unchanged. No suppliers, receipts, customers, sales, payments or price changes were invented.

The exact approved command was run again after commit. Both divisions returned **already_imported**; complete snapshots of division/product/location/stock/ledger/audit rows were identical before and after that repeat.

Per-division fingerprints:

```text
QUALITY_FOODS: 4585c7e83ee214fc2991be8043023c98a65015fe68750ee949c7f574668de219
LE_GAYE_BI:    ad9f34edf63aa67f21eb893bc53c21163d691deacfacac2d8790b42ad64537ac
```

## Verification commands

| Command | Result |
|---|---|
| `node data/integration-tests/verify-opening-final.mjs` before import | Approved artifacts, original XLSX hashes, exact development identity and unchanged pre-import inventory confirmed. |
| `node data/integration-tests/approved-import-preflight.mjs` | Fingerprint matched; backup creation/list/restore validation passed; only the rehearsed pending migration permitted. |
| `npm run db:migrate` | Only reviewed migration seven applied successfully. |
| `node data/integration-tests/apply-approved-import.mjs` | Called existing `import-opening-stock.ts --apply` using authorized copies; both imported. Repeat returned already_imported without data changes. |
| `node node_modules/tsx/dist/cli.mjs apps/api/scripts/verify-approved-opening-stock.ts` | Read-only, row-by-row reconciliation of all 421 original entries passed; unrelated transaction tables, credential fields and division identities preserved. |
| `node data/integration-tests/browser-approved-inventory.mjs` | **Both live development browser checks passed** using the owner's existing CEO sign-in. Quality Foods 139 products/six locations; LEGAYEBI 282 products/eight locations; source names, confirmation warnings and POS refusal of unconfirmed stock verified. Application left open. |
| `npm run test -w @onestop/api -- --reporter=default --reporter=json --outputFile=../../data/integration-tests/post-approved-import-suite.json` | **74/74 integration tests passed** against the separate `onestop_gam_integration_20261115_10ee7b60_test` database. Its cleanup never targeted development. |
| `npm run test:unit` | **86/86 passed**, without database writes. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed after correcting a strict undefined-row check in the new read-only verification script; no application behavior changed. |
| `git diff --check` | Passed. |
| `.venv\Scripts\python.exe tools/report_import_execution.py data/import-review/2026-11-15/final-source-import/execution-2026-11-15T06-22-44-141Z` | Generated a 421-record business attention workbook/CSV with actual imported SKUs and source references. |

The previous full rehearsal additionally established second-division transaction rollback, concurrent replay protection and duplicate-source rejection. No deployment or new feature phase was performed.

## Application verification

The existing API and frontend remain available at `http://localhost:4000` and `http://localhost:5173`. A visible verification browser was opened for the owner's existing CEO sign-in; no passwords were requested in chat, read or reset.

**Both live authenticated development screen checks passed.** Quality Foods displayed 139 products and six locations; LEGAYEBI displayed 282 products and eight locations. Complete API lists reached through the frontend proxy matched the original descriptions and null prices. The product detail warnings appeared, and selecting an unconfirmed item at POS showed the business-confirmation message while leaving the basket empty. The application remains open on the imported inventory.

The first sign-in acknowledgment did not authenticate the separate verification browser; the owner then signed into that window and the automated checks completed. No session was fabricated or authentication bypassed. The final read-only database reconciliation was repeated after the browser checks to confirm stock and transaction integrity.

## Records requiring business attention

| Business | Unconfirmed units | Flagged source records | Products without a selling price |
|---|---:|---:|---:|
| Quality Foods | 118 | 120 | 139 |
| LEGAYEBI | 265 | 272 | 282 |
| Total | **383** | **392** | **421** |

The source-review group overlaps the unconfirmed-unit group. The 383 UNSPECIFIED records comprise 382 missing stocking units and CAP NAIL's unresolved `Pac` expression. The other 38 source units are preserved explicitly. UNSPECIFIED units and source-review flags block sales at the API and POS even if a selling price is later set. All products currently also lack selling prices.

The attention workbook identifies every imported SKU, quantity, location, source file/cells, original unit expression and issue. Priority review includes:

- LEGAYEBI's six repeated-name groups and 13 possible alias groups. Same-location bend/tee count pairs remain separate and flagged; no presumed duplicate was silently dropped or added to another product's balance.
- Pack-count ambiguities, including wall-plug packs, WHITE TAP's parenthetical count, CAP NAIL's Pac expression and MAGGI's qualified pack wording. No contents multiplier or price interpretation was assumed.
- The mixed small/big door-mat entry, incomplete product descriptions, uncertain measurement labels and BMP-labelled shelf ownership context.
- Confirmation of stocking units, then separately approved selling prices and any actual packaging definitions. Do not turn a capacity/size label into a conversion factor.
- Reconciliation of all original historical counts to an agreed current cutoff, accounting for receipts, sales, transfers, returns, damage and recounts exactly once.

Business review must preserve original provenance and stock-ledger history. No further balance changes, merges, unit conversions or release of review flags are authorized by this import alone.

## Private evidence and business files

Under `data/import-review/2026-11-15/final-source-import/execution-2026-11-15T06-22-44-141Z/`:

- `preflight-and-backup.json`, `onestop_gam_dev-before-import.dump`.
- `authorized-inputs/`, `import-results.json`, `replay-results.json`.
- `database-verification.json`, `attention-register.json`.
- `INVENTORY_ATTENTION.xlsx`, `INVENTORY_ATTENTION.csv`.
- `browser-verification.json` when live checks pass.

These company records, backups and browser evidence remain ignored and private. The original workbooks remain unchanged.
