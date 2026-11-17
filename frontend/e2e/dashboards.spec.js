import { expect, test } from '@playwright/test'
import { PASSWORD, apiLogin, cleanup, makeVerifiedUser, me, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Dash University'
const created = []
test.afterAll(() => cleanup(created, [ORG]))

const trackConsole = (page) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  // 401/403/404 console lines are expected from deliberate negative checks.
  return () => errors.filter((e) => !/\b(401|403|404)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

test('student: dashboard, enrollments, profile edit, and no access to the admin area', async ({ page, request }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const email = `success+cloudartstu${tag}@simulator.amazonses.com`
  const username = `stu_${tag}`
  created.push(email)
  const consoleErrors = trackConsole(page)
  await makeVerifiedUser(request, { email, username, fullName: 'Dash Student', organization: ORG })

  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Welcome, Dash Student' })).toBeVisible()
  await expect(page.getByText(ORG).first()).toBeVisible()
  await expect(page.getByText('You haven’t enrolled in a course yet')).toBeVisible()
  await expect(page.getByText('New courses are on the way')).toBeVisible()

  // Students never see admin navigation, and the admin route bounces them back.
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/dashboard$/)

  // Real data: a published course appears under Explore, then under My courses once enrolled.
  sql(`insert into courses (title, slug, category_id, created_by, status, description, updated_at)
       select 'E2E AWS Basics', 'e2e-course-${ts}${info.project.name}', (select id from course_categories limit 1), id, 'PUBLISHED', 'Learn the basics', now()
       from users where email='${email}'`)
  await page.reload()
  await expect(page.getByText('E2E AWS Basics')).toBeVisible()
  sql(`insert into enrollments (user_id, course_id)
       select u.id, c.id from users u, courses c where u.email='${email}' and c.slug='e2e-course-${ts}${info.project.name}'`)
  await page.reload()
  await expect(page.getByText('You haven’t enrolled in a course yet')).toHaveCount(0)
  await expect(page.getByText('Active', { exact: true })).toBeVisible()
  await expect(page.getByText('New courses are on the way')).toBeVisible() // enrolled course leaves "Explore"

  // Profile: read-only identity fields, validation, and a successful edit.
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/dashboard\/profile$/)
  await expect(page.getByLabel('Username')).toHaveValue(username)
  await expect(page.getByLabel('Username')).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await page.getByLabel('Full name').fill('A')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Full name is required')).toBeVisible()
  await page.getByLabel('Full name').fill('Renamed Student')
  await page.getByLabel('I am a').selectOption('SRE')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile saved.')).toBeVisible()

  await page.getByRole('link', { name: 'My learning' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Renamed Student' })).toBeVisible()
  await page.reload() // persisted server-side, not just in memory
  await expect(page.getByRole('heading', { name: 'Welcome, Renamed Student' })).toBeVisible()
  await expect(page.getByText(/site reliability|sre/i).first()).toBeVisible()

  await noHorizontalOverflow(page)
  expect(consoleErrors(), 'console errors').toEqual([])
})

test('admin: stats, search, disable/enable a student, and guards on admins', async ({ page, request, browser }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartadm${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartstd${tag}@simulator.amazonses.com`
  const adminUser = `adm_${tag}`
  const studentUser = `std_${tag}`
  created.push(adminEmail, studentEmail)
  const consoleErrors = trackConsole(page)

  await makeVerifiedUser(request, { email: adminEmail, username: adminUser, fullName: 'Dash Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: studentUser, fullName: 'Target Student', organization: ORG })
  const studentToken = await apiLogin(request, studentEmail)
  expect((await me(request, studentToken)).status()).toBe(200) // provisions the DB profile

  // First login always creates a STUDENT; promotion happens in PostgreSQL (the only source of admin rights).
  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')
  await page.reload()
  await page.getByRole('link', { name: 'Go to the admin dashboard →' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible()

  // Statistics are real: they match the database.
  await expect(page.getByText('Recent sign-ups')).toBeVisible()
  const dbStudents = Number(sql(`select count(*) from users where system_role='STUDENT'`))
  await expect(page.getByText('Students', { exact: true })).toBeVisible()
  await expect(page.getByText(String(dbStudents), { exact: true }).first()).toBeVisible()

  // Search by username → exactly the target student.
  await page.getByLabel('Search users').fill(studentUser)
  await expect(page.getByTestId('user-row')).toHaveCount(1)
  const row = page.getByTestId('user-row')
  await expect(row).toContainText('Target Student')
  await expect(row).toContainText('Active')

  // Disable (two-step confirmation) → badge flips, the student is locked out of API and UI.
  await page.getByRole('button', { name: `Disable ${studentUser}` }).click()
  await page.getByRole('button', { name: 'Confirm disable' }).click()
  await expect(row).toContainText('Disabled')
  const locked = await me(request, studentToken)
  expect(locked.status()).toBe(403)
  expect((await locked.json()).error.code).toBe('ACCOUNT_DISABLED')

  const ctx = await browser.newContext()
  const stuPage = await ctx.newPage()
  await uiLogin(stuPage, studentEmail)
  await expect(stuPage.getByRole('alert')).toContainText('disabled')
  await expect(stuPage).toHaveURL(/\/login/)
  await stuPage.goto('/dashboard') // no half-signed-in session was kept
  await expect(stuPage).toHaveURL(/\/login/)
  await ctx.close()

  // Re-enable.
  await page.getByRole('button', { name: `Enable ${studentUser}` }).click()
  await page.getByRole('button', { name: 'Confirm enable' }).click()
  await expect(row).toContainText('Active')
  expect((await me(request, studentToken)).status()).toBe(200)

  // Admin accounts cannot be disabled from the UI.
  await page.getByLabel('Search users').fill(adminUser)
  await expect(page.getByTestId('user-row')).toHaveCount(1)
  await expect(page.getByTestId('user-row')).toContainText('Admin')
  await expect(page.getByRole('button', { name: /Disable|Enable/ })).toHaveCount(0)

  // Empty search result.
  await page.getByLabel('Search users').fill(`no-such-user-${ts}`)
  await expect(page.getByText(/No users match/)).toBeVisible()

  await noHorizontalOverflow(page)
  expect(consoleErrors(), 'console errors').toEqual([])
})

test('a user who is not signed in is sent to login from every protected page', async ({ page }) => {
  for (const path of ['/dashboard', '/dashboard/profile', '/admin']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
  }
  expect(PASSWORD).toBeTruthy()
})
