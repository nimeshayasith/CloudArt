import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Subscription University'
const created = []
const emails = []
const UPLOADS = path.resolve(new URL('../../backend/uploads', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

test.afterAll(() => {
  const list = emails.map((e) => `'${e}'`).join(',') || "''"
  try {
    // remove the screenshots these tests uploaded, then every row they created
    const keys = sql(`select storage_key from payment_proofs where subscription_id in (select id from subscriptions where user_id in (select id from users where email in (${list})))`)
    for (const key of keys.split('\n').filter(Boolean)) fs.rmSync(path.join(UPLOADS, key), { force: true })
    sql(`delete from payment_proofs where subscription_id in (select id from subscriptions where user_id in (select id from users where email in (${list})));
         delete from subscriptions where user_id in (select id from users where email in (${list}));
         delete from vouchers where code like 'E2E%';
         delete from subscription_plans where name like 'E2E %';
         delete from platform_settings where key='payment.bank';
         delete from lab_enrollments where lab_id in (select id from labs where slug like 'e2e-lab-%');
         delete from labs where slug like 'e2e-lab-%'`)
  } catch { /* ignore */ }
  cleanup(created, [ORG])
})

// A stand-in for YouTube's IFrame API (the real one needs the internet).
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
  // 400/402/403/404/409 console lines come from deliberate negative checks (locked content, bad voucher, bad file).
  return () => errors.filter((e) => !/\b(400|401|403|404|409|413)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

// A real 1x1 PNG, so the admin's screenshot viewer actually renders it.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const SECRET = 'SECRETVID01'

test('admin sets up plans and vouchers; a student unlocks Premium by paying; a free voucher works; access can be revoked', async ({ page, request, browser }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartsba${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartsbs${tag}@simulator.amazonses.com`
  const guestEmail = `success+cloudartsbg${tag}@simulator.amazonses.com`
  const slug = `e2e-course-sb-${tag}`.toLowerCase()
  const labSlug = `e2e-lab-sb-${tag}`.toLowerCase()
  const planName = `E2E Monthly ${tag}`
  const halfCode = `E2EHALF${ts}`.toUpperCase()
  const freeCode = `E2EFREE${ts}`.toUpperCase()
  created.push(adminEmail, studentEmail, guestEmail)
  emails.push(adminEmail, studentEmail, guestEmail)
  const adminErrors = trackConsole(page)
  await installFakeYouTube(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `sba_${tag}`, fullName: 'Pay Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: `sbs_${tag}`, fullName: 'Pay Student', organization: ORG })
  await makeVerifiedUser(request, { email: guestEmail, username: `sbg_${tag}`, fullName: 'Free Voucher Student', organization: ORG })
  const tokens = {}
  for (const [k, e] of Object.entries({ admin: adminEmail, student: studentEmail, guest: guestEmail })) {
    tokens[k] = await apiLogin(request, e)
    await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${tokens[k]}` } })
  }
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')

  // a free course with one free and one (not yet premium) lesson, and a lab
  sql(`insert into courses (title, slug, category_id, created_by, status, description, difficulty, updated_at)
         select 'E2E Subscription Course ${tag}', '${slug}', (select id from course_categories order by sort_order limit 1), id, 'PUBLISHED', 'Premium testing', 'BEGINNER', now()
         from users where email='${adminEmail}';
       insert into course_modules (course_id, title, is_published, sort_order) select id, 'Basics', true, 0 from courses where slug='${slug}';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Free lesson', 'AAAAAAAAAAA', 60, true, 0, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Premium lesson', '${SECRET}', 60, true, 1, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}';
       insert into labs (title, slug, status, is_premium, created_by, updated_at) select 'E2E Premium Lab ${tag}', '${labSlug}', 'PUBLISHED', true, id, now() from users where email='${adminEmail}';
       insert into lab_steps (lab_id, title, instructions, sort_order) select id, 'The step', 'Do the thing', 0 from labs where slug='${labSlug}'`)
  const courseId = sql(`select id from courses where slug='${slug}'`)
  for (const k of ['student', 'guest']) expect((await request.post(`${API}/courses/${slug}/enroll`, { headers: { Authorization: `Bearer ${tokens[k]}` } })).status()).toBe(201)

  // ── admin: bank details
  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('link', { name: 'Payments to review' }).or(page.getByRole('link', { name: /Payments — review payments/ }))).toBeVisible()
  await page.goto('/admin/payments')
  await expect(page.getByRole('heading', { name: 'Payments and plans' })).toBeVisible()
  await page.getByRole('tab', { name: 'Bank details' }).click()
  await page.getByRole('button', { name: 'Save bank details' }).click()
  await expect(page.getByText('Enter the bank name')).toBeVisible()
  await page.getByLabel('Bank name').fill('E2E Test Bank')
  await page.getByLabel('Account holder name').fill('CloudArt E2E Ltd')
  await page.getByLabel('Account number').fill('9876543210')
  await page.getByLabel('Instructions for students (optional)').fill('Use your username as the payment reference.')
  await page.getByRole('button', { name: 'Save bank details' }).click()
  await expect(page.getByText('Bank details saved.')).toBeVisible()

  // ── admin: a plan (with validation)
  await page.getByRole('tab', { name: 'Plans' }).click()
  await page.getByRole('button', { name: '+ New plan' }).click()
  await page.getByRole('button', { name: 'Create plan' }).click()
  await expect(page.getByText('Name must be at least 2 characters')).toBeVisible()
  await expect(page.getByText('Use a 3-letter code such as USD or LKR')).toBeVisible()
  await page.getByLabel('Plan name').fill(planName)
  await page.getByLabel('Price', { exact: true }).fill('20')
  await page.getByLabel('Currency code').fill('usd')
  await page.getByLabel('Length (days)').fill('30')
  await page.getByLabel('Description').fill('All Premium content for a month.')
  await page.getByRole('button', { name: 'Create plan' }).click()
  const planRow = page.getByTestId('plan-row').filter({ hasText: planName })
  await expect(planRow).toContainText('20.00')
  await expect(planRow).toContainText('1 month')

  // ── admin: a 50 % voucher and a free single-use voucher for that plan
  await page.getByRole('tab', { name: 'Vouchers' }).click()
  await page.getByRole('button', { name: '+ New voucher' }).click()
  await page.getByLabel('Voucher code (optional)').fill(halfCode.toLowerCase())
  await page.getByRole('button', { name: 'Create voucher' }).click()
  await expect(page.getByText('Use a whole number from 1 to 100 (100 makes it free)')).toBeVisible()
  await page.getByLabel('Discount (%)').fill('50')
  await page.getByRole('button', { name: 'Create voucher' }).click()
  const halfRow = page.getByTestId('voucher-row').filter({ hasText: halfCode })
  await expect(halfRow).toContainText('50% off')
  await expect(halfRow).toContainText('Used 0')

  await page.getByRole('button', { name: '+ New voucher' }).click()
  await page.getByLabel('Voucher code (optional)').fill(freeCode)
  await page.getByLabel('Discount (%)').fill('100')
  await page.getByLabel('Total uses (optional)').fill('1')
  await page.getByLabel(planName).check()
  await page.getByRole('button', { name: 'Create voucher' }).click()
  const freeRow = page.getByTestId('voucher-row').filter({ hasText: freeCode })
  await expect(freeRow).toContainText('Free')
  await expect(freeRow).toContainText('Used 0 of 1')
  await expect(freeRow).toContainText(planName)
  await noHorizontalOverflow(page)

  // ── admin: mark a lesson Premium in the course editor
  await page.goto(`/admin/courses/${courseId}`)
  await page.getByRole('button', { name: 'Edit lesson Premium lesson' }).click()
  await page.getByLabel('Premium lesson (needs a subscription)').check()
  await page.getByRole('button', { name: 'Save lesson' }).click()
  await expect(page.getByTestId('lesson-row').filter({ hasText: 'Premium lesson' })).toContainText('Premium')

  // ── student: free content works, premium content is locked
  const ctx = await browser.newContext()
  const stu = await ctx.newPage()
  const studentErrors = trackConsole(stu)
  await installFakeYouTube(stu)
  await uiLogin(stu, studentEmail)
  await expect(stu).toHaveURL(/\/dashboard$/)
  await expect(stu.getByTestId('subscription-card')).toContainText('free plan')
  await stu.goto(`/learn/${slug}`)
  await expect(stu.getByTestId('fake-player')).toHaveAttribute('data-video-id', 'AAAAAAAAAAA')
  await stu.getByRole('link', { name: /Premium lesson.*Premium, locked/ }).click()
  await expect(stu.getByTestId('upgrade-panel')).toContainText('This lesson is Premium')
  await expect(stu.getByTestId('fake-player')).toHaveCount(0)
  expect(await stu.content()).not.toContain(SECRET)
  await stu.goto(`/labs/${labSlug}`)
  await stu.getByRole('button', { name: 'Start this lab' }).click()
  await expect(stu.getByTestId('upgrade-panel')).toContainText('This lab is Premium')

  // ── student: pick the plan, try a bad code, then the 50 % code
  await stu.goto('/pricing')
  await expect(stu.getByTestId('plan-card').filter({ hasText: planName })).toContainText('20.00')
  await stu.getByRole('button', { name: `Choose ${planName}` }).click()
  await expect(stu.getByTestId('total')).toContainText('20.00')
  await stu.getByLabel('Voucher code (optional)').fill('NOSUCHCODE')
  await stu.getByRole('button', { name: 'Apply' }).click()
  await expect(stu.getByRole('alert').filter({ hasText: 'can’t be used for this plan' })).toBeVisible()
  await expect(stu.getByTestId('total')).toContainText('20.00')
  await stu.getByLabel('Voucher code (optional)').fill(halfCode.toLowerCase())
  await stu.getByRole('button', { name: 'Apply' }).click()
  await expect(stu.getByText(`Voucher ${halfCode} (50% off)`)).toBeVisible()
  await expect(stu.getByTestId('total')).toContainText('10.00')
  await noHorizontalOverflow(stu)
  await stu.getByRole('button', { name: 'Continue to payment' }).click()

  // ── student: pay by bank transfer and upload a screenshot
  await expect(stu).toHaveURL(/\/subscription$/)
  await expect(stu.getByTestId('amount-due')).toContainText('10.00')
  await expect(stu.getByTestId('bank-details')).toContainText('E2E Test Bank')
  await expect(stu.getByTestId('bank-details')).toContainText('9876543210')
  await expect(stu.getByText('Use your username as the payment reference.')).toBeVisible()
  await expect(stu.getByTestId('access-free')).toBeVisible()
  // a wrong kind of file is stopped in the browser, a fake image on the server
  await stu.getByLabel('Screenshot of your payment').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(stu.getByRole('alert').filter({ hasText: 'Choose a JPEG, PNG or WebP screenshot.' })).toBeVisible()
  await stu.getByLabel('Screenshot of your payment').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>not an image at all</html>') })
  await stu.getByRole('button', { name: 'Send screenshot' }).click()
  await expect(stu.getByRole('alert').filter({ hasText: 'Upload a JPEG, PNG or WebP screenshot.' })).toBeVisible()
  await stu.getByLabel('Screenshot of your payment').setInputFiles({ name: 'payment.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await stu.getByLabel('Payment reference (optional)').fill('TXN-E2E-1')
  await stu.getByRole('button', { name: 'Send screenshot' }).click()
  await expect(stu.getByText('We’re checking your payment')).toBeVisible()
  await expect(stu.getByTestId('proof-row')).toContainText('Waiting for review')
  await expect(stu.getByTestId('proof-row')).toContainText('TXN-E2E-1')

  // ── admin: the payment is waiting; view the screenshot and reject it with a reason
  await page.goto('/admin/payments')
  const card = page.getByTestId('review-card').filter({ hasText: 'Pay Student' })
  await expect(card).toContainText('Awaiting review')
  await expect(card).toContainText('10.00')
  await expect(card).toContainText(`50% off`)
  await card.getByRole('button', { name: 'View screenshot' }).click()
  const image = card.getByTestId('proof-image')
  await expect(image).toBeVisible()
  expect(await image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true) // it really rendered
  await card.getByRole('button', { name: `Reject payment from sbs_${tag}` }).click()
  await expect(card.getByRole('button', { name: 'Confirm reject' })).toBeDisabled() // a reason is required
  await card.getByLabel('Why is it being rejected? The student will see this.').fill('The amount does not match the plan price.')
  await card.getByRole('button', { name: 'Confirm reject' }).click()
  await expect(card).not.toContainText('Awaiting review')

  // ── student: sees why, and sends a new screenshot
  await stu.reload()
  await expect(stu.getByTestId('rejection-reason')).toContainText('The amount does not match the plan price.')
  await stu.getByLabel('Screenshot of your payment').setInputFiles({ name: 'payment2.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await stu.getByRole('button', { name: 'Send screenshot' }).click()
  await expect(stu.getByText('We’re checking your payment')).toBeVisible()
  await expect(stu.getByTestId('proof-row')).toHaveCount(2)

  // ── admin approves
  await page.reload()
  const again = page.getByTestId('review-card').filter({ hasText: 'Pay Student' })
  await expect(again).toContainText('Awaiting review')
  await again.getByRole('button', { name: `Approve payment from sbs_${tag}` }).click()
  await page.getByLabel('Filter by status').selectOption('ACTIVE')
  const active = page.getByTestId('review-card').filter({ hasText: 'Pay Student' })
  await expect(active).toContainText('Active')
  await expect(active).toContainText(halfCode)

  // ── student: Premium is unlocked everywhere
  await stu.reload()
  await expect(stu.getByTestId('access-active')).toContainText('Premium is active')
  await expect(stu.getByTestId('history')).toContainText(planName)
  await stu.goto(`/learn/${slug}`)
  await stu.getByRole('link', { name: /Premium lesson/ }).click()
  await expect(stu.getByTestId('fake-player')).toHaveAttribute('data-video-id', SECRET)
  await expect(stu.getByTestId('upgrade-panel')).toHaveCount(0)
  await stu.goto(`/labs/${labSlug}`)
  await stu.getByRole('button', { name: 'Start this lab' }).click()
  await expect(stu).toHaveURL(new RegExp(`/labs/${labSlug}/work$`))
  await expect(stu.getByText('Do the thing')).toBeVisible()
  await stu.goto('/dashboard')
  await expect(stu.getByTestId('subscription-card')).toContainText('Premium active')

  // ── a second student redeems the free voucher: active at once, no screenshot, no payment
  const guestCtx = await browser.newContext()
  const guest = await guestCtx.newPage()
  await installFakeYouTube(guest)
  await uiLogin(guest, guestEmail)
  await expect(guest).toHaveURL(/\/dashboard$/)
  await guest.goto('/pricing')
  await guest.getByRole('button', { name: `Choose ${planName}` }).click()
  await guest.getByLabel('Voucher code (optional)').fill(freeCode)
  await guest.getByRole('button', { name: 'Apply' }).click()
  await expect(guest.getByTestId('total')).toHaveText('Free')
  await guest.getByRole('button', { name: 'Activate now' }).click()
  await expect(guest.getByTestId('subscribed')).toContainText('is active until')
  expect(sql(`select status from subscriptions s join users u on u.id = s.user_id where u.email='${guestEmail}'`)).toBe('ACTIVE')
  expect(sql(`select count(*) from payment_proofs p join subscriptions s on s.id = p.subscription_id join users u on u.id = s.user_id where u.email='${guestEmail}'`)).toBe('0')
  await guest.goto(`/learn/${slug}`)
  await guest.getByRole('link', { name: /Premium lesson/ }).click()
  await expect(guest.getByTestId('fake-player')).toHaveAttribute('data-video-id', SECRET)

  // the single-use voucher is now spent for everyone
  await page.goto('/admin/payments')
  await page.getByRole('tab', { name: 'Vouchers' }).click()
  await expect(page.getByTestId('voucher-row').filter({ hasText: freeCode })).toContainText('Used 1 of 1')
  expect((await request.post(`${API}/subscriptions/quote`, { headers: { Authorization: `Bearer ${tokens.student}` }, data: { planId: sql(`select id from subscription_plans where name='${planName}'`), voucherCode: freeCode } })).status()).toBe(400)

  // ── admin revokes the free student's access; premium locks again
  await page.getByRole('tab', { name: 'Payments' }).click()
  await page.getByLabel('Filter by status').selectOption('ACTIVE')
  const guestCard = page.getByTestId('review-card').filter({ hasText: 'Free Voucher Student' })
  await expect(guestCard).toContainText('Free')
  await guestCard.getByRole('button', { name: `Revoke access for sbg_${tag}` }).click()
  await guestCard.getByRole('button', { name: 'Confirm revoke' }).click()
  await expect(page.getByTestId('review-card').filter({ hasText: 'Free Voucher Student' })).toHaveCount(0)
  await guest.goto(`/learn/${slug}`)
  await guest.getByRole('link', { name: /Premium lesson/ }).click()
  await expect(guest.getByTestId('upgrade-panel')).toBeVisible()
  await guestCtx.close()
  await ctx.close()

  expect(adminErrors(), 'admin console errors').toEqual([])
  expect(studentErrors(), 'student console errors').toEqual([])
})

test('plans are public, subscribing needs an account, and the money screens are closed to students', async ({ page, request }, info) => {
  const tag = `${info.project.name}${Date.now()}`
  const email = `success+cloudartsbv${tag}@simulator.amazonses.com`
  created.push(email)
  emails.push(email)
  await makeVerifiedUser(request, { email, username: `sbv_${tag}`, fullName: 'Pay Viewer', organization: ORG })
  const token = await apiLogin(request, email)
  await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${token}` } })

  // a visitor can see the pricing page but is sent to sign up to subscribe
  await page.goto('/pricing')
  await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible()
  await page.goto('/subscription')
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/admin/payments')
  await expect(page).toHaveURL(/\/login/)

  expect((await request.get(`${API}/plans`)).status()).toBe(200)
  expect((await request.get(`${API}/subscriptions/me`)).status()).toBe(401)
  expect((await request.get(`${API}/payment-info`)).status()).toBe(401)
  for (const [method, url] of [['get', '/admin/subscriptions'], ['post', '/admin/plans'], ['post', '/admin/vouchers'], ['put', '/admin/settings/payment']]) {
    const res = await request[method](`${API}${url}`, { headers: { Authorization: `Bearer ${token}` }, data: {} })
    expect(res.status(), url).toBe(403)
  }

  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Payments', exact: true })).toHaveCount(0)
  await page.goto('/admin/payments')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
})
