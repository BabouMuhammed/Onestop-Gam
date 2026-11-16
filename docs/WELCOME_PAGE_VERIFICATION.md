# Public welcome homepage

> Superseded layout verification: see [BUSINESS_LOGIN_WELCOME_REVIEW.md](BUSINESS_LOGIN_WELCOME_REVIEW.md) for the current clickable business panels, sampled logo green, branded login presentation and 33 browser checks. The sections below record the preceding small-logo implementation.

Implemented on `integration-review`, 15 November 2026. The change is confined to frontend routing, a new public page and scoped welcome styles. Existing dashboards, API authentication, session handling on the server, permissions and database code are unchanged. The sign-out controls in the app shell and mandatory password-change screen now share a corrected client sign-out hook. No imported records, prices or stock were accessed or changed by verification.

## Behavior

- `/` always displays the public ONE STOP GAMBIA welcome page with the full-screen company photograph, small Quality Foods and LEGAYEBI logos below the photographed tagline, and one Get Started action.
- Get Started uses the existing shared `ButtonLink` and navigates to `/login`.
- `/login` displays the existing login form for signed-out users. Successful login continues to the existing role-based destination: overview, POS or inventory according to existing permissions.
- An authenticated user visiting `/login` continues to that same destination. The welcome page remains accessible to authenticated users at `/`.
- The existing mandatory password-change screen continues to block protected screens until completed.
- Signed-out visits to protected routes redirect to `/login`. Existing signed-in route permission guards remain intact.
- The welcome route does not mount session-dependent application components or request any API data. It renders even if the backend is unavailable; no private quantities, sales or finances appear.

## Current design: photographic background

The latest requested layout uses the supplied company-wall photograph as the full-screen homepage background. The previous visible headings, description cards and secondary text have been removed. The photograph itself supplies the company name and tagline. Only the existing Quality Foods and LEGAYEBI logos and a single Get Started link are overlaid beneath the photographed tagline. An accessible page heading and company description remain available to screen readers.

Two separate background assets were adapted from the previously enhanced photograph using the built-in image-generation tool:

- `apps/web/public/brand/onestopgam-background-desktop.png`
- `apps/web/public/brand/onestopgam-background-portrait.png`

Prompt: faithfully adapt the supplied marble-wall photograph for landscape 16:10 and portrait 9:19 backgrounds; preserve the blue/green logo, exact text "Onestopgam Inc", "Your Onestop Company", "Trusted to deliver Excellence", marble, wood slats, spotlights and plant; extend the wall and adjust framing, keep signage undistorted, leave bare marble beneath the tagline for live website controls, add no new branding, words or UI. Source/enhanced assets and business logo files are unchanged.

CSS chooses the portrait photograph for square/portrait windows and uses `cover` to preserve image proportions. Controls remain beneath the signage, with a minimum 44px button and keyboard focus ring. Standard tested screen sizes fit one viewport; unusually short windows allow vertical scrolling so the button is never clipped. Desktop/mobile screenshots are stored in ignored `data/integration-tests/welcome-page/`.

## Sign-out correction

The previous sign-out handler cleared the entire React Query cache before setting the session query to null. This removed the active observed query, leaving the authenticated UI stale after a successful logout. The shared `useSignOut` hook cancels pending requests, removes private cached queries while retaining the observed session query, sets that session to null, clears the selected division and returns to `/login`. An expired-session 401 is treated as already signed out. Server/network failures keep the session state and show a retryable error. Both desktop/mobile navigation and the mandatory password-change screen show pending feedback and prevent repeated clicks.

## Verification

| Command | Result |
|---|---|
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed for all workspaces. |
| `npm run build -w @onestop/web` | Passed. Existing non-blocking main-bundle size warning remains. |
| `node data/integration-tests/welcome-page-check.mjs` | **14 browser checks passed**, no browser runtime errors. All API calls were intercepted with synthetic responses; no real credentials, sessions or database writes were used. |
| `node data/integration-tests/sign-out-check.mjs` | **7 browser checks passed**: desktop, mobile, fresh re-login, expired session, server/network failures and retry, mandatory password-change sign-out. API responses were mocked; no real user sessions or database records were changed. |
| `git diff --check` | Passed. |

The browser checks cover five viewports (320, 390, 768, 1024 and 1440px), responsive photographic backgrounds, both business logos loading, correct logo/button order, no horizontal or vertical overflow at the tested normal-zoom sizes, keyboard focus and Enter activation, existing login-form submission and dashboard continuation, five protected routes, authenticated CEO/cashier redirects, public-root access when signed in, and mandatory password change through completion. Every fresh public homepage loaded with **zero API calls**, including with simulated backend failure.

Desktop/mobile screenshots were visually reviewed. Local screenshots and JSON results are in ignored `data/integration-tests/welcome-page/`. No deployment was performed.
