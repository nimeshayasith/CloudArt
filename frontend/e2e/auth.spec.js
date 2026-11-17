import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const POOL = process.env.COGNITO_USER_POOL_ID ?? 'ap-south-1_KXQljZJGU'
const REGION = process.env.COGNITO_REGION ?? 'ap-south-1'
const aws = (...args) => execFileSync('aws', ['cognito-idp', ...args, '--region', REGION, '--user-pool-id', POOL], { stdio: 'pipe' }).toString()
const sql = (q) => execFileSync('docker', ['exec', 'cloudart-db', 'psql', '-U', 'cloudart', '-d', 'cloudart_db', '-c', q], { stdio: 'pipe' })

const PASSWORD = 'Str0ng!Pass#1'
const created = []

test.afterAll(() => {
  for (const email of created) {
    try { aws('admin-delete-user', '--username', email) } catch { /* already gone */ }
    try { sql(`delete from users where email='${email}'; delete from organizations where name='E2E Browser University';`) } catch { /* ignore */ }
  }
})

async function fillRegister(page, over = {}) {
  const f = { fullName: 'Browser Tester', email: '', organization: 'E2E Browser University', username: '', role: 'SOFTWARE_ENGINEER', password: PASSWORD, confirm: PASSWORD, ...over }
  await page.getByLabel('Full name').fill(f.fullName)
  await page.getByLabel('Email', { exact: true }).fill(f.email)
  await page.getByLabel('University / Organization').fill(f.organization)
  await page.getByLabel('Username').fill(f.username)
  await page.getByLabel('I am a').selectOption(f.role)
  await page.getByLabel('Password', { exact: true }).fill(f.password)
  await page.getByLabel('Confirm password').fill(f.confirm)
}

test.describe('registration form validation (client side)', () => {
  test('shows field errors and the live password checklist', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Password', { exact: true }).fill('abc')
    await expect(page.getByText('At least 8 characters — not met')).toBeVisible()
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    for (const t of ['At least 8 characters', 'One uppercase letter', 'One lowercase letter', 'One number', 'One symbol']) {
      await expect(page.getByText(`${t}`, { exact: false }).first()).toBeVisible()
    }
    await expect(page.getByText('One symbol (e.g. ! @ # $) — met')).toBeVisible()

    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Full name is required')).toBeVisible()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
    await expect(page.getByText('University / organization is required')).toBeVisible()
    await expect(page.getByText('Choose your role')).toBeVisible()
  })

  test('rejects weak password and mismatched confirmation without calling the API', async ({ page }) => {
    let apiCalled = false
    page.on('request', (r) => { if (r.url().includes('/auth/register')) apiCalled = true })
    await page.goto('/register')
    await fillRegister(page, { email: 'a@b.co', username: 'validuser', password: 'weakpass', confirm: 'different' })
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Password does not meet all the requirements below')).toBeVisible()
    await expect(page.getByText('Passwords do not match')).toBeVisible()
    expect(apiCalled).toBe(false)
  })
})

test.describe('full journey against real Cognito', () => {
  test('register → verify (wrong code) → login blocked → verified → login → dashboard → logout', async ({ page }, info) => {
    const ts = Date.now()
    const email = `success+cloudartui${info.project.name}${ts}@simulator.amazonses.com`
    const username = `ui_${info.project.name}_${ts}`
    created.push(email)
    const consoleErrors = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    // Register
    await page.goto('/')
    await (info.project.name === 'mobile'
      ? page.getByRole('button', { name: 'Open menu' }).click().then(() => page.getByRole('link', { name: 'Sign up' }).click())
      : page.getByRole('link', { name: 'Sign up' }).click())
    await expect(page).toHaveURL(/\/register/)
    await fillRegister(page, { email, username })
    await page.getByRole('button', { name: 'Create account' }).click()

    // Verify page + wrong code
    await expect(page).toHaveURL(/\/verify/)
    await expect(page.getByText(email)).toBeVisible()
    await page.getByLabel('Verification code').fill('000000')
    await page.getByRole('button', { name: 'Verify email' }).click()
    await expect(page.getByRole('alert')).toContainText(/incorrect|expired/i)

    // Login before verification is redirected back to verification
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/verify/)

    // Duplicate registration with the same email is refused
    await page.goto('/register')
    await fillRegister(page, { email, username: `${username}x` })
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('An account with this email already exists').first()).toBeVisible()

    // We cannot read the emailed code, so confirm via admin API (and mark email verified like the real code flow does)
    aws('admin-confirm-sign-up', '--username', email)
    aws('admin-update-user-attributes', '--username', email, '--user-attributes', 'Name=email_verified,Value=true')

    // Wrong password
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('Wr0ng!Password')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByText('Incorrect email or password')).toBeVisible()

    // Correct login → dashboard with profile data
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: /Welcome, Browser Tester/ })).toBeVisible()
    await expect(page.getByText(username)).toBeVisible()
    await expect(page.getByText('E2E Browser University')).toBeVisible()
    await expect(page.getByText('STUDENT', { exact: true })).toBeVisible() // access level — never ADMIN from registration

    // Session survives a reload
    await page.reload()
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible()

    // No horizontal overflow on this viewport
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)

    // Logout → protected route redirects to login
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)

    expect(consoleErrors.filter((e) => !/401|403|409|400/.test(e)), consoleErrors.join('\n')).toEqual([])
  })
})
