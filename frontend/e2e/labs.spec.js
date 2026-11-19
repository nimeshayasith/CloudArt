import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Labs University'
const created = []
test.afterAll(() => {
  try { sql(`delete from lab_enrollments where lab_id in (select id from labs where slug like 'e2e-lab-%'); delete from labs where slug like 'e2e-lab-%'`) } catch { /* ignore */ }
  cleanup(created, [ORG])
})

// A stand-in for YouTube's IFrame API (the real one needs the internet and cannot be driven by a test).
const FAKE_YOUTUBE = `
window.YT = {
  PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
  Player: class {
    constructor(el, opts) {
      const box = document.createElement('div')
      box.setAttribute('data-testid', 'fake-player')
      box.dataset.videoId = opts.videoId
      box.style.cssText = 'width:100%;height:100%'
      el.replaceWith(box)
      this.box = box
      setTimeout(() => opts.events.onReady({ target: this }), 0)
    }
    getCurrentTime() { return 0 }
    getDuration() { return 0 }
    destroy() { this.box.remove() }
  }
}
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0)
`
const installFakeYouTube = (page) =>
  page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ contentType: 'application/javascript', body: FAKE_YOUTUBE }))

const trackConsole = (page) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  // 400/403/404/409 console lines come from deliberate negative checks (bad link, ticked-step delete, …).
  return () => errors.filter((e) => !/\b(400|401|403|404|409)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

test('admin builds a lab in the UI; a student joins, completes it, and the progress is exported', async ({ page, request, browser }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartlba${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartlbs${tag}@simulator.amazonses.com`
  const title = `E2E Lab ${tag}`
  created.push(adminEmail, studentEmail)
  const adminErrors = trackConsole(page)
  await installFakeYouTube(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `lba_${tag}`, fullName: 'Lab Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: `lbs_${tag}`, fullName: 'Lab Student', organization: ORG })
  const adminToken = await apiLogin(request, adminEmail)
  const studentToken = await apiLogin(request, studentEmail)
  for (const t of [adminToken, studentToken]) await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${t}` } })
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')

  // ── admin: create the lab
  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/labs')
  await expect(page.getByRole('heading', { name: 'Manage labs' })).toBeVisible()
  await page.getByRole('button', { name: 'Add a lab' }).click()
  await page.getByRole('button', { name: 'Create draft lab' }).click()
  await expect(page.getByText('Title must be at least 3 characters')).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Difficulty').selectOption('INTERMEDIATE')
  await page.getByLabel('Estimated minutes (optional)').fill('45')
  await page.getByLabel('Description').fill('Create and use your first S3 bucket.')
  await page.getByRole('button', { name: 'Create draft lab' }).click()
  await expect(page).toHaveURL(/\/admin\/labs\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const labId = new URL(page.url()).pathname.split('/').pop()
  const slug = sql(`select slug from labs where id='${labId}'`)
  expect(slug).toMatch(/^e2e-lab-/)

  // an empty lab cannot be published
  await page.getByRole('button', { name: 'Publish lab' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'at least one step' })).toBeVisible()

  // details
  await page.getByLabel('Prerequisites (optional)').fill('An AWS account')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Lab saved.')).toBeVisible()

  // ── steps: one with a code block, one required, one optional
  await page.getByRole('button', { name: '+ Add step' }).click()
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await expect(page.getByText('Title must be at least 3 characters')).toBeVisible()
  await page.getByLabel('Step title').fill('Create a bucket')
  await page.getByLabel('Instructions', { exact: true }).fill('Open the console, then run:\n```\naws s3 mb s3://my-first-bucket\n```\nCheck that it exists.')
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await expect(page.getByTestId('step-card')).toHaveCount(1)

  await page.getByRole('button', { name: '+ Add step' }).click()
  await page.getByLabel('Step title').fill('Upload a file')
  await page.getByLabel('Instructions', { exact: true }).fill('Upload any small file.')
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await expect(page.getByTestId('step-card')).toHaveCount(2)

  await page.getByRole('button', { name: '+ Add step' }).click()
  await page.getByLabel('Step title').fill('Bonus: enable versioning')
  await page.getByLabel('Required to complete the lab').uncheck()
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await expect(page.getByTestId('step-card')).toHaveCount(3)
  await expect(page.getByTestId('step-card').nth(2)).toContainText('Optional')

  // ── resources: unsafe links are refused, safe ones saved (lab-level and per step)
  await page.getByRole('button', { name: 'Add resource to the lab' }).click()
  await page.getByLabel('Resource title').fill('Lab guide')
  await page.getByLabel('Resource type').selectOption('LINK')
  await page.getByLabel('Link (https://…)').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Add resource', exact: true }).click()
  await expect(page.getByText('Enter a link starting with https://')).toBeVisible()
  await page.getByLabel('Link (https://…)').fill('https://example.com/guide')
  await page.getByRole('button', { name: 'Add resource', exact: true }).click()
  await expect(page.getByTestId('resource-row')).toHaveCount(1)

  await page.getByRole('button', { name: 'Add resource to the lab' }).click()
  await page.getByLabel('Resource title').fill('Theory: S3 basics')
  await page.getByLabel('YouTube link or video id').fill('https://youtu.be/dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Add resource', exact: true }).click()
  await expect(page.getByTestId('resource-row')).toHaveCount(2)

  await page.getByRole('button', { name: 'Add resource to step 1' }).click()
  await page.getByLabel('Resource title').fill('Hands-on: make a bucket')
  await page.getByLabel('Resource type').selectOption('HANDS_ON_VIDEO')
  await page.getByLabel('YouTube link or video id').fill('abcdefghijk')
  await page.getByRole('button', { name: 'Add resource', exact: true }).click()
  await expect(page.getByTestId('resource-row')).toHaveCount(3)

  // ── edit and reorder (the optional bonus step moves up), persisted across a reload
  await page.getByRole('button', { name: 'Edit step 1' }).click()
  await page.getByLabel('Step title').fill('Create an S3 bucket')
  await page.getByRole('button', { name: 'Save step' }).click()
  await expect(page.getByTestId('step-card').first()).toContainText('Create an S3 bucket')
  await page.getByRole('button', { name: 'Move step 3 up' }).click()
  await expect(page.getByTestId('step-card').nth(1)).toContainText('Bonus: enable versioning')
  await page.reload()
  await expect(page.getByTestId('step-card').nth(1)).toContainText('Bonus: enable versioning')
  await noHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Publish lab' }).click()
  await expect(page.getByText('Live: students can find this lab and join it.')).toBeVisible()

  // ── a visitor sees the overview but none of the guarded content
  const visitorCtx = await browser.newContext()
  const visitor = await visitorCtx.newPage()
  await visitor.goto('/labs')
  await visitor.getByLabel('Search labs').fill(title)
  const card = visitor.getByRole('link', { name: new RegExp(title) })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Intermediate')
  await expect(card).toContainText('3 steps')
  await visitor.getByRole('button', { name: 'Beginner' }).click()
  await expect(visitor.getByText('No labs match your search.')).toBeVisible()
  await visitor.getByRole('button', { name: 'Intermediate' }).click()
  await visitor.getByRole('link', { name: new RegExp(title) }).click()
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible()
  await expect(visitor.getByText('An AWS account')).toBeVisible()
  await expect(visitor.getByText('Create an S3 bucket')).toBeVisible()
  await expect(visitor.getByText('aws s3 mb')).toHaveCount(0)
  await expect(visitor.getByText('example.com/guide')).toHaveCount(0)
  await expect(visitor.getByRole('link', { name: 'Create free account' })).toBeVisible()
  await visitor.goto('/labs/no-such-lab')
  await expect(visitor.getByRole('heading', { name: 'Lab not found' })).toBeVisible()
  await visitor.goto(`/labs/${slug}/work`)
  await expect(visitor).toHaveURL(/\/login/)
  await visitorCtx.close()

  // ── student: join and work through the lab
  const ctx = await browser.newContext()
  const stu = await ctx.newPage()
  const studentErrors = trackConsole(stu)
  await installFakeYouTube(stu)
  await uiLogin(stu, studentEmail)
  await expect(stu).toHaveURL(/\/dashboard$/)
  await expect(stu.getByText('You haven’t started a lab yet.')).toBeVisible()
  await expect(stu.getByText('Labs to try')).toBeVisible()
  await stu.goto(`/labs/${slug}`)
  await stu.getByRole('button', { name: 'Start this lab' }).click()
  await expect(stu).toHaveURL(new RegExp(`/labs/${slug}/work$`))
  await expect(stu.getByRole('heading', { name: 'Step 1: Create an S3 bucket' })).toBeVisible()
  await expect(stu.getByRole('heading', { name: 'Step 2: Bonus: enable versioning' })).toBeVisible()
  await expect(stu.getByRole('heading', { name: 'Step 3: Upload a file' })).toBeVisible()
  await expect(stu.getByText('(optional)')).toBeVisible()
  await expect(stu.getByText('0 of 3 steps done')).toBeVisible()

  // instructions: the fenced command is a code block, never raw backticks
  const first = stu.getByTestId('lab-step').first()
  await expect(first.locator('pre code')).toHaveText('aws s3 mb s3://my-first-bucket')
  await expect(first.getByRole('button', { name: 'Copy' })).toBeVisible()
  await expect(stu.getByText('```')).toHaveCount(0)
  await expect(first).toContainText('Open the console, then run:')
  await expect(first).toContainText('Check that it exists.')

  // resources: links open safely in a new tab, videos play on request
  const guide = stu.getByRole('link', { name: /Lab guide/ })
  await expect(guide).toHaveAttribute('href', 'https://example.com/guide')
  await expect(guide).toHaveAttribute('target', '_blank')
  await expect(guide).toHaveAttribute('rel', /noopener/)
  await expect(stu.getByTestId('fake-player')).toHaveCount(0)
  await stu.getByRole('button', { name: /Watch: Theory: S3 basics/ }).click()
  await expect(stu.getByTestId('fake-player')).toHaveAttribute('data-video-id', 'dQw4w9WgXcQ')
  await first.getByRole('button', { name: /Watch: Hands-on: make a bucket/ }).click()
  await expect(stu.getByTestId('fake-player')).toHaveCount(2)
  await noHorizontalOverflow(stu)

  // ticking steps: the optional step alone does not finish the lab
  await stu.getByLabel('Mark step 1 as done').check()
  await expect(stu.getByText('1 of 3 steps done')).toBeVisible()
  await stu.getByLabel('Mark step 2 as done').check()
  await expect(stu.getByText('2 of 3 steps done')).toBeVisible()
  await expect(stu.getByTestId('lab-completed')).toHaveCount(0)
  await stu.getByLabel('Mark step 3 as done').check()
  await expect(stu.getByTestId('lab-completed')).toBeVisible()
  await expect(stu.getByRole('progressbar', { name: 'Lab progress' })).toHaveAttribute('aria-valuenow', '100')
  // unticking a required step reopens the lab
  await stu.getByLabel('Mark step 3 as done').uncheck()
  await expect(stu.getByTestId('lab-completed')).toHaveCount(0)
  await stu.getByLabel('Mark step 3 as done').check()
  await expect(stu.getByTestId('lab-completed')).toBeVisible()
  await stu.reload()
  await expect(stu.getByLabel('Mark step 1 as done')).toBeChecked()
  await expect(stu.getByLabel('Mark step 3 as done')).toBeChecked()
  await expect(stu.getByTestId('lab-completed')).toBeVisible()

  // ── dashboard shows the lab as completed
  await stu.goto('/dashboard')
  const row = stu.getByTestId('lab-enrollment-row')
  await expect(row).toContainText(title)
  await expect(row).toContainText('3/3 steps · 100%')
  await expect(row).toContainText('Completed')
  await expect(stu.getByRole('progressbar', { name: `Progress in ${title}` })).toHaveAttribute('aria-valuenow', '100')

  // ── leaving and rejoining keeps the ticks
  await row.getByRole('link', { name: `Open lab ${title}` }).click()
  await stu.getByRole('button', { name: 'Leave this lab' }).click()
  await stu.getByRole('button', { name: 'Confirm leave' }).click()
  await expect(stu).toHaveURL(/\/dashboard$/)
  await expect(stu.getByText('You haven’t started a lab yet.')).toBeVisible()
  await stu.goto(`/labs/${slug}/work`)
  await expect(stu.getByText('You haven’t joined this lab yet')).toBeVisible()
  await stu.getByRole('button', { name: 'Start this lab' }).click()
  await expect(stu.getByText('3 of 3 steps done')).toBeVisible()
  await ctx.close()

  // ── admin: ticked steps are protected, and the progress export is a real workbook
  await page.goto(`/admin/labs/${labId}`)
  await page.getByRole('button', { name: 'Delete step 1' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Students have ticked this step' })).toBeVisible()
  await expect(page.getByTestId('step-card')).toHaveCount(3)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export student progress (Excel)' }).click()])
  expect(download.suggestedFilename()).toContain(`cloudart-lab-progress-${slug}-`)
  const bytes = fs.readFileSync(await download.path())
  expect(bytes.subarray(0, 2).toString()).toBe('PK')
  expect(bytes.length).toBeGreaterThan(1000)

  expect(adminErrors(), 'admin console errors').toEqual([])
  expect(studentErrors(), 'student console errors').toEqual([])
})

test('lab administration is closed to students and visitors', async ({ page, request }, info) => {
  const tag = `${info.project.name}${Date.now()}`
  const email = `success+cloudartlbv${tag}@simulator.amazonses.com`
  created.push(email)
  await makeVerifiedUser(request, { email, username: `lbv_${tag}`, fullName: 'Lab Viewer', organization: ORG })
  const token = await apiLogin(request, email)
  await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${token}` } })

  for (const path of ['/admin/labs', '/admin/labs/11111111-1111-4111-8111-111111111111']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
  }
  expect((await request.get(`${API}/admin/labs`)).status()).toBe(401)
  const asStudent = await request.post(`${API}/admin/labs`, { headers: { Authorization: `Bearer ${token}` }, data: { title: 'Sneaky lab here' } })
  expect(asStudent.status()).toBe(403)
  expect(sql(`select count(*) from labs where title='Sneaky lab here'`)).toBe('0')

  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/admin/labs')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Manage labs' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Labs', exact: true })).toBeVisible()
})
