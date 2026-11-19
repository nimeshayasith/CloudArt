import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Services University'
const created = []
const emails = []
const UPLOADS = path.resolve(new URL('../../backend/uploads', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

test.afterAll(() => {
  const list = emails.map((e) => `'${e}'`).join(',') || "''"
  try {
    // remove the files these tests uploaded, then every row they created
    const keys = sql(`select s3_object_key from service_request_attachments where service_request_id in (select id from service_requests where user_id in (select id from users where email in (${list})))`)
    for (const key of keys.split('\n').filter(Boolean)) fs.rmSync(path.join(UPLOADS, key), { force: true })
    sql(`delete from project_milestones where service_project_id in (select id from service_projects where service_request_id in (select id from service_requests where user_id in (select id from users where email in (${list}))));
         delete from service_projects where service_request_id in (select id from service_requests where user_id in (select id from users where email in (${list})));
         delete from service_requests where user_id in (select id from users where email in (${list}));
         delete from service_categories where name like 'E2E Service %'`)
  } catch { /* ignore */ }
  cleanup(created, [ORG])
})

const trackConsole = (page) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  // 400/403/404/409 console lines come from deliberate negative checks (bad file, wrong person, wrong state).
  return () => errors.filter((e) => !/\b(400|401|403|404|409|413|415)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('E2E requirements document')])

test('a client asks for a service, gets a proposal, accepts it and follows the project to the end', async ({ page, request, browser }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartsra${tag}@simulator.amazonses.com`
  const clientEmail = `success+cloudartsrc${tag}@simulator.amazonses.com`
  const category = `E2E Service ${tag}`
  const title = `E2E Deploy our API ${tag}`
  created.push(adminEmail, clientEmail)
  emails.push(adminEmail, clientEmail)
  const adminErrors = trackConsole(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `sra_${tag}`, fullName: 'Service Admin', organization: ORG })
  await makeVerifiedUser(request, { email: clientEmail, username: `src_${tag}`, fullName: 'Service Client', organization: ORG })
  for (const e of [adminEmail, clientEmail]) {
    const token = await apiLogin(request, e)
    await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
  }
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')

  // ── admin: add a service clients can ask for
  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/services')
  await expect(page.getByRole('heading', { name: 'Service requests' }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Services' }).click()
  await page.getByLabel('New service').fill(category)
  await page.getByRole('button', { name: 'Add service' }).click()
  await expect(page.getByTestId('category-row').filter({ hasText: category })).toContainText('0 requests')

  // ── client: nothing yet, then the form checks its input
  const ctx = await browser.newContext()
  const cli = await ctx.newPage()
  const clientErrors = trackConsole(cli)
  await uiLogin(cli, clientEmail)
  await expect(cli).toHaveURL(/\/dashboard$/)
  await expect(cli.getByTestId('services-card')).toContainText('Need help deploying')
  await cli.getByRole('link', { name: 'Services', exact: true }).click()
  await expect(cli.getByTestId('no-requests')).toBeVisible()
  await cli.getByRole('link', { name: 'New request' }).click()
  await cli.getByRole('button', { name: 'Send request' }).click()
  await expect(cli.getByRole('alert').filter({ hasText: /^Choose a service$/ })).toBeVisible()
  await expect(cli.getByText('Give your request a short title (at least 5 characters)')).toBeVisible()
  await expect(cli.getByText('Describe what you need (at least 20 characters)')).toBeVisible()
  await noHorizontalOverflow(cli)

  await cli.getByLabel('Which service do you need?').selectOption({ label: category })
  await cli.getByLabel('Short title').fill(title)
  await cli.getByLabel('What do you need?').fill('<b>Deploy</b> a Node API and a PostgreSQL database to AWS with a CI/CD pipeline.')
  await cli.getByLabel('Cloud provider (optional)').selectOption('AWS')
  await cli.getByLabel('Budget (optional)').fill('USD 1000-2000')
  await cli.getByRole('button', { name: 'Send request' }).click()
  await expect(cli).toHaveURL(/\/services\/[0-9a-f-]{36}$/)
  const requestUrl = cli.url()
  await expect(cli.getByTestId('request-status')).toHaveText('Submitted')
  await expect(cli.getByTestId('request-description')).toContainText('<b>Deploy</b> a Node API') // markup is shown as text, not run
  await expect(cli.getByText('USD 1000-2000')).toBeVisible()

  // ── client: attach files (a bad file is stopped), reword the request, write a message
  await cli.getByLabel('Attach a file').setInputFiles({ name: 'run.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') })
  await expect(cli.getByRole('alert').filter({ hasText: 'Attach a PDF, image' })).toBeVisible()
  await cli.getByLabel('Attach a file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not really a pdf, it is text <script>') })
  await expect(cli.getByRole('alert').filter({ hasText: 'Attach a PDF, image' })).toBeVisible()
  await cli.getByLabel('Attach a file').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(cli.getByTestId('attachment-row')).toHaveCount(1)
  await expect(cli.getByTestId('attachment-row')).toContainText('brief.pdf')
  const [mine] = await Promise.all([cli.waitForEvent('download'), cli.getByRole('button', { name: 'Download brief.pdf' }).click()])
  expect(mine.suggestedFilename()).toBe('brief.pdf')
  expect(fs.readFileSync(await mine.path()).equals(PDF)).toBe(true)

  await cli.getByRole('button', { name: 'Edit', exact: true }).click()
  await cli.getByLabel('Budget (optional)').fill('USD 1500-2500')
  await cli.getByRole('button', { name: 'Save changes' }).click()
  await expect(cli.getByText('USD 1500-2500')).toBeVisible()

  await cli.getByLabel('Your message').fill('Is a staging environment included?')
  await cli.getByRole('button', { name: 'Send message' }).click()
  await expect(cli.getByTestId('message').filter({ hasText: 'Is a staging environment included?' })).toContainText('Service Client')
  await noHorizontalOverflow(cli)

  // ── admin: the queue shows it, with a new message
  await page.goto('/admin')
  await expect(page.getByRole('link', { name: /Service requests — review requests/ })).toContainText('New service requests')
  await page.goto('/admin/services')
  const row = page.getByTestId('queue-row').filter({ hasText: title })
  await expect(row).toContainText('Service Client')
  await expect(row).toContainText('1 file')
  await expect(row.getByTestId('queue-unread')).toBeVisible()
  await page.getByLabel('Filter by status').selectOption('SUBMITTED')
  await expect(page.getByTestId('queue-row').filter({ hasText: title })).toBeVisible()
  await page.getByLabel('Search requests').fill('nothing-will-match-this')
  await expect(page.getByText('No requests match.')).toBeVisible()
  await page.getByLabel('Search requests').fill(title)
  await page.getByTestId('queue-row').filter({ hasText: title }).getByRole('link', { name: title }).click()
  await expect(page.getByTestId('request-status')).toHaveText('Submitted')
  await expect(page.getByText('Service Client').first()).toBeVisible()
  const [theirs] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download brief.pdf' }).click()])
  expect(theirs.suggestedFilename()).toBe('brief.pdf')
  await expect(page.getByTestId('message').filter({ hasText: 'staging environment' })).toBeVisible()

  // review, reply and write a proposal (it checks its input)
  await page.getByRole('button', { name: 'Start review' }).click()
  await expect(page.getByTestId('request-status')).toHaveText('Under review')
  await page.getByLabel('Your message').fill('Yes — one staging and one production environment.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByTestId('message').filter({ hasText: 'one staging and one production' })).toContainText('Service Admin')
  await page.getByRole('button', { name: 'Write a proposal' }).click()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Describe the offer (at least 10 characters)')).toBeVisible()
  await page.getByLabel('What you will do').fill('We will build the pipeline, the staging and production environments and the database.')
  await page.getByRole('button', { name: 'Save draft' }).click()
  const draft = page.getByTestId('proposal').first()
  await expect(draft).toContainText('Draft')
  await expect(draft).toContainText('Price to be agreed')
  await draft.getByRole('button', { name: 'Send to client' }).click() // incomplete: needs a price
  await expect(page.getByRole('alert').filter({ hasText: 'Enter the estimated cost' })).toBeVisible()
  await draft.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Estimated cost').fill('1800')
  await page.getByLabel('Currency', { exact: true }).fill('usd')
  await page.getByLabel('Estimated days').fill('14')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByTestId('proposal').first()).toContainText('14 days')
  await page.getByTestId('proposal').first().getByRole('button', { name: 'Send to client' }).click()
  await expect(page.getByTestId('request-status')).toHaveText('Proposal sent')
  await expect(page.getByTestId('proposal-status').first()).toHaveText('Waiting for answer')
  await noHorizontalOverflow(page)

  // ── client: sees the reply and the proposal, declines it with a note
  await cli.goto('/services')
  const clientRow = cli.getByTestId('request-row').filter({ hasText: title })
  await expect(clientRow.getByTestId('proposal-waiting')).toBeVisible()
  await expect(clientRow.getByTestId('unread')).toBeVisible()
  await cli.goto('/dashboard')
  await expect(cli.getByTestId('services-card')).toContainText('1 proposal waiting')
  await cli.goto(requestUrl)
  await expect(cli.getByTestId('request-status')).toHaveText('Proposal sent')
  await expect(cli.getByTestId('message').filter({ hasText: 'one staging and one production' })).toContainText('CloudArt team') // staff are not named to clients
  await expect(cli.getByTestId('proposal')).toContainText(/1[,.\s]?800[.,]00/)
  await expect(cli.getByTestId('proposal')).toContainText('about 14 days')
  await cli.getByRole('button', { name: 'Decline', exact: true }).click()
  await cli.getByLabel('Tell us why (optional)').fill('Over our budget.')
  await cli.getByRole('button', { name: 'Confirm decline' }).click()
  await expect(cli.getByTestId('request-status')).toHaveText('Under review')
  await expect(cli.getByTestId('proposal-status').first()).toHaveText('Declined')
  await cli.goto('/services')
  await expect(cli.getByTestId('request-row').filter({ hasText: title }).getByTestId('unread')).toHaveCount(0) // opening the page marked the reply as read

  // ── admin: sees the note, sends a cheaper proposal
  await page.reload()
  await expect(page.getByTestId('request-status')).toHaveText('Under review')
  await expect(page.getByText('Client’s note: Over our budget.')).toBeVisible()
  await page.getByRole('button', { name: 'Write a proposal' }).click()
  await page.getByLabel('What you will do').fill('Same scope with a smaller staging environment.')
  await page.getByLabel('Estimated cost').fill('1400.50')
  await page.getByLabel('Currency', { exact: true }).fill('USD')
  await page.getByLabel('Estimated days').fill('10')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.getByTestId('proposal').first().getByRole('button', { name: 'Send to client' }).click()
  await expect(page.getByTestId('request-status')).toHaveText('Proposal sent')

  // ── client: accepts
  await cli.goto(requestUrl)
  await expect(cli.getByTestId('proposal').first()).toContainText(/1[,.\s]?400[.,]50/)
  await cli.getByRole('button', { name: 'Accept proposal' }).click()
  await cli.getByRole('button', { name: 'Yes, accept it' }).click()
  await expect(cli.getByTestId('request-status')).toHaveText('Accepted')
  await expect(cli.getByTestId('project')).toContainText(title)
  await expect(cli.getByTestId('project-status')).toHaveText('Planned')
  await expect(cli.getByText('The team will add milestones here')).toBeVisible()
  await expect(cli.getByRole('button', { name: 'Accept proposal' })).toHaveCount(0)
  await expect(cli.getByRole('button', { name: 'Cancel this request' })).toHaveCount(0) // it is a project now

  // ── admin: runs the project
  await page.reload()
  await expect(page.getByTestId('admin-project')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark completed' })).toHaveCount(0) // not before work starts
  await page.getByLabel('New milestone').fill('Staging environment ready')
  await page.getByLabel('Due (optional)').fill('2099-01-15')
  await page.getByRole('button', { name: 'Add milestone' }).click()
  await expect(page.getByTestId('milestone-row')).toHaveCount(1)
  await page.getByLabel('New milestone').fill('Production go-live')
  await page.getByRole('button', { name: 'Add milestone' }).click()
  await expect(page.getByTestId('milestone-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'Start / resume work' }).click()
  await expect(page.getByTestId('project-status')).toHaveText('In progress')
  await page.getByTestId('milestone-row').first().getByLabel('Milestone status').selectOption('DONE')
  await expect(page.getByText('1/2 milestones · 50%')).toBeVisible()
  await page.getByRole('button', { name: 'Mark completed' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Mark every milestone as done' })).toBeVisible()
  await noHorizontalOverflow(page)

  // ── client sees the progress as it happens
  await cli.reload()
  await expect(cli.getByTestId('project-status')).toHaveText('In progress')
  await expect(cli.getByText('1/2 milestones · 50%')).toBeVisible()
  await expect(cli.getByTestId('milestone').first()).toContainText('Done')
  await expect(cli.getByTestId('milestone').first()).toContainText('Due')
  await cli.getByLabel('Your message').fill('Thanks, looking good so far!')
  await cli.getByRole('button', { name: 'Send message' }).click()
  await expect(cli.getByTestId('message').filter({ hasText: 'looking good so far' })).toBeVisible()
  await noHorizontalOverflow(cli)

  // ── admin finishes the project
  await page.reload()
  await page.getByTestId('milestone-row').nth(1).getByLabel('Milestone status').selectOption('DONE')
  await expect(page.getByText('2/2 milestones · 100%')).toBeVisible()
  await page.getByRole('button', { name: 'Mark completed' }).click()
  await expect(page.getByTestId('project-status')).toHaveText('Completed')
  await expect(page.getByText('so it can no longer be changed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add milestone' })).toHaveCount(0)

  await cli.reload()
  await expect(cli.getByTestId('project-status')).toHaveText('Completed')
  await expect(cli.getByText('2/2 milestones · 100%')).toBeVisible()

  // ── the Excel export has the request and its project
  await page.goto('/admin/services')
  const [sheet] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export (Excel)' }).click()])
  expect(sheet.suggestedFilename()).toMatch(/^cloudart-service-requests-\d{4}-\d{2}-\d{2}\.xlsx$/)
  expect(fs.statSync(await sheet.path()).size).toBeGreaterThan(1000)
  expect(sql(`select count(*) from service_requests r join users u on u.id = r.user_id where u.email='${clientEmail}' and r.status='ACCEPTED'`)).toBe('1')

  // ── a second request is declined: the client reads why and the conversation closes
  await cli.goto('/services/new')
  await cli.getByLabel('Which service do you need?').selectOption({ label: category })
  await cli.getByLabel('Short title').fill(`E2E Second request ${tag}`)
  await cli.getByLabel('What do you need?').fill('Please migrate our on-premise servers to the cloud for us.')
  await cli.getByRole('button', { name: 'Send request' }).click()
  await expect(cli.getByTestId('request-status')).toHaveText('Submitted')
  const secondUrl = cli.url()
  await page.goto('/admin/services')
  await page.getByTestId('queue-row').filter({ hasText: `E2E Second request ${tag}` }).getByRole('link').first().click()
  await page.getByRole('button', { name: 'Decline request' }).click()
  await expect(page.getByRole('button', { name: 'Confirm decline' })).toBeDisabled() // a reason is required
  await page.getByLabel('Why are you declining? The client will see this.').fill('We do not offer migrations of this size yet.')
  await page.getByRole('button', { name: 'Confirm decline' }).click()
  await expect(page.getByTestId('request-status')).toHaveText('Declined')
  await expect(page.getByTestId('conversation-closed')).toBeVisible()
  await cli.goto(secondUrl)
  await expect(cli.getByTestId('request-status')).toHaveText('Declined')
  await expect(cli.getByTestId('closed-reason')).toContainText('We do not offer migrations of this size yet.')
  await expect(cli.getByTestId('conversation-closed')).toBeVisible()
  await expect(cli.getByLabel('Your message')).toHaveCount(0)
  await expect(cli.getByLabel('Attach a file')).toHaveCount(0)

  // ── the client cancels a third one, and the service is protected once used
  await cli.goto('/services/new')
  await cli.getByLabel('Which service do you need?').selectOption({ label: category })
  await cli.getByLabel('Short title').fill(`E2E Third request ${tag}`)
  await cli.getByLabel('What do you need?').fill('A review of our monitoring and alerting setup, please.')
  await cli.getByRole('button', { name: 'Send request' }).click()
  await cli.getByRole('button', { name: 'Cancel this request' }).click()
  await cli.getByRole('button', { name: 'Yes, cancel it' }).click()
  await expect(cli.getByTestId('request-status')).toHaveText('Cancelled')
  await page.goto('/admin/services')
  await page.getByRole('tab', { name: 'Services' }).click()
  const used = page.getByTestId('category-row').filter({ hasText: category })
  await expect(used).toContainText('3 requests')
  await used.getByRole('button', { name: `Delete ${category}` }).click()
  await used.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(used.getByRole('alert')).toContainText('Clients have requested this service')

  await cli.goto('/services')
  await expect(cli.getByTestId('request-row')).toHaveCount(3)
  await ctx.close()

  expect(adminErrors(), 'admin console errors').toEqual([])
  expect(clientErrors(), 'client console errors').toEqual([])
})

test('service requests are private: closed to visitors, to other clients, and the admin screens to clients', async ({ page, request, browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`
  const ownerEmail = `success+cloudartsro${tag}@simulator.amazonses.com`
  const otherEmail = `success+cloudartsrx${tag}@simulator.amazonses.com`
  created.push(ownerEmail, otherEmail)
  emails.push(ownerEmail, otherEmail)
  await makeVerifiedUser(request, { email: ownerEmail, username: `sro_${tag}`, fullName: 'Request Owner', organization: ORG })
  await makeVerifiedUser(request, { email: otherEmail, username: `srx_${tag}`, fullName: 'Other Client', organization: ORG })
  const owner = await apiLogin(request, ownerEmail)
  const other = await apiLogin(request, otherEmail)
  for (const t of [owner, other]) await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${t}` } })

  // a category and a request owned by the first client
  sql(`insert into service_categories (name, slug, sort_order) values ('E2E Service ${tag}', 'e2e-service-${tag.toLowerCase()}', 99)`)
  const categoryId = sql(`select id from service_categories where name='E2E Service ${tag}'`)
  const res = await request.post(`${API}/service-requests`, {
    headers: { Authorization: `Bearer ${owner}` },
    data: { categoryId, title: `E2E Private request ${tag}`, description: 'This request belongs to its owner only, please.' },
  })
  expect(res.status(), await res.text()).toBe(201)
  const { request: made } = await res.json()

  // visitors are sent to sign in, but the list of services is public
  for (const url of ['/services', '/services/new', `/services/${made.id}`, '/admin/services', `/admin/services/${made.id}`]) {
    await page.goto(url)
    await expect(page).toHaveURL(/\/login/)
  }
  expect((await request.get(`${API}/service-categories`)).status()).toBe(200)
  for (const [method, url] of [['get', '/service-requests'], ['post', '/service-requests'], ['get', `/service-requests/${made.id}`], ['get', `/service-attachments/${made.id}/file`]]) {
    expect((await request[method](`${API}${url}`, { data: {} })).status(), url).toBe(401)
  }

  // another client cannot read, write to, or answer it
  const h = { Authorization: `Bearer ${other}` }
  expect((await request.get(`${API}/service-requests/${made.id}`, { headers: h })).status()).toBe(404)
  expect((await request.post(`${API}/service-requests/${made.id}/messages`, { headers: h, data: { body: 'Let me in' } })).status()).toBe(404)
  expect((await request.post(`${API}/service-requests/${made.id}/cancel`, { headers: h, data: {} })).status()).toBe(404)
  expect((await request.get(`${API}/service-requests`, { headers: h })).status()).toBe(200)
  expect((await (await request.get(`${API}/service-requests`, { headers: h })).json()).total).toBe(0)
  for (const [method, url] of [['get', '/admin/service-requests'], ['get', `/admin/service-requests/${made.id}`], ['post', `/admin/service-requests/${made.id}/review`], ['post', '/admin/service-categories'], ['get', '/admin/exports/service-requests.xlsx']]) {
    expect((await request[method](`${API}${url}`, { headers: h, data: {} })).status(), url).toBe(403)
  }

  // in the browser: the other client gets "not found", and has no admin links
  const ctx = await browser.newContext()
  const cli = await ctx.newPage()
  await uiLogin(cli, otherEmail)
  await expect(cli).toHaveURL(/\/dashboard$/)
  await expect(cli.getByRole('link', { name: 'Service requests', exact: true })).toHaveCount(0)
  await expect(cli.getByRole('link', { name: 'Services', exact: true })).toBeVisible()
  await cli.goto(`/services/${made.id}`)
  await expect(cli.getByText('We couldn’t find that request.')).toBeVisible()
  await expect(cli.getByText('E2E Private request')).toHaveCount(0)
  await cli.goto('/admin/services')
  await expect(cli).toHaveURL(/\/dashboard$/)
  await noHorizontalOverflow(cli)
  await ctx.close()

  // the owner sees it in their list
  await uiLogin(page, ownerEmail)
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/services')
  await expect(page.getByTestId('request-row').filter({ hasText: `E2E Private request ${tag}` })).toContainText('Submitted')
})
