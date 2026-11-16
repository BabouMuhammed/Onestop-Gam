# Design system

The interface is a working tool for warehouse staff, cashiers, managers, finance and the CEO. It is dense, quiet and consistent. Every screen is built from the tokens in `apps/web/src/styles.css` and the components in `apps/web/src/ui`.

## Principles

1. **The division is always named.** A coloured strip, the division's logo and its name sit at the top of every screen. CEO and Finance switch division there and nowhere else. Colour is never the only cue.
2. **Tables first.** Records are shown in tables with 36px rows, not cards. Numbers are right-aligned with tabular figures.
3. **Colour means something.** Blue is an action or the current page. Amber, red and green appear only where something needs attention or has succeeded. Ordinary values are plain text.
4. **Every number has a source.** Nothing on a dashboard is decorative; each figure links to the records behind it.
5. **Short paths.** Common actions take one dialog. Nothing simple is split across steps.

## Tokens

| Token | Value | Used for |
|---|---|---|
| `canvas` | `#f4f5f7` | Page background |
| `surface` | `#ffffff` | Tables, dialogs, bars |
| `sunken` | `#f8f9fa` | Table headers, footers, hover |
| `ink` / `ink-2` / `ink-3` | `#1a1d23` / `#4a5261` / `#666e7d` | Text: primary, secondary, hints |
| `line` / `line-strong` | `#dadde3` / `#a9afbb` | Dividers / control borders |
| `brand` | `#0b3a96` | Onestopgam blue, from the company logo |
| `ok` / `warn` / `danger` | `#1a6b2f` / `#875100` / `#b3261e` | Status only |
| `quality-foods` / `le-gaye-bi` | `#b8323a` / `#0a58c8` | Division marks only, from each logo |

All text colours meet WCAG AA contrast on `surface` and `canvas`.

- **Type:** IBM Plex Sans, self-hosted, weights 400, 500 and 600. Sizes 12, 13, 14 (body), 16 and 20px. It was chosen for its clear numerals: 0 and O, 1 and l are easy to tell apart in quantities and SKUs.
- **Radius:** 3px (small), 4px (controls), 6px (tables, dialogs).
- **Sizes:** controls 32px high (40px on touch screens), table rows 36px, sidebar 208px.
- **Borders, not shadows.** Only dialogs and notices cast a shadow.
- **Motion:** none, apart from the spinner on a busy button.

## Formats

- Money: `D 1,250.00` (`formatGMD`)
- Quantities: `1,097 pcs`, `4.5 bags` (`formatQuantityWithUnit`)
- Dates: `14/11/2026` and `14/11/2026 14:05` (`formatDate`, `formatDateTime`)

All four live in `packages/shared/src/format.ts`. Do not format by hand.

## Components

`Button`, `ButtonLink`, `Field`, `Input`, `Select`, `Textarea`, `Checkbox`, `DataTable`, `Pagination`, `Dialog`, `Alert`, `ErrorAlert`, `EmptyState`, `Loading`, `Flag`, `PageHeader`, `Section`, and `useNotify` for confirmations.

Rules for new screens:

- Use these components; do not restyle a one-off copy.
- Validation messages go under the field they belong to (`Field` does this).
- A button says what it does: "Save price", "Post count", not "Submit".
- An empty table says what belongs there and offers the action that fills it.
- Navigation lists only what the role can use (`layout/AppShell.tsx`).
- Check each new screen at 1440, 820 and 390px wide, in a real browser.

## Navigation by role

| Role | Sees |
|---|---|
| CEO | Overview, Inventory, Stock count, Locations, Users, Audit log |
| Finance | Overview, Inventory, Audit log |
| Manager | Dashboard, Inventory, Stock count, Locations |
| Cashier | Product lookup (opens with the search box focused) |

Later phases add Sales, Stock receiving, Customers, Contracts, Finance and Reports to the roles that use them.

The sidebar starts with Dashboard, followed by Selling, Stock, Setup and Admin groups.
Groups without permitted links are hidden. The top bar is the only division switch.
On Dashboard, CEO and Finance can also choose Both divisions; this dashboard scope is
held separately from the working division and does not change the division used by other pages.
