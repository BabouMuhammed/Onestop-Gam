# Roadmap

Work is done in phases. Each phase ends with passing tests and a review before the next begins. Nothing is deployed without explicit approval.

## Phase 1: Foundation (done)

Project setup, sign-in and roles, division isolation, design system, products, locations, stock levels and history, stock counts, adjustments, prices, users, audit log, opening stock import.

## Phase 2: Suppliers and stock receiving (done)

Suppliers, stock receipts with cost price captured per line, optional batch number and expiry date on lines for items that track expiry, receipt reversal, cost price kept from cashiers.

## Phase 3: Sales and POS (done)

Customers, the till, split payments (cash, mobile money, bank transfer, cheque), credit for approved customers with later collection, voids with refunds, printable receipts, product barcodes.

## Phase 4: Selling while offline

- Sales recorded on the device when the connection is down, and sent when it returns
- What happens when two tills sold the same last item while offline
- A clear on-screen state for "saved here, not yet sent"

Phase 3 was built for this: the till chooses each sale's id, so sending a sale twice records it once.

## Phase 5: Cash-up

- Cashier shift open and close, with cash counted against sales
- Returns of part of a sale

## Phase 6: Damages and transfers

- Damages and write-offs, with a manager's approval
- Transfers between locations

## Phase 7: Contracts and orders

- Fixed supply, ongoing supply and project-based contracts, for both divisions
- Customer orders, stock issue, deliveries and collections against a contract

## Phase 8: Finance and reports

- Invoices, payments and outstanding balances
- Reports and exports for each role
- CEO dashboard comparing the two divisions on sales and contracts

## Decisions made

- The app and printed documents use the names on the logos: **Onestopgam Inc**, **Quality Foods**, **Le Gaye Bi Group**. Division names are stored once, in the `Division` table.
- A bracketed number in an item name, such as `(D350)` or `(900)`, is a selling price in dalasi. Thirteen Le Gaye Bi items carry one, including `(D3,500)` and `(D30,000)`.
- Opening stock is dated on the day it was counted: 10/11/2026 for Quality Foods, 11/11/2026 for Le Gaye Bi Group.
- `(50Pcs each)` in a name means the item is counted in packs of 50 pieces. `WHITE TAP (100 Pcs)` was left as written because its count carries the remark "ASKED IDA JALLOW".
- Products may exist without a selling price. They can be counted and adjusted, and will not be sellable until a price is set.
- Cost price is captured when stock is received. A product's cost price is the unit cost on its most recent receipt that still stands; the history is on the receipts. Whether to value stock at average cost instead is a Finance decision for the finance phase.
- A receipt records batch number and expiry date per line, but stock is not yet held per batch. That waits for the answer to the expiry question below.
- Receiving is done by a manager or the CEO. Cashiers cannot receive stock or see costs.
- Finance is read-only until the finance phase decides otherwise.
- Credit sales are allowed for named customers only, and only those a manager has approved. Decided by the owner on 14/11/2026.
- Payment methods: cash, mobile money, bank transfer, cheque. Every method except cash needs a reference.
- Full offline selling is wanted. It is its own phase, after Phase 3.
- At the till, stock is taken from the location holding the most of the item, then the next. A void puts it back where it came from.
- No tax or discount lines yet. Nothing in the brief asks for them.

## Open questions

1. **"BMP stock".** Shelf 1 of the Le Gaye Bi workbook is titled "BMP stock inventory". It was imported as ordinary Le Gaye Bi stock. Is it owned or accounted for separately?
2. **"(1 FAN)"** on the PEX fittings: left in the item names as written. What does it mean?
3. **"Pan connector (400)" and "(200)"**, and the three "Basin tap" prices: kept as separate products. How do they differ?
4. **Units of sale.** Are items sold in a different unit from the one they are counted in (a carton counted, pieces sold)?
5. **Expiry dates.** Does Quality Foods need batch and expiry tracking for all food, or only chilled items?
6. **Receipt printer.** Which printer is used? The receipt prints at 72mm wide through the browser's print dialog.
7. **Finance.** Read-only, or able to record payments?
8. **Warehouses.** One site per division, or several?
9. **Unnamed item.** Quality Foods Shelf 3 has a row named only `(POWER JUICE)` with 195 in stock. Which brand is it?
10. **Logo.** The Quality Foods logo file is a low-resolution screenshot; an original is needed for receipts and invoices.
