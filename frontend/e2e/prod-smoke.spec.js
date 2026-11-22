import { expect, test } from '@playwright/test'

// Browser check of the LIVE site. It touches only public pages and uses no database or AWS access, so it is safe to run against
// production:   E2E_BASE_URL=https://<your-cloudfront-address> npx playwright test e2e/prod-smoke.spec.js
// It fails on any console error, on any Content-Security-Policy violation report, and on horizontal scrolling.
test.skip(!process.env.E2E_BASE_URL, 'set E2E_BASE_URL to the live address to run this check')

const PUBLIC_PAGES = ['/', '/courses', '/labs', '/pricing', '/login', '/register']

test('the live site loads its public pages with no console errors and no policy violations', async ({ page }) => {
  const problems = []
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' || /Content Security Policy|\[Report Only\]/i.test(text)) problems.push(`${m.type()}: ${text}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`))
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`))

  for (const path of PUBLIC_PAGES) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body'), path).not.toBeEmpty()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${path} scrolls sideways`).toBe(false)
  }

  // The catalog is fetched from the API through the same address: the data arrives (an empty list is fine, an error is not).
  await page.goto('/courses')
  await expect(page.getByRole('heading', { name: /courses/i }).first()).toBeVisible()

  expect(problems, 'console problems').toEqual([])
})

test('React routes survive a reload, and protected pages send a visitor to log in', async ({ page }) => {
  for (const path of ['/dashboard', '/services', '/admin', '/subscription']) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/login/)
  }
  // A page that does not exist is handled by the app (redirect to home), not by an S3 error document.
  await page.goto('/no/such/page')
  await expect(page).toHaveURL(/\/$/)
  expect(await page.title()).toMatch(/CloudArt/i)
})

test('the API through the site address answers JSON, including its 404s', async ({ request }) => {
  const base = process.env.E2E_BASE_URL
  const health = await request.get(`${base}/api/v1/health`)
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })

  const missing = await request.get(`${base}/api/v1/no-such-route`)
  expect(missing.status()).toBe(404)
  expect(missing.headers()['content-type']).toMatch(/application\/json/)
  expect((await missing.json()).error.code).toBe('NOT_FOUND')

  expect((await request.get(`${base}/api/v1/users/me`)).status()).toBe(401)
  expect((await request.get(`${base}/api/v1/admin/stats`)).status()).toBe(401)
  const categories = await request.get(`${base}/api/v1/service-categories`)
  expect((await categories.json()).categories.length).toBeGreaterThan(0)
})
