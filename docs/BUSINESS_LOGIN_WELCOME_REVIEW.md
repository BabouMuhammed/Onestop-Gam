# Business entry and branded login verification

> The subsequent compact styling correction and shorter-desktop verification are recorded in [HOMEPAGE_COMPACT_LAYOUT.md](HOMEPAGE_COMPACT_LAYOUT.md). The navigation and authorization behavior documented below remains unchanged.

Completed on `integration-review`, 15 November 2026. This work changes frontend presentation and navigation only. No database access, migrations, real account sign-ins, inventory updates, price changes or deployment were performed.

## Inspection

Reviewed `apps/web/src/pages/Welcome.tsx`, `pages/Login.tsx`, `pages/ChangePassword.tsx`, `App.tsx`, `session.tsx`, `api.ts`, `layout/AppShell.tsx`, `ui/Button.tsx`, `styles.css`, and all existing company/business images under `apps/web/public/brand/`. Reviewed the existing role landing routes and permission guards alongside `apps/api/src/routes/auth.ts`, `apps/api/src/auth/guards.ts` and `packages/shared/src/permissions.ts`. The backend files were read only.

The public route already rendered independently of session queries. Login used one shared form and `/api/auth/login`. Authenticated landing destinations were selected from server-provided permissions. Managers' division scopes are enforced by the API regardless of a requested division header. The prior homepage used absolutely positioned small logos beneath the photographed slogan; this could not accommodate larger business panels reliably.

## Files changed for this request

| File | Change |
|---|---|
| `apps/web/src/pages/Welcome.tsx` | Two equal semantic navigation panels with official logos, business names, subtitles and arrow cues; existing Get Started action. |
| `apps/web/src/businessBranding.ts` | Fixed public branding entries and strict division-query allowlist. |
| `apps/web/src/pages/Login.tsx` | Reuses the existing form with optional business logo/title and a neutral account-access explanation. Adds Back to welcome. |
| `apps/web/src/styles.css` | Sampled logo-green tokens, responsive panels, focus/hover treatment and space reserved for the photographed signage. |
| `tools/check-welcome-navigation.mjs` | Repeatable browser regression suite with every API request mocked. |
| `docs/WELCOME_PAGE_VERIFICATION.md` | Points to this current verification, superseding the earlier small-logo layout. |
| `docs/BUSINESS_LOGIN_WELCOME_REVIEW.md` | This report. |

No backend, session provider, permission table, dashboard, package dependencies or image assets were changed for this request. Earlier unrelated working-tree changes were preserved.

## Branding and layout

Kept both existing background assets unchanged: `onestopgam-background-desktop.png` and `onestopgam-background-portrait.png`. No new photograph or generated image was introduced. The company name/logo and slogan remain in the photograph, without duplicate large visible headings. Existing official business assets remain `quality-foods.jpg` and `le-gaye-bi.jpg`; both use equal image frames with `object-fit: contain`.

The primary action uses **#167716**, sampled directly from opaque pixel **(62, 21)** in `onestopgam-mark.png` (105 x 98 pixels). The sample represents the largest quantized cluster of green pixels in that asset. It is defined as `--color-onestop-green`, with darker hover `--color-onestop-green-hover: #126312`. White text contrast is **5.70:1**. The operational application's existing blue action tokens are unchanged.

The business panels show QUALITY FOODS / Food & Wholesale and LEGAYEBI / Plumbing & Hardware. Both have equal dimensions, white backgrounds, restrained borders/shadows and visible keyboard focus. Get Started is 48px high, centered beneath them. Layout uses normal flow and a flexible spacer that accounts for the known source photograph's slogan position and centered `cover` crop. Content therefore stays below the photographed branding when the viewport changes. The spacer coefficients depend on these retained images and should be reviewed if those assets are replaced.

On small screens the panels stack and the document can scroll naturally. The backdrop occupies one viewport independently of document growth, so growing content cannot move the photographed signage over the controls. No clipping or fixed-height overflow hiding is used.

## Routes and authorization

| Entry | Destination | Signed-out presentation |
|---|---|---|
| Quality Foods panel | `/login?division=QUALITY_FOODS` | Quality Foods logo, QUALITY FOODS heading, Secure access to OneStop GAM. |
| LEGAYEBI panel | `/login?division=LE_GAYE_BI` | LEGAYEBI logo/heading, Secure access to OneStop GAM. |
| Get Started | `/login` | Existing company-branded general login. |

