# Onestopgam

One system for Onestopgam Inc's two divisions, **Quality Foods** and **LEGAYEBI**: inventory, and later sales, contracts and finance. Each division keeps its own records; the CEO and Finance see both.

## What works today (Phases 1 to 3)

- **Sign-in and roles.** CEO, Finance, Manager and Cashier, each limited to what the role may do. Managers and cashiers are confined to their own division.
- **Inventory.** Products, storage locations, and the quantity of each product at each location.
- **Stock history.** Every change to stock is written to a permanent ledger with who, when and why.
- **Stock count.** A count sheet per location, like the Excel sheets it replaces. Posting a count corrects the system figures.
- **Stock adjustments.** Add or remove stock with a required reason.
- **Packs and sizes.** A product can record how many pieces are in each pack or box, and a size such as 1", DN 100 or 50mm.
- **Suppliers and receiving.** Record each delivery: supplier, date, the supplier's invoice number, and one line per item with where it was put, how many arrived and what each cost. Posting adds the stock and sets the item's cost price. A posted receipt is never edited; a mistake is reversed, which takes the stock back out and keeps both records.
- **Selling.** A till screen for scanning or searching items, with the basket kept on the device. Cash (with change), mobile money, bank transfer and cheque, in any mix. Receipts print at receipt-printer width.
- **Customers and credit.** A sale needs no customer. Paying less than the total needs a customer a manager has approved for credit; the balance is tracked and collected later.
- **Voids.** A sale is never edited or deleted. A manager who did not ring it up, or the CEO, can void it: stock returns and each payment is refunded on record.
- **Barcodes.** A product can carry the code printed on its pack.
- **Prices.** Products can exist without a selling price; managers set prices, and every change is logged.
- **Users and audit log.** The CEO manages accounts; CEO and Finance can read the audit log.
- **Opening stock import.** Loads a converted stock-count workbook as a division's starting stock.

Not built yet: selling while offline, contracts, deliveries, damages, finance, reports. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it locally

You need Node 22 or later and native PostgreSQL (the existing CI database uses PostgreSQL 16). For this Windows development environment use the installed PostgreSQL 18 service; Docker is unnecessary. See [the local verification report](docs/LOCAL_SETUP_REPORT.md) for current results and blockers.

Copy `.env.example` to `.env` only if `.env` does not already exist. Set its `DATABASE_URL` to the isolated `onestop_gam_dev` database owned by `onestop_dev` at `127.0.0.1:5432`, adding the existing password with URL encoding. Keep credentials in the ignored file. Run `npm run db:check:local` and require a successful identity check before running migrations or seeding. Do not use StockFlow databases.

```bash
test -e .env || cp .env.example .env  # preserve existing settings; fill in credentials locally
npm ci
npm run db:generate           # builds the database client
npm run db:check:local        # verifies the exact native development database
npm run db:migrate            # creates the tables
npm run db:seed               # creates the two divisions and the first administrator
npm run dev:api               # terminal 1: API on http://localhost:4000
npm run dev:web               # terminal 2: app on http://localhost:5173
```

Sign in with the administrator from `.env`. You are asked to replace the password straight away.

After that initial change, sign in with the password you chose; `SEED_ADMIN_PASSWORD` is not a password reset mechanism. The seed never replaces an existing administrator's credentials.

The API loads the absolute root `.env` before constructing its PostgreSQL adapter, validates an explicit database password, and checks connectivity before listening. `npm run dev:api` watches that file and restarts when it changes. Conflicting inherited `DATABASE_URL`, `WEB_ORIGIN` or `PORT` values stop development startup with a redacted configuration error; clear stale terminal variables instead of silently overriding them. Production uses its supplied environment rather than reading the development file.

Vite reads the same root `WEB_ORIGIN` and backend `PORT` for its listener and `/api` proxy. It uses `strictPort`: an occupied port is an error, rather than a switch from 5173 to 5174. Browser requests must use the configured origin. Root database/seed secrets and root `NODE_ENV` are not loaded into the frontend build configuration.

