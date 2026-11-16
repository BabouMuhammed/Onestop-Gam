# Complete source inventory: approval-ready rehearsal

Execution update: the owner subsequently authorized this exact batch. See the [approved import report](APPROVED_INVENTORY_IMPORT_REPORT.md) for the completed development migration/import, backup, reconciliation and remaining business attention. The text below preserves the pre-approval rehearsal record.

Prepared on 15 November 2026 on `integration-review`. **Development inventory import is not authorized and has not been performed.** This verification supersedes the earlier limitation that the opening-stock PostgreSQL adapter had not been rehearsed.

## Final representation

| Business | Division | Products | Stock lines / OPENING movements | Locations | UNSPECIFIED units | Source-review flag |
|---|---|---:|---:|---:|---:|---:|
| Quality Foods | QUALITY_FOODS | 139 | 139 | 6 | 118 | 120 |
| LEGAYEBI | LE_GAYE_BI | 282 | 282 | 8 | 265 | 272 |
| Total | | 421 | 421 | 14 | 383 | 392 |

Every original source entry is an independent product/SKU and location balance. The six repeated-name pairs in LEGAYEBI remain separate source products; this deliberately replaces the earlier provisional 276-product grouping with **282 products**. No similar names, brands, materials, colours, sizes or galvanized/non-galvanized descriptions are merged. All original descriptions, including their whitespace, remain intact.

The 383 unspecified units comprise 382 absent units and one unconfirmed `Pac` expression. The remaining 38 explicitly recognized units are preserved. The exact original quantity/unit expression, source description, source file/hash, worksheet, name cell, quantity cell and original note cells are retained in product provenance. Numeric counts are checked against the original cells using exact decimals; `4 1/2 Bag` is stored as the equal quantity 4.5 BAG with the original expression retained. No packaging multiplier is used.

All selling prices, cost prices and pack conversions remain null. All source location titles remain unchanged and division-scoped. Location type is `OTHER`, avoiding an unapproved classification based on a sheet title. Expiry tracking remains false rather than being inferred from storage location.

**No source entries are omitted or unrepresentable as original source balances.** Some cannot safely be interpreted as confirmed sellable variants or stocking units: mixed-size aggregate lines, possible same-location overlapping counts, ambiguous package expressions and incomplete descriptions retain their exact original meaning and source flags. They are not resolved, split, summed or corrected. Historical source counts dated 10 November (Quality Foods) and 11 November (LEGAYEBI) are not certified present-day counts.

UNSPECIFIED units and `requiresStockReview` flags block sales at the API and POS, even if a selling price is subsequently set. Inventory and product detail show confirmation warnings. Product update requests cannot clear imported provenance/review flags. Later business confirmation must be an explicit reviewed action; this work does not authorize unit relabelling, conversions, merges or release of flagged stock.

## Schema and importer changes

Migration `20261115000000_source_stock_and_unspecified_units` adds the enum value, source-row identity/provenance and review flag. Source-row identities are unique within a division. The former all-products name uniqueness is replaced with a normal name index plus an exact-name unique partial index for manual products, so unchanged repeated source descriptions can coexist without removing manual-product uniqueness.

The importer retains its legacy validated mode and adds `preserveSourceRows: true`. In this mode, workbook SHA-256 and complete cell provenance are mandatory; product identity derives from division, source hash and cell references. Repeated actual source rows are rejected before persistence. Distinct original cells remain distinct records, including genuinely ambiguous repeated counts. Their review flags prevent treating those balances as confirmed sellable inventory.

Both businesses still share one PostgreSQL transaction, division locks, SKU generation and the existing `changeStock` ledger writer. Import fingerprints remain durable append-only AuditLog markers. Existing inventory is refused. Identical repeated imports return `already_imported` without increasing stock.

The normal `--apply` command still permits only the verified development target and matching named approvals. An explicit adapter factory option supports rehearsal only with `NODE_ENV=test` and an exact verified loopback `onestop*_test` identity. It does not add a CLI bypass or permit production targets.

## Rehearsal results

Final payload rehearsed in `onestop_gam_opening_fccdd3677a_test`, native PostgreSQL 18.4, public schema, loopback port 5432. All seven migrations applied there. The existing disposable integration database also received migration seven; the development database remains at six migrations pending authorization.

