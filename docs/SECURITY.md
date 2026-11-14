# Security

What protects the system today, where each rule lives, and what is still open.

## In place

| Risk | Protection | Where |
|---|---|---|
| Stolen or guessed passwords | Argon2id hashing; 10-character minimum; account locks for 15 minutes after 5 failures; sign-in rate limit per address | `apps/api/src/auth/password.ts`, `routes/auth.ts` |
| Default credentials | No default password exists. The first administrator comes from `.env`; new accounts get a random one-time password that must be replaced at first sign-in | `prisma/seed.ts`, `routes/users.ts` |
| Session theft | Random 256-bit token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored; 30-minute idle timeout and 12-hour limit; changing or resetting a password signs out other devices | `auth/session.ts` |
| Cross-site request forgery | SameSite=Strict cookie, a required custom header on every changing request, and an Origin check | `auth/guards.ts` |
| Reading another division's data | The division comes from the signed-in user for managers and cashiers, never from the request. Every query is filtered by it; another division's record answers 404 | `auth/guards.ts`, every route |
| Acting beyond a role | One permission table, enforced by the API on every route. The web app only hides what the API would refuse | `packages/shared/src/permissions.ts` |
| Negative or double-counted stock | Row lock per product and location inside a transaction; a database CHECK rejects negative quantities; idempotency keys make a repeated submission a no-op | `apps/api/src/stock.ts`, migration `integrity_rules` |
| Tampering with history | Stock ledger, price history, posted receipts and audit log are append-only: database triggers reject UPDATE and DELETE for every user, and no API route offers them | migration `integrity_rules`, `suppliers_and_receiving` |
| Wrong totals or costs | Line costs and receipt totals are computed by the server from quantity and unit cost; a total sent by the client is ignored. Cost prices are left out of every response to a cashier | `routes/receipts.ts`, `routes/products.ts` |
| Bad input | Every request is validated on the server against shared schemas; money and quantities travel as text and are stored as exact decimals | `packages/shared/src/schemas.ts` |
| Leaking internals | Password hashes are never selected for responses; server errors return a generic message in production | `routes/users.ts`, `http.ts` |
| Business data in a public repository | Real stock counts and workbooks are ignored by git; only a made-up sample is committed | `.gitignore` |
| Wiping the wrong database | Tests refuse to run unless the database name ends in `_test` | `apps/api/test/helpers.ts` |

## Who may do what

| | CEO | Finance | Manager | Cashier |
|---|---|---|---|---|
| Divisions | Both | Both | Own | Own |
| View inventory and stock history | Yes | Yes | Yes | Yes |
| Overview | Yes | Yes | Yes | No |
| Add or edit products and locations | Yes | No | Yes | No |
| Set prices | Yes | No | Yes | No |
| Adjust stock, post counts | Yes | No | Yes | No |
| View suppliers, receipts and cost prices | Yes | Yes | Yes | No |
| Add or edit suppliers | Yes | No | Yes | No |
| Receive stock, reverse a receipt | Yes | No | Yes | No |
| Manage users | Yes | No | No | No |
| Read the audit log | Yes | Yes | No | No |

Finance is read-only for now. Whether Finance should record payments is an open question for the finance phase.

## Still open

- **This repository is public.** Anyone can read the code. Keep `.env`, workbooks and price lists out of it, or make the repository private.
- **Backups.** `tools/backup.sh` and the restore steps are in [BACKUP.md](BACKUP.md), and were run end to end. They still have to be scheduled on the real server, with a copy kept off the machine.
- **HTTPS and deployment.** Cookies are marked Secure only when `NODE_ENV=production`; production must sit behind HTTPS. No deployment has been set up, by design.
- **Second factor.** CEO and Finance accounts would benefit from two-step sign-in.
- **Separation of duties.** Later phases must stop a cashier voiding their own sale and require a second person for write-offs.
- **Report exports.** CSV and Excel exports must escape cells that start with `=`, `+`, `-` or `@`.
