import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Courses University'
const VIDEO = 'dQw4w9WgXcQ'
const created = []
test.afterAll(() => cleanup(created, [ORG]))

const trackConsole = (page) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  // 400/401/403/404/409 console lines come from deliberate negative checks (bad video link, forbidden admin calls, …).
  return () => errors.filter((e) => !/\b(400|401|403|404|409)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

test('admin builds and publishes a course in the UI; the public sees only what is published', async ({ page, request, browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`
  const email = `success+cloudartcrs${tag}@simulator.amazonses.com`
  const title = `E2E Course ${tag}`
  created.push(email)
  const consoleErrors = trackConsole(page)

  await makeVerifiedUser(request, { email, username: `crs_${tag}`, fullName: 'Course Admin', organization: ORG })
  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)
  // Admin rights come only from PostgreSQL.
  expect(sql(`update users set system_role='ADMIN' where email='${email}' returning 1`)).toContain('1')
  await page.goto('/admin/courses')
  await expect(page.getByRole('heading', { name: 'Manage courses' })).toBeVisible()

  // ── create a course (with validation)
  await page.getByRole('button', { name: 'Add a course' }).click()
  await page.getByRole('button', { name: 'Create draft course' }).click()
  await expect(page.getByText('Title must be at least 3 characters')).toBeVisible()
  await expect(page.getByText('Choose a category')).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Category').selectOption({ label: 'AWS' })
  await page.getByLabel('Difficulty').selectOption('INTERMEDIATE')
  await page.getByLabel('Description').fill('Learn IAM, S3 and EC2 step by step.')
  await page.getByRole('button', { name: 'Create draft course' }).click()
  await expect(page).toHaveURL(/\/admin\/courses\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('Hidden from students')).toBeVisible()

  // ── an empty course cannot be published
  await page.getByRole('button', { name: 'Publish course' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'at least one published module' })).toBeVisible()

  // ── module
  await page.getByRole('button', { name: '+ Add module' }).click()
  await page.getByRole('button', { name: 'Add module', exact: true }).click()
  await expect(page.getByText('Title must be at least 3 characters')).toBeVisible()
  await page.getByLabel('Module title').fill('Getting started')
  await page.getByRole('button', { name: 'Add module', exact: true }).click()
  await expect(page.getByTestId('module-card')).toContainText('Getting started')

  // ── lessons: server-side video validation, then success
  await page.getByRole('button', { name: 'Add lesson to Getting started' }).click()
  await page.getByLabel('Lesson title').fill('First lesson')
  await page.getByLabel('YouTube link or video id').fill('not a video at all')
  await page.getByLabel('Length (minutes)').fill('10')
  await page.getByRole('button', { name: 'Add lesson', exact: true }).click()
  await expect(page.getByText('Enter a valid YouTube link or 11-character video id')).toBeVisible()
  await page.getByLabel('YouTube link or video id').fill(`https://youtu.be/${VIDEO}?si=abc`)
  await page.getByRole('button', { name: 'Add lesson', exact: true }).click()
  const rows = page.getByTestId('lesson-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('First lesson')
  await expect(rows.first()).toContainText('10 min')
  await expect(rows.first()).toContainText('Draft')

  await page.getByRole('button', { name: 'Add lesson to Getting started' }).click()
  await page.getByLabel('Lesson title').fill('Second lesson')
  await page.getByLabel('YouTube link or video id').fill(VIDEO)
  await page.getByLabel('Length (minutes)').fill('5')
  await page.getByRole('button', { name: 'Add lesson', exact: true }).click()
  await expect(rows).toHaveCount(2)

  // ── reorder persists across a reload
  await page.getByRole('button', { name: 'Move lesson First lesson down' }).click()
  await expect(rows.first()).toContainText('Second lesson')
  await page.reload()
  await expect(page.getByTestId('lesson-row').first()).toContainText('Second lesson')
  await expect(page.getByTestId('lesson-row').nth(1)).toContainText('First lesson')

  // ── edit a lesson
  await page.getByRole('button', { name: 'Edit lesson Second lesson' }).click()
  await expect(page.getByLabel('YouTube link or video id')).toHaveValue(VIDEO)
  await page.getByLabel('Lesson title').fill('Second lesson (renamed)')
  await page.getByRole('button', { name: 'Save lesson' }).click()
  await expect(page.getByTestId('lesson-row').first()).toContainText('Second lesson (renamed)')

  // ── publish lesson → module → course (only "First lesson" goes live)
  await page.getByRole('button', { name: 'Publish lesson First lesson' }).click()
  await expect(page.getByTestId('lesson-row').nth(1)).toContainText('Published')
  await page.getByRole('button', { name: 'Publish module Getting started' }).click()
  await page.getByRole('button', { name: 'Publish course' }).click()
  await expect(page.getByText('Live: students can see')).toBeVisible()

  // ── a published course cannot lose its last published lesson
  await page.getByRole('button', { name: 'Unpublish lesson First lesson' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'at least one published module' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unpublish lesson First lesson' })).toBeVisible() // unchanged
  await noHorizontalOverflow(page)

  // ── the public sees only published content, and never a video id
  const ctx = await browser.newContext()
  const pub = await ctx.newPage()
  await pub.goto('/courses')
  await pub.getByLabel('Search courses').fill(title)
  const card = pub.getByRole('link', { name: new RegExp(title) })
  await expect(card).toBeVisible()
  await expect(card).toContainText('AWS')
  await expect(card).toContainText('Intermediate')
  await expect(card).toContainText('1 lesson')
  await pub.getByRole('button', { name: 'AWS', exact: true }).click()
  await expect(pub.getByRole('link', { name: new RegExp(title) })).toBeVisible()

  const detail = pub.waitForResponse((r) => r.url().includes('/api/v1/courses/e2e-course-') && r.request().method() === 'GET')
  await pub.getByRole('link', { name: new RegExp(title) }).click()
  const body = await (await detail).text()
  expect(body).not.toContain(VIDEO)
  expect(body).not.toContain('youtube')
  await expect(pub.getByRole('heading', { name: title })).toBeVisible()
  await expect(pub.getByText('Getting started')).toBeVisible()
  await expect(pub.getByText('Second lesson (renamed)')).toHaveCount(0) // unpublished → hidden
  await expect(pub.getByText('First lesson')).toBeVisible()
  await expect(pub.getByRole('link', { name: 'Create free account' })).toBeVisible()
  await expect(pub.locator('main')).not.toContainText(VIDEO)
  await noHorizontalOverflow(pub)

  await pub.goto('/courses/no-such-course')
  await expect(pub.getByRole('heading', { name: 'Course not found' })).toBeVisible()

  // ── archive hides it from the public immediately
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.getByText('Hidden from the catalog')).toBeVisible()
  const gone = await request.get(`${API}/courses`, { params: { q: title } })
  expect((await gone.json()).total).toBe(0)
  await pub.goto('/courses')
  await pub.getByLabel('Search courses').fill(title)
  await expect(pub.getByText('No courses match your search.')).toBeVisible()
  await ctx.close()

  // ── delete the course (two-step confirmation)
  await page.getByRole('button', { name: 'Delete course' }).click()
  await page.getByRole('button', { name: 'Confirm delete course' }).click()
  await expect(page).toHaveURL(/\/admin\/courses$/)
  await page.getByLabel('Search courses').fill(title)
  await expect(page.getByText('No courses match.')).toBeVisible()

  expect(consoleErrors(), 'console errors').toEqual([])
})

test('student: browses the catalog, opens a course from the dashboard, and cannot reach course admin', async ({ page, request }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const email = `success+cloudartcst${tag}@simulator.amazonses.com`
  const slug = `e2e-course-stu-${tag}`.toLowerCase()
  created.push(email)
  const consoleErrors = trackConsole(page)

  await makeVerifiedUser(request, { email, username: `cst_${tag}`, fullName: 'Catalog Student', organization: ORG })
  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)

  // Seed a published course with one published module and lesson straight into PostgreSQL.
  sql(`with c as (
         insert into courses (title, slug, category_id, created_by, status, description, difficulty, updated_at)
         select 'E2E Student Course ${tag}', '${slug}', (select id from course_categories order by sort_order limit 1), id, 'PUBLISHED', 'A course for students', 'BEGINNER', now()
         from users where email='${email}' returning id),
       m as (
         insert into course_modules (course_id, title, is_published, sort_order) select id, 'Module Alpha', true, 0 from c returning id)
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, is_preview, sort_order, updated_at)
       select id, 'Preview lesson', '${VIDEO}', 900, true, true, 0, now() from m`)

  // Dashboard "Explore" links to the public course page.
  await page.reload()
  await page.getByRole('link', { name: /E2E Student Course/ }).click()
  await expect(page).toHaveURL(new RegExp(`/courses/${slug}$`))
  await expect(page.getByRole('heading', { name: `E2E Student Course ${tag}` })).toBeVisible()
  await expect(page.getByText('Module Alpha')).toBeVisible()
  await expect(page.getByText('Preview lesson')).toBeVisible()
  await expect(page.getByText('15 min').first()).toBeVisible()
  await expect(page.getByText('Preview', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enroll for free' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create free account' })).toHaveCount(0) // already signed in

  // Catalog is reachable from the signed-in shell; students get no admin navigation.
  await page.getByRole('link', { name: 'My dashboard' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.getByRole('link', { name: 'Courses', exact: true }).click()
  await expect(page).toHaveURL(/\/courses$/)
  await expect(page.getByRole('link', { name: 'Manage courses' })).toHaveCount(0)
  await noHorizontalOverflow(page)

  // Course administration is closed to students in the UI and in the API.
  for (const path of ['/admin/courses', '/admin/courses/11111111-1111-4111-8111-111111111111']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/dashboard$/)
  }
  const token = await apiLogin(request, email)
  for (const [method, url, data] of [
    ['get', '/admin/courses'],
    ['post', '/admin/courses', { title: 'Sneaky course', categoryId: '11111111-1111-4111-8111-111111111111' }],
    ['patch', '/admin/courses/11111111-1111-4111-8111-111111111111', { status: 'PUBLISHED' }],
  ]) {
    const res = await request[method](`${API}${url}`, { headers: { Authorization: `Bearer ${token}` }, data })
    expect(res.status(), `${method} ${url}`).toBe(403)
  }
  expect(sql(`select count(*) from courses where title='Sneaky course'`)).toBe('0')

  expect(consoleErrors(), 'console errors').toEqual([])
})

test('a visitor who is not signed in is sent to login from course administration, but can browse the catalog', async ({ page }) => {
  for (const path of ['/admin/courses', '/admin/courses/11111111-1111-4111-8111-111111111111']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
  }
  await page.goto('/courses')
  await expect(page).toHaveURL(/\/courses$/)
  await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible()
})