### Load the opening stock

The original company files have been imported into local development following explicit approval; see the [approved import report](docs/APPROVED_INVENTORY_IMPORT_REPORT.md). All 421 source rows and 14 locations are preserved, repeated descriptions remain independent source products, unspecified units are explicit, and prices/conversions remain null. Flagged stock is blocked from sale. Do not run a fresh or modified opening import against this existing inventory. The [source-preserving workflow](docs/SOURCE_INVENTORY_IMPORT.md) records the rehearsal and fingerprint. The legacy converter below can infer facts and was not used to invent units or prices for the approved batch.

The real stock counts are deliberately **not in this repository** (see Security). To load them:

```bash
pip install openpyxl
python3 tools/convert_workbooks.py "QUALITY FOODS INVENTORY.xlsx" QUALITY_FOODS 2026-11-10 data/opening-stock/quality-foods.json
python3 tools/convert_workbooks.py "LEGAYE BII STOCK INVENTORY.xlsx" LE_GAYE_BI 2026-11-11 data/opening-stock/le-gaye-bi.json
npm run import:opening-stock -- --dry-run data/opening-stock/quality-foods.json
```

The converter reads one sheet per location with an item column and a quantity column. It splits quantities such as `58(Pcs)` or `4 1/2 Bag` into a number and a unit, and treats a trailing `(D350)`, `(900)` or `(D3,500)` in an item name as a selling price in dalasi, and reads `(50Pcs each)` as a pack of 50 pieces. These inferred values require review. The importer refuses existing inventory; an identical approved import fingerprint is skipped without increasing stock again.

**The converter's defaults are not business approval.** It can infer pieces, prices and pack sizes. Resolve missing units and ambiguous names/packaging in the local approval checklist before producing final input. The importer now defaults to a database-free preview, rejects duplicate product/location rows and repeated source cells, and refuses conflicting metadata. It does not add repeated rows together. Relative input paths are resolved from the repository root. See [import safety and approval](docs/IMPORT_SAFETY.md) for the explicit approval gate and transactional replay protection. No actual inventory import has been authorized.

## Checks

```bash
npm test            # explicit TEST_DATABASE_URL, or ignored .env.integration; truncates test DB only
npm run test:unit   # isolated environment/auth/import tests; no database or truncation
npm run lint
npm run typecheck
npm run build
npm run test:tools  # workbook converter rules (needs Python and openpyxl)
```

The tests cover sign-in and lockout, forgery protection, division isolation, role permissions, stock that cannot go negative, simultaneous withdrawals of the last units, repeated submissions, and the append-only ledger.

Integration tests accept only an explicitly configured loopback `onestop*_test` database. They verify the connected database, user, port and public schema before running; each destructive cleanup repeats that check inside the same transaction as its table truncation. Development `DATABASE_URL` is never a test fallback. See [integration verification](docs/INTEGRATION_VERIFICATION.md) for the native PostgreSQL 18.4 results, synthetic 50-in/10-out workflows, and outstanding business approval gates.

## Layout

```
apps/api          Express + Prisma + PostgreSQL
apps/web          React + Vite + Tailwind
packages/shared   Roles, permissions, request schemas and formats used by both
tools             Workbook converter, database backup script
docs              Security, backup and restore, design system, roadmap
```

## Things to know

- **Verify migrations without resetting data.** All six existing migrations have also been applied successfully to the isolated native PostgreSQL 18.4 test database. For any future database, first verify its identity, inspect `prisma migrate status` and use `npm run db:migrate` (`migrate deploy`) for reviewed migrations. Do not accept reset prompts or run `prisma migrate reset`. Root development commands use `onestop_gam_dev`; migration commands for a test database must explicitly select its verified test URL.
- **Never run against production from a development machine.** `DATABASE_URL` in `.env` should point at a local database. Nothing here deploys anywhere.
- **Open questions** that affect later phases are listed in [docs/ROADMAP.md](docs/ROADMAP.md).
