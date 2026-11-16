# Onestopgam

One system for Onestopgam Inc's two divisions, **Quality Foods** and **Le Gaye Bi Group**: inventory, and later sales, contracts and finance. Each division keeps its own records; the CEO and Finance see both.

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
- **Damages.** Anyone at the shop can report broken, expired, spoiled or missing stock. It is written off only when a manager who did not report it, or the CEO, approves; the loss keeps its value at cost.
- **Barcodes.** A product can carry the code printed on its pack.
- **Prices.** Products can exist without a selling price; managers set prices, and every change is logged.
- **Users and audit log.** The CEO manages accounts; CEO and Finance can read the audit log.
- **Opening stock import.** Loads a converted stock-count workbook as a division's starting stock.

Not built yet: selling while offline, contracts, deliveries, damages, finance, reports. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it locally

You need Node 22 or later and PostgreSQL 16 (or Docker).

```bash
cp .env.example .env          # then set SEED_ADMIN_USERNAME, SEED_ADMIN_NAME and SEED_ADMIN_PASSWORD
docker compose up -d          # starts PostgreSQL; skip if you run your own
npm install
npm run db:generate           # builds the database client
npm run db:migrate            # creates the tables
npm run db:seed               # creates the two divisions and the first administrator
npm run dev:api               # terminal 1: API on http://localhost:4000
npm run dev:web               # terminal 2: app on http://localhost:5173
```

Sign in with the administrator from `.env`. You are asked to replace the password straight away.

### Load the opening stock

The real stock counts are deliberately **not in this repository** (see Security). To load them:

```bash
pip install openpyxl
python3 tools/convert_workbooks.py "QUALITY FOODS INVENTORY.xlsx" QUALITY_FOODS 2026-11-10 data/opening-stock/quality-foods.json
python3 tools/convert_workbooks.py "LEGAYE BII STOCK INVENTORY.xlsx" LE_GAYE_BI 2026-11-11 data/opening-stock/le-gaye-bi.json
npm run import:opening-stock
```

The converter reads one sheet per location with an item column and a quantity column. It splits quantities such as `58(Pcs)` or `4 1/2 Bag` into a number and a unit, and treats a trailing `(D350)`, `(900)` or `(D3,500)` in an item name as a selling price in dalasi, and reads `(50Pcs each)` as a pack of 50 pieces. Review the JSON before importing. A division that already has products is skipped, so the import cannot run twice.

## Checks

```bash
npm test            # API tests against the test database (it is wiped on every run)
npm run lint
npm run typecheck
npm run build
npm run test:tools  # workbook converter rules (needs Python and openpyxl)
```

The tests cover sign-in and lockout, forgery protection, division isolation, role permissions, stock that cannot go negative, simultaneous withdrawals of the last units, repeated submissions, and the append-only ledger.

## Layout

```
apps/api          Express + Prisma + PostgreSQL
apps/web          React + Vite + Tailwind
packages/shared   Roles, permissions, request schemas and formats used by both
tools             Workbook converter, database backup script
docs              Security, backup and restore, hosting a demo, design system, roadmap
```

## Things to know

- **Verify the migrations once.** The SQL in `apps/api/prisma/migrations` was written by hand to match the Prisma schema, because Prisma's migration engine could not be downloaded in the environment where this was built. It was applied to a real PostgreSQL 16 database and all tests pass against it. Run `npm run db:migrate:dev -w @onestop/api` once on your machine: if Prisma reports a difference it will generate a small follow-up migration, which should be reviewed and committed.
- **Never run against production from a development machine.** `DATABASE_URL` in `.env` should point at a local database. Nothing here deploys anywhere.
- **Open questions** that affect later phases are listed in [docs/ROADMAP.md](docs/ROADMAP.md).
