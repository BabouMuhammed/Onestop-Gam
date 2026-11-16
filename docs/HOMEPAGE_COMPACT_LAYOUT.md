# Compact business panels with centered Get Started

Current implementation on `integration-review`, 15 November 2026. This targeted refinement keeps the existing corporate reception images, company logo/signage, official business logos and all login routes unchanged. No authentication, backend, PostgreSQL, inventory, price or deployment changes were made.

## Current layout

- Desktop panels are **250px wide**, **60px high**, reduced to **56px high** for short desktop windows at heights up to 700px. They sit side by side with a 12px gap and equal dimensions.
- Both entries use dark-green surfaces with thin borders, contained 84 x 44px logo frames, compact typography and minimal padding. White is limited to the small logo frames. No source image was modified.
- **Get Started is always centered beneath the entries**, including short desktop windows. The previous horizontal three-action row has been removed.
- The primary button is **224 x 44px**, separated from the panels by **8px**, using the existing official-logo green **#167716**, white text and the existing hover/focus effects.
- At widths below 600px, entries stack within a maximum 320px-wide action group. Content can scroll naturally on unusually small/short screens.
- The controls stay in normal document flow. The existing spacer accounts for the background photograph's centered crop and reserves its slogan area. Short desktop windows reduce outer padding to 12px. No hidden overflow or absolutely positioned controls are used.

## Files modified

- `apps/web/src/styles.css`: panel dimensions, typography, spacing, responsive layout and button placement.
- `apps/web/src/pages/Welcome.tsx`: logo element dimensions aligned with the compact frames.
- `tools/check-welcome-navigation.mjs`: assertions for 220-260px desktop panel widths, 50-60px heights, centered CTA beneath the panels at every viewport, 8-12px CTA gap, complete desktop button visibility, equal panel sizes, slogan clearance and logo containment.
- This verification report.

## Navigation and safety

The existing routes remain `/login?division=QUALITY_FOODS`, `/login?division=LE_GAYE_BI` and `/login`. Branded login presentation, the strict query allowlist, server-derived account permissions and mandatory password-change process are unchanged. The browser suite uses synthetic login/session responses with every API request intercepted. It does not access the real database or verify real credentials.

## Verification

Commands run: `npm run lint`, `npm run typecheck`, `npm run build -w @onestop/web`, and the browser command below. The existing main-bundle size warning remains non-blocking.

```powershell
$env:PLAYWRIGHT_MODULE_PATH = Join-Path $env:TEMP 'onestop-ui-check/node_modules/playwright/index.mjs'
node tools/check-welcome-navigation.mjs
```

Screenshots and detailed results are stored under ignored `data/integration-tests/business-welcome/`. Desktop screenshots at 1366 x 650 and 1366 x 768 and the 390 x 844 mobile screenshot were visually inspected. The suite also captures 1280 x 720, 1440 x 900, 1920 x 1080, tablet and smaller/shorter mobile layouts. All critical desktop link rectangles are checked before any scroll-into-view operation; entries are checked against the known photographed slogan boundary. Navigation, invalid queries, login errors, manager/account mismatches, CEO continuation, first-login password changes, protected routes and keyboard access are covered by the same suite.

## Results

Lint, workspace type checking, frontend build and **34 browser checks passed**. No browser runtime errors were reported. All API responses were mocked.

| Viewport | Panel size | Document height | Get Started bottom |
|---|---|---:|---:|
| 1366 x 650 | 250 x 56px | 650px | 638.0px |
| 1280 x 720 | 250 x 60px | 720px | 704.0px |
| 1366 x 768 | 250 x 60px | 768px | 752.0px |
| 1440 x 900 | 250 x 60px | 900px | 882.0px |
| 1920 x 1080 | 250 x 60px | 1080px | 1058.4px |

All four requested desktop sizes have no vertical scroll and retain the complete button below the two panels, clear of the slogan. Additional 1920 x 1080 verification also passed. Screenshots include `welcome-1366x650.png`, `welcome-1366x768.png`, `welcome-1280x720.png` and `welcome-1440x900.png` in the evidence directory.
