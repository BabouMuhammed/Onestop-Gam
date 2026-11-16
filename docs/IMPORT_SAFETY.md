# Opening-stock validation and approval

The original business workbooks have been explicitly approved and imported into local development; see the [completed import report](APPROVED_INVENTORY_IMPORT_REPORT.md). Original workbooks and source-cell review artifacts remain unchanged. The [source-preserving workflow](SOURCE_INVENTORY_IMPORT.md) supports explicit UNSPECIFIED units and independently traceable source entries; business confirmation remains required before selling flagged records. Do not run a new or modified initial import against the existing inventory.

## Preview contract

`npm run import:opening-stock -- --dry-run path/to/file.json` validates all files and prints product/location/row totals and a SHA-256 fingerprint. `--dry-run` is the default. Paths are relative to the repository root or absolute. Preview neither initializes Prisma nor accesses PostgreSQL, and does not need credentials. The made-up `data/opening-stock/sample.json` can be used to exercise this path.

Inputs must specify one approved division code, a valid historical count date, source filename, and nonempty items. Each item requires a positive decimal quantity (up to PostgreSQL's 14,3 precision), explicit supported unit (including UNSPECIFIED), product name and division-scoped location. Prices and pack sizes may be null; they are never guessed by the importer. Expiry tracking defaults to false rather than being inferred from cold storage. Legacy inputs can supply optional `raw.sheet` and `raw.cell`. Source-preserving mode requires the source hash, both name/quantity cells, exact description and original quantity/unit expressions and issue flags.

Validation rejects:

- Repeated product/location pairs in legacy mode, or repeated source identities in source-preserving mode, even when their quantities differ. Neither silent summation nor silent dropping is allowed. Distinct original cells in source-preserving mode remain independent products/balances, even when names repeat.
- Repeated source cells, even when a later row changes its product or location.
- Inconsistent product units, pack sizes, selling prices, displayed spelling or expiry policy across locations for a shared legacy identity. Source-preserving records instead keep each source row's own unit evidence.
- Inconsistent location spelling/types, invalid count dates, unsupported divisions, missing units, excessive numeric precision and zero/negative quantities.
- Multiple files for the same division in one batch. All files validate before persistence begins.

Normalization detects ambiguity; it does not strip dimensions, invent aliases or combine variants. Legacy identity mappings require unambiguous rows. Source-preserving mode instead retains ambiguous overlapping source entries separately, with review flags blocking sales; importing the raw records does not certify those counts as independent sellable stock.

The legacy Python converter still contains inferred defaults; its output alone is not proof of confirmed units/prices/packaging. Use the review decisions to prepare final inputs. `data/import-review` contains private, ignored approval artifacts and is outside the default import directory. Its preview JSON is intentionally not importer input.

## Approval and replay protection

Execution requires both the explicit `--apply` option and this metadata on every input file:

```json
{
  "approval": {
    "approvedBy": "Name of the approving business owner",
    "approvedAt": "2026-11-15T00:00:00Z",
    "fingerprint": "the exact 64-character fingerprint from the approved preview"
  }
}
```

This is a schema example, not an actual approval. Do not add approval metadata on behalf of an owner who has not approved the underlying decisions. The fingerprint ties the approval to division, date, row content, quantity, unit, product metadata, source references, remarks and optional source-workbook checksum. Row order and JSON filename do not affect the fingerprint. Names are not inferred from filenames.

For future authorized execution, the storage adapter verifies the server-reported database, role, host, port and schema. It permits only the isolated development database, then locks all affected Division rows in stable order in a single READ COMMITTED Prisma transaction. It checks every locked division before writing either division.

An identical fingerprint recorded in that division's append-only import AuditLog returns `already_imported` without creating products, stock levels or movements. Different input is refused if products, locations, balances, movements or any prior import audit exist. A prior import lacking a fingerprint is also refused. Existing inventory is never overwritten or appended to by opening import.

Approved rows still use division-specific `nextSku`, `changeStock`, exact decimals, historical OPENING movements and the existing append-only ledger. Product/location caches are division-local. Audit records include the import fingerprint, individual row fingerprints, approver, date and provenance. Products, stock balances, ledger rows, audit markers and SKU counters commit together. All division files share one transaction, so a failure cannot commit only the first division. A second importer waits for the division lock and rechecks the committed import marker.

The durable import marker still uses the existing immutable AuditLog JSON payload. The UNSPECIFIED/provenance/review capability uses migration `20261115000000_source_stock_and_unspecified_units`, now applied in development after explicit authorization. Full PostgreSQL rollback, ordinary/concurrent replay and row-level reconciliation passed in isolation; the approved development import and repeated-execution no-op have also passed. See the completed import report for exact results.

## Verification without stock writes

- `npm run test:unit`: pure validation, CLI previews, isolated environment checks and real authentication routes with mocked persistence. No real administrator password is changed.
- `npm run import:opening-stock -- --dry-run data/opening-stock/sample.json`: synthetic, database-free preview only.
- Non-mutating division-lock probe: two development connections attempt the same Division row lock; the second NOWAIT request must fail with lock-not-available, and succeed after rollback. No stock or schema data is written.
- Read-only before/after snapshots verify unchanged inventory counts and unchanged administrator credential fingerprint/mandatory-password flag.

The existing `npm test` suite truncates a disposable database. Do not run it against the development database or under a prohibition on destructive database commands.
