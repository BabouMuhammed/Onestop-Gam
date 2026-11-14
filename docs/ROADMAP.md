# Roadmap

Work is done in phases. Each phase ends with passing tests and a review before the next begins. Nothing is deployed without explicit approval.

## Phase 1: Foundation (done)

Project setup, sign-in and roles, division isolation, design system, products, locations, stock levels and history, stock counts, adjustments, prices, users, audit log, opening stock import.

## Phase 2: Stock in and out

- Suppliers and stock receiving, with cost price captured on receipt
- Damages and write-offs, with approval
- Transfers between locations
- Batch and expiry dates for Quality Foods

## Phase 3: Sales

- Customers, with credit limits if credit sales are allowed
- Point of sale: barcode and keyboard first, receipt printing
- Returns and voids, with a second person approving
- Cashier shift open and close, with cash reconciliation

## Phase 4: Contracts and orders

- Fixed supply, ongoing supply and project-based contracts, for both divisions
- Customer orders, stock issue, deliveries and collections against a contract

## Phase 5: Finance and reports

- Invoices, payments and outstanding balances
- Reports and exports for each role
- CEO dashboard comparing the two divisions on sales and contracts

## Decisions made

- The app and printed documents use the names on the logos: **Onestopgam Inc**, **Quality Foods**, **Le Gaye Bi Group**. Division names are stored once, in the `Division` table.
- A bracketed number in an item name, such as `(D350)` or `(900)`, is a selling price in dalasi.
- Products may exist without a selling price. They can be counted and adjusted, and will not be sellable until a price is set.
- Cost prices will be captured when stock is received.
- Finance is read-only until the finance phase decides otherwise.

## Open questions

1. **"BMP stock".** Shelf 1 of the Le Gaye Bi workbook is titled "BMP stock inventory". It was imported as ordinary Le Gaye Bi stock. Is it owned or accounted for separately?
2. **"(1 FAN)"** on the PEX fittings: left in the item names as written. What does it mean?
3. **"Pan connector (400)" and "(200)"**, and the three "Basin tap" prices: kept as separate products. How do they differ?
4. **Units of sale.** Are items sold in a different unit from the one they are counted in (a carton counted, pieces sold)?
5. **Expiry dates.** Does Quality Foods need batch and expiry tracking for all food, or only chilled items?
6. **Credit sales and payment methods.** Is credit allowed? Which payment methods are accepted (cash, mobile money, bank transfer)?
7. **Finance.** Read-only, or able to record payments?
8. **Warehouses.** One site per division, or several?
9. **Logo.** The Quality Foods logo file is a low-resolution screenshot; an original is needed for receipts and invoices.
