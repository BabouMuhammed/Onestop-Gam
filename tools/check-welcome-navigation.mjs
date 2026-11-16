/** Browser regression checks. Every API request is intercepted; no database is used. */
import assert from 'node:assert/strict'
import console from 'node:console'
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL, URL } from 'node:url'
import { permissionsFor } from '../packages/shared/src/permissions.ts'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright')
const origin = 'http://localhost:5173'
const output = 'data/integration-tests/business-welcome'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const results = []
const runtimeErrors = []
const divisions = [
  { id: '00000000-0000-4000-8000-000000000001', code: 'QUALITY_FOODS', name: 'Quality Foods' },
  { id: '00000000-0000-4000-8000-000000000002', code: 'LE_GAYE_BI', name: 'LEGAYEBI' },
]
async function fixture({ viewport = { width: 1366, height: 768 }, role = 'CEO', accountDivision = 0, authenticated = false, forced = false, failLogin = false, remembered } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  if (remembered) await context.addInitScript((id) => globalThis.localStorage.setItem('onestop.division', id), remembered)
  const page = await context.newPage()
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  const calls = []
  const allowed = role === 'CEO' ? divisions : [divisions[accountDivision]]
  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    calls.push({ path, method: request.method(), headers: request.headers(), body: request.postDataJSON() })
    const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/api/auth/me') return authenticated
      ? send({ user: { id: 'fixture-user', username: 'fixture', name: 'Browser fixture', role, divisionId: role === 'CEO' ? null : allowed[0].id, mustChangePassword: forced }, permissions: permissionsFor(role), divisions: allowed })
      : send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } }, 401)
    if (path === '/api/auth/login') {
      if (failLogin) return send({ error: { code: 'BAD_CREDENTIALS', message: 'Incorrect username or password' } }, 401)
      authenticated = true
      return send({ ok: true })
    }
    if (path === '/api/auth/change-password') { forced = false; return send({ ok: true }) }
    if (path === '/api/auth/logout') { authenticated = false; return send({ ok: true }) }
    if (path === '/api/overview') return send({ divisions: allowed.map((division) => ({ divisionId: division.id, name: division.name, code: division.code, products: 0, withoutPrice: 0, outOfStock: 0, locations: 0, lastCountAt: null, lastMovementAt: null })) })
    assert.equal(request.method(), 'GET', 'Unexpected changing API request')
    return send({ rows: [], total: 0, page: 1, pageSize: 50 })
  })
  return { context, page, calls }
}
async function login(page) {
  await page.getByLabel('Username', { exact: true }).fill('fixture')
  await page.getByLabel('Password', { exact: true }).fill('synthetic-browser-test-only')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
function passed(check, detail = {}) { results.push({ check, ...detail, passed: true }) }
try {
  for (const [width, height] of [[1366, 650], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [768, 1024], [390, 844], [320, 568], [844, 390]]) {
    const { context, page, calls } = await fixture({ viewport: { width, height } })
    await page.goto(origin)
    await page.getByRole('link', { name: 'Sign in to Quality Foods', exact: true }).waitFor()
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
    const metrics = await page.evaluate(async () => {
      const rect = (selector) => globalThis.document.querySelector(selector).getBoundingClientRect().toJSON()
      const backdrop = globalThis.document.querySelector('.welcome-backdrop')
      const background = globalThis.getComputedStyle(backdrop).backgroundImage
      const photo = new globalThis.Image()
      photo.src = background.slice(5, -2)
      await photo.decode()
      const scale = Math.max(globalThis.innerWidth / photo.naturalWidth, globalThis.innerHeight / photo.naturalHeight)
      const scaledHeight = photo.naturalHeight * scale
      const portrait = background.includes('portrait')
      const signageBottom = scaledHeight * (portrait ? .63 : .724) + (globalThis.innerHeight - scaledHeight) / 2
      return { width: globalThis.innerWidth, height: globalThis.innerHeight, scrollWidth: globalThis.document.documentElement.scrollWidth, scrollHeight: globalThis.document.documentElement.scrollHeight,
        panels: [...globalThis.document.querySelectorAll('.welcome-business-panel')].map((el) => el.getBoundingClientRect().toJSON()),
        group: rect('.welcome-business-panels'), button: rect('.welcome-start'), signageBottom,
        logoFrames: [...globalThis.document.querySelectorAll('.welcome-panel-logo')].map((el) => el.getBoundingClientRect().toJSON()),
        green: globalThis.getComputedStyle(globalThis.document.querySelector('.welcome-start')).backgroundColor,
        logosContained: [...globalThis.document.querySelectorAll('.welcome-panel-logo')].every((image) => globalThis.getComputedStyle(image).objectFit === 'contain') }
    })
    assert(metrics.scrollWidth <= width, 'Horizontal overflow')
    if (width >= 1280 && height >= 650) {
      assert(metrics.scrollHeight <= height, 'Desktop must fit one screen')
      for (const box of [...metrics.panels, metrics.button]) {
        assert(box.top >= 0 && box.bottom <= height && box.left >= 0 && box.right <= width, 'A desktop entry is outside the viewport')
      }
      assert(metrics.panels.every((box) => box.width >= 220 && box.width <= 260 && box.height >= 50 && box.height <= 60), 'Desktop business entries must remain compact')
    }
    assert(metrics.group.top >= metrics.signageBottom, 'Business panels overlap photographed signage')
    assert(metrics.button.top >= metrics.signageBottom && metrics.button.height >= 44)
    assert(metrics.button.top >= metrics.group.bottom, 'CTA must sit below the entries at every viewport')
    assert(metrics.button.top - metrics.group.bottom >= 8 && metrics.button.top - metrics.group.bottom <= 12, 'CTA gap must remain small and comfortable')
    assert(Math.abs((metrics.button.left + metrics.button.right) / 2 - (metrics.group.left + metrics.group.right) / 2) < 1, 'CTA must be centered below the entries')
    assert.equal(metrics.panels[0].width, metrics.panels[1].width)
    assert.equal(metrics.panels[0].height, metrics.panels[1].height)
    assert(metrics.logosContained)
    assert(metrics.logoFrames.every((frame, index) => frame.height / metrics.panels[index].height >= .7), 'Too much empty space around logos')
    assert.equal(metrics.green, 'rgb(22, 119, 22)')
    assert.equal(await page.getByRole('link').count(), 3)
    assert.equal(calls.length, 0, 'Public page called an API')
    assert(!/GMD|stock balance|revenue|139|282|421/.test(await page.locator('main').innerText()))
    await page.getByRole('link', { name: 'GET STARTED', exact: true }).scrollIntoViewIfNeeded()
    assert(await page.getByRole('link', { name: 'GET STARTED', exact: true }).isVisible())
    await page.screenshot({ path: `${output}/welcome-${width}x${height}.png`, fullPage: true })
    passed('responsive layout, compact entries, visible CTA, brand green, no signage overlap or private data', { width, height, scrollHeight: metrics.scrollHeight, buttonBottom: metrics.button.bottom, signageBottom: metrics.signageBottom, entriesTop: metrics.group.top, panelWidth: metrics.panels[0].width, panelHeight: metrics.panels[0].height, layout: 'CTA centered below entries' })
    await context.close()
  }
  for (const [label, code, title] of [['Quality Foods', 'QUALITY_FOODS', 'QUALITY FOODS'], ['LEGAYEBI', 'LE_GAYE_BI', 'LEGAYEBI'], ['GET STARTED', null, 'Sign in']]) {
    const { context, page, calls } = await fixture()
    await page.goto(origin)
    await page.getByRole('link', { name: code ? `Sign in to ${label}` : label, exact: true }).click()
    await page.waitForURL(`${origin}/login${code ? `?division=${code}` : ''}`)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    if (code) {
      await page.getByRole('img', { name: `${label} logo`, exact: true }).waitFor()
      await page.getByText('Secure access to OneStop GAM.', { exact: true }).waitFor()
    }
    await page.reload()
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    await page.screenshot({ path: `${output}/login-${code ?? 'general'}.png`, fullPage: true })
    await login(page)
    await page.waitForURL('**/overview')
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
    const request = calls.find((call) => call.path === '/api/auth/login')
    assert.deepEqual(Object.keys(request.body).sort(), ['password', 'username'])
    assert(!request.headers['x-division-id'], 'Branding changed login authorization header')
    assert.equal(await page.getByRole('group', { name: 'Switch division' }).getByRole('button').count(), 2)
    await page.goto(origin)
    await page.getByRole('link', { name: 'GET STARTED', exact: true }).click()
    await page.waitForURL('**/overview')
    assert(!calls.some((call) => call.path === '/api/auth/logout'))
    passed('branded/general entry, refresh, existing CEO login and public return without logout', { code })
    await context.close()
  }
  for (const search of ['division=UNKNOWN', 'division=quality_foods', 'division=', 'division=__proto__', 'division=%3Cscript%3E', 'division=QUALITY_FOODS&division=LE_GAYE_BI', 'division=QUALITY_FOODS&division=QUALITY_FOODS']) {
    const { context, page } = await fixture()
    await page.goto(`${origin}/login?${search}`)
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
    await page.getByRole('img', { name: 'Onestopgam Inc', exact: true }).waitFor()
    assert.equal(await page.locator('img').getAttribute('src'), '/brand/onestopgam.png')
    passed('invalid/repeated division parameter falls back to general branding', { search })
    await context.close()
  }
  for (const accountDivision of [0, 1]) for (const selected of divisions) {
    const { context, page, calls } = await fixture({ role: 'MANAGER', accountDivision, remembered: divisions[1 - accountDivision].id })
    await page.goto(`${origin}/login?division=${selected.code}`)
    await login(page)
    await page.waitForURL('**/overview')
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
    await page.getByText(`Inventory position of ${divisions[accountDivision].name}`, { exact: true }).waitFor()
    await page.getByRole('table').first().waitFor()
    const scoped = calls.filter((call) => call.path === '/api/overview' || call.path === '/api/stock/movements')
    assert(scoped.length >= 2)
    assert(scoped.every((call) => call.headers['x-division-id'] === divisions[accountDivision].id))
    assert.equal(await page.getByRole('group', { name: 'Switch division' }).count(), 0)
    await page.goto(`${origin}/admin/users?division=${selected.code}`)
    await page.getByText('You do not have access to this page', { exact: true }).waitFor()
    assert(!calls.some((call) => call.path.startsWith('/api/admin/')))
    passed('manager division and restricted routes ignore selected branding and unauthorized remembered division', { accountDivision, selected: selected.code })
    await context.close()
  }
  for (const code of divisions.map((division) => division.code)) {
    const { context, page, calls } = await fixture({ forced: true })
    await page.goto(`${origin}/login?division=${code}`)
    await login(page)
    await page.getByRole('heading', { name: 'Choose your own password', exact: true }).waitFor()
    assert(calls.every((call) => call.path.startsWith('/api/auth/')))
    await page.getByLabel('Temporary password', { exact: true }).fill('synthetic-old-password')
    await page.getByLabel('New password', { exact: true }).fill('synthetic-new-password')
    await page.getByLabel('New password again', { exact: true }).fill('synthetic-new-password')
    await page.getByRole('button', { name: 'Save new password', exact: true }).click()
    await page.waitForURL('**/overview')
    passed('mandatory first-login password gate and continuation', { code })
    await context.close()
  }
  for (const suffix of ['', '?division=QUALITY_FOODS', '?division=LE_GAYE_BI']) {
    const { context, page } = await fixture({ failLogin: true })
    await page.goto(`${origin}/login${suffix}`)
    await login(page)
    await page.getByText('Incorrect username or password', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '')
    assert.equal(new URL(page.url()).pathname, '/login')
    passed('login failure is displayed and password cleared', { suffix })
    await context.close()
  }
  {
    const { context, page } = await fixture()
    await page.goto(origin)
    for (const name of ['Sign in to Quality Foods', 'Sign in to LEGAYEBI', 'GET STARTED']) {
      await page.keyboard.press('Tab')
      assert.equal(await page.locator(':focus').getAttribute('aria-label') ?? await page.locator(':focus').innerText(), name)
      assert.equal(await page.locator(':focus').evaluate((el) => globalThis.getComputedStyle(el).outlineStyle), 'solid')
    }
    await page.keyboard.press('Enter')
    await page.waitForURL('**/login')
    passed('keyboard order, visible focus and Enter navigation')
    await context.close()
  }
  for (const path of ['/inventory', '/admin/users', '/pos', '/receiving/new', '/account/password']) {
    const { context, page, calls } = await fixture()
    await page.goto(origin + path)
    await page.waitForURL('**/login')
    assert(calls.every((call) => call.path === '/api/auth/me'))
    passed('protected route remains protected', { path })
    await context.close()
  }
  assert.deepEqual(runtimeErrors, [])
  const report = { passed: results.length, results, runtimeErrors, apiResponsesMocked: true, databaseAccessed: false }
  writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