The query parser accepts exactly one occurrence of an exact allowlisted code. Unknown, differently cased, empty and repeated values fall back to general branding. Untrusted strings are never interpolated into image paths or HTML. All image paths and displayed business strings come from constants.

The selected business is not persisted or passed to the login endpoint, active division setter, authorization headers or session provider. The existing login request still contains only username and password. Existing server-provided account permissions/divisions control the destination and data scope. A manager choosing the other business still enters the manager's own authorized dashboard, with no division switch. CEO accounts retain both divisions and their existing Overview destination. Existing cashiers' role landing logic is unchanged.

The existing first-login password gate, password visibility control, login validation/errors, session cookies, CSRF guard, logout behavior and protected route guards are unchanged. Branded URLs survive refresh. Returning to `/` performs no logout or private API request. Existing authenticated division preferences are still checked against server-provided divisions; no permissions or new branding preference are written to local storage.

## Commands and results

| Command | Result |
|---|---|
| `npm run lint` | Passed, including the new browser script. |
| `npm run typecheck` | Passed for shared, API and web workspaces. |
| `npm run build -w @onestop/web` | Passed. Existing main chunk size warning remains (552.73 kB uncompressed). |
| `npm run test:unit` | **86 tests passed across 6 files**. Mocked persistence only; includes authentication and mandatory password-change behavior. |
| `node tools/check-welcome-navigation.mjs` | **33 browser checks passed**, no browser runtime errors, all API responses mocked, no database access. |
| `git diff --check` | Passed. Git reports existing LF/CRLF normalization notices for unrelated files. |

The exact browser command used the existing local Playwright installation without adding a project dependency:

```powershell
$env:PLAYWRIGHT_MODULE_PATH = Join-Path $env:TEMP 'onestop-ui-check/node_modules/playwright/index.mjs'
node tools/check-welcome-navigation.mjs
```

If Playwright is already available to the repository, the environment variable can be omitted. The script uses Microsoft Edge, Node 24's TypeScript support for shared role definitions, and the frontend at `http://localhost:5173`. Its fixtures intercept **every** `/api/**` request and use synthetic account data, including synthetic successful/failed login responses. They do not verify the real CEO password or mutate real login/audit records. No database integration suite was run because this task prohibits database modifications.

## Browser results

| Viewport | Document height | Result |
|---|---:|---|
| 1280 x 720 | 720 | Single screen; both panels and button clear of signage. |
| 1366 x 768 | 768 | Single screen; both panels and button clear of signage. |
| 1440 x 900 | 900 | Single screen; both panels and button clear of signage. |
| 1920 x 1080 | 1080 | Single screen; both panels and button clear of signage. |
| 768 x 1024 | 1024 | Side-by-side panels; no overflow. |
| 390 x 844 | 844 | Stacked panels; no overflow. |
| 320 x 568 | 638 | Natural vertical scrolling; branding and controls do not overlap. |
| 844 x 390 | 493 | Natural vertical scrolling in short landscape window. |

The 33 checks cover eight responsive layouts; three entry routes with refresh, CEO login continuation and return to the public homepage; seven invalid/repeated query cases; four manager/business combinations, including mismatches and an unauthorized remembered division; both branded mandatory-password flows; login failures for all three presentations; keyboard order/focus/Enter; and five protected routes.

Screenshots include the four explicitly requested sizes plus extra large/small screens, all three login presentations, and JSON evidence under ignored `data/integration-tests/business-welcome/`. Desktop, tablet, mobile and branded-login screenshots were visually inspected.

## Remaining limitations

- The existing frontend bundle-size warning is unchanged in nature; no unrelated splitting or dependency work was introduced.
- The existing business logo JPEGs determine source sharpness, including their original embedded text/edges; they were not redrawn or modified.
- Browser account and permission checks use mocked server responses. Server-side isolation code was inspected and left unchanged; the real database and accounts were not used for this task.
- Very small or short windows scroll by design to keep both the branding and usable controls visible.

No remaining blocking defect was found in the requested frontend flows. No deployment was performed.