- Reconciled **421/421** source entries individually against persisted description, unit, provenance, location, division, quantity, historical count date, stock balance and OPENING ledger row. Zero mismatches.
- Injected a database exception during the second division's import audit, after stock writes. Both divisions' products, locations, stock, ledger, audit markers and SKU counters rolled back completely.
- Imported the complete batch successfully in the isolated database, then repeated it once normally and twice concurrently. All repetitions returned `already_imported`; persisted business rows stayed unchanged.
- Repeated an actual source row in input: rejected without writing anything.
- Verified 421 products, 421 stock levels, 421 OPENING ledger entries, 14 locations and two opening-import audit markers. No supplier receipts, sales or payments were created by import.
- Real Edge browser verification: Quality Foods 139 products/six locations; LEGAYEBI 282 products/eight locations. Source names and null prices matched; confirmation warnings displayed; POS refused unconfirmed products. Browser checks left stock unchanged.
- Read-only before/after verification: all 15 development business-table snapshots and administrator credential fields unchanged; original XLSX hashes unchanged. Development still has **zero products, locations, stock balances, ledger movements and opening-import audit markers**.

## Automated commands and results

| Command | Result |
|---|---|
| `npm run db:generate` | Passed. |
| `npm run db:check:local` | Exact development identity verified; no stock writes. |
| `node data/integration-tests/prepare-opening.mjs` | Created fresh disposable rehearsal database and applied seven migrations only to test databases. A first rehearsal was followed by a fresh final rehearsal after including original note-cell provenance. |
| `node data/integration-tests/run-opening.mjs` | Final complete PostgreSQL adapter rehearsal passed; uses the test-only environment and tracked `apps/api/scripts/rehearse-opening-stock.ts`. No truncation/reset is used by that harness. |
| `npm run test -w @onestop/api -- --reporter=default --reporter=json --outputFile=../../data/integration-tests/source-phase-suite-results.json` | **74/74 integration tests passed**, including prior 71 and three priced unconfirmed/flagged-stock sale rejection cases. |
| `npm run test:unit` | **86/86 passed**, including 11 additional source-preservation/target-gate cases. |
| `.venv\Scripts\python.exe tools/test_convert_workbooks.py` | **7/7 converter tests passed**. The legacy converter is not used to infer this final inventory. |
| `node data/integration-tests/browser-source-inventory.mjs` | Both division browser checks passed; temporary listeners closed. An initial harness selector matched a customer option instead of the product list; scoping it to the listbox resolved the harness issue. |
| `npm run lint` / `npm run typecheck` | Passed. |
| `npm run build` | API and web passed; non-blocking main frontend chunk warning remains at 549.90 kB. |
| `npm exec -w @onestop/api -- prisma validate` | Passed. |
| `node data/integration-tests/verify-opening-final.mjs` | Development preservation, original workbook hashes and final artifact checksums verified. |
| `git diff --check` | Passed. |

Private launchers, credentials, reports and company preview files remain ignored. No passwords or complete connection strings are recorded here.

## Final approval artifacts

Private files under `data/import-review/2026-11-15/final-source-import/`:

- `FINAL_IMPORT_PREVIEW.xlsx` and `.csv`: all 421 original source lines, quantities, unit evidence, division-specific locations, flags and provenance.
- `quality-foods.json`, `legayebi.json`: exact rehearsed inputs; **neither contains approval metadata**.
- `approval-manifest.json`: pending authorization, per-division fingerprints and combined batch fingerprint.
- `rehearsal-results.json`, `browser-results.json`, `development-preservation.json`, `artifact-checksums.json`: verification evidence.

Fingerprints:

```text
Quality Foods: 4585c7e83ee214fc2991be8043023c98a65015fe68750ee949c7f574668de219
LEGAYEBI:      ad9f34edf63aa67f21eb893bc53c21163d691deacfacac2d8790b42ad64537ac
Batch:         103ab8a13b639f6311b01abe37830fab2ecfa940bcc22f009f511e369b7bd54e
```

The batch fingerprint is SHA-256 of the importer-ordered array of `{division,fingerprint}` objects. Approval must refer to this exact batch. Any change to unit interpretation, quantities, descriptions, provenance, review decisions or source identity requires a new preview/rehearsal and approval.

## Exact development changes after explicit authorization

First recheck the development identity, original source hashes, final fingerprints, destination inventory and migration status. Apply the tested seventh schema migration before using the changed API against development; it is currently pending. Then record the actual named authorization on copies of the exact rehearsed inputs and execute the normal approved importer.

The stock transaction will create **421 products, 14 locations, 421 stock balances, 421 historical OPENING ledger entries and two import AuditLog records**. Quality Foods receives 139 products/balances/movements and six locations; LEGAYEBI receives 282 products/balances/movements and eight locations. The existing division SKU counters advance by 139 and 282 respectively. Existing division IDs/codes/names and administrator credentials are reused and preserved. No suppliers, purchasing receipts, customers, sales or payments are invented, and no existing inventory is overwritten.

Afterward verify all counts, quantities, ledger links, import markers and both development inventory screens; verify repeat execution is a no-op. **Stop before this step until the owner explicitly authorizes the fingerprinted batch.** Authorization to store these original counts is distinct from confirmation of units, resolution of overlapping counts, reconciliation to today's stock, or permission to sell flagged records. No deployment or next feature phase is included.
