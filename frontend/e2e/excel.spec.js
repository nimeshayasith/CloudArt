import fs from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

// The backend already depends on exceljs, so the test reuses it to read the downloaded files.
const ExcelJS = createRequire(new URL('../../backend/package.json', import.meta.url))('exceljs')

const ORG = 'E2E Excel University'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const created = []
test.afterAll(() => cleanup(created, [ORG]))

const trackConsole = (page) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  // 400/403/404 console lines come from deliberate negative checks (a broken import file).
  return () => errors.filter((e) => !/\b(400|401|403|404|409)\b/.test(e))
}

async function readSheet(path) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fs.readFileSync(path))
  const ws = wb.worksheets[0]
  const header = ws.getRow(1).values.slice(1).map(String)
  const rows = []
  ws.eachRow((row, n) => {
    if (n > 1) rows.push(Object.fromEntries(header.map((h, i) => [h, String(row.getCell(i + 1).value ?? '')])))
  })
  return { header, rows }
}

/** Saves a click-triggered download and returns its name and path. */
async function downloadOf(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()])
  const path = await download.path()
  return { name: download.suggestedFilename(), path }
}

test('admin downloads Excel exports and imports questions from a spreadsheet', async ({ page, request }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartxla${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartxls${tag}@simulator.amazonses.com`
  const slug = `e2e-course-xl-${tag}`.toLowerCase()
  created.push(adminEmail, studentEmail)
  const consoleErrors = trackConsole(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `xla_${tag}`, fullName: 'Excel Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: `xls_${tag}`, fullName: 'Excel Student', organization: ORG })
  const adminToken = await apiLogin(request, adminEmail)
  const studentToken = await apiLogin(request, studentEmail)
  for (const t of [adminToken, studentToken]) await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${t}` } })
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')
  sql(`insert into courses (title, slug, category_id, created_by, status, description, difficulty, updated_at)
         select 'E2E Excel Course ${tag}', '${slug}', (select id from course_categories order by sort_order limit 1), id, 'PUBLISHED', 'Excel testing', 'BEGINNER', now()
         from users where email='${adminEmail}';
       insert into course_modules (course_id, title, is_published, sort_order) select id, 'Basics', true, 0 from courses where slug='${slug}';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Warm up', 'AAAAAAAAAAA', 60, true, 0, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}'`)
  expect((await request.post(`${API}/courses/${slug}/enroll`, { headers: { Authorization: `Bearer ${studentToken}` } })).status()).toBe(201)
  const courseId = sql(`select id from courses where slug='${slug}'`)
  const moduleId = sql(`select m.id from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}'`)
  const quiz = (await (await request.post(`${API}/admin/modules/${moduleId}/quiz`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { title: 'Excel quiz', totalQuestions: 3 } })).json()).quiz

  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/admin$/)

  // ── users export: a real workbook with the student in it
  const users = await downloadOf(page, () => page.getByRole('button', { name: 'Export users (Excel)' }).click())
  expect(users.name).toMatch(/^cloudart-users-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const usersSheet = await readSheet(users.path)
  expect(usersSheet.header).toEqual(['Full name', 'Username', 'Email', 'Organization', 'Role category', 'Account type', 'Status', 'Courses enrolled', 'Joined'])
  const student = usersSheet.rows.find((r) => r.Email === studentEmail)
  expect(student).toMatchObject({ 'Full name': 'Excel Student', Organization: ORG, 'Account type': 'Student', Status: 'Active', 'Courses enrolled': '1' })
  expect(usersSheet.rows.find((r) => r.Email === adminEmail)['Account type']).toBe('Admin')

  // ── course progress export
  await page.goto(`/admin/courses/${courseId}`)
  const progress = await downloadOf(page, () => page.getByRole('button', { name: 'Export student progress (Excel)' }).click())
  expect(progress.name).toContain(`cloudart-progress-${slug}-`)
  const progressSheet = await readSheet(progress.path)
  expect(progressSheet.rows).toHaveLength(1)
  expect(progressSheet.rows[0]).toMatchObject({ Email: studentEmail, Status: 'In progress', 'Lessons completed': '0', 'Total lessons': '1', 'Progress %': '0' })

  // ── question template, then import it
  await page.goto(`/admin/quizzes/${quiz.id}`)
  await expect(page.getByTestId('question-tools')).toBeVisible()
  const template = await downloadOf(page, () => page.getByRole('button', { name: 'Download template' }).click())
  expect(template.name).toBe('cloudart-question-template.xlsx')
  expect((await readSheet(template.path)).rows).toHaveLength(3)

  await page.getByLabel('Import questions from an Excel file').setInputFiles(template.path)
  await expect(page.getByText('Imported 3 questions.')).toBeVisible()
  await expect(page.getByTestId('question-row')).toHaveCount(3)
  await expect(page.getByTestId('question-row').nth(1)).toContainText('Multiple select')
  await expect(page.getByTestId('question-row').nth(1)).toContainText('2 marks')

  // ── export the bank and import it again (adds to the quiz)
  const bank = await downloadOf(page, () => page.getByRole('button', { name: 'Export questions (Excel)' }).click())
  expect(bank.name).toMatch(/^cloudart-questions-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const bankSheet = await readSheet(bank.path)
  expect(bankSheet.rows.map((r) => r.Question)).toEqual(['Which AWS service stores objects?', 'Which of these are compute services?', 'Amazon S3 is a block storage service.'])
  await page.getByLabel('Import questions from an Excel file').setInputFiles(bank.path)
  await expect(page.getByText('Imported 3 questions.')).toBeVisible()
  await expect(page.getByTestId('question-row')).toHaveCount(6)

  // ── a file that is not a spreadsheet
  await page.getByLabel('Import questions from an Excel file').setInputFiles({ name: 'notes.xlsx', mimeType: XLSX, buffer: Buffer.from('definitely not excel') })
  await expect(page.getByRole('alert').filter({ hasText: 'could not be read' })).toBeVisible()
  await expect(page.getByTestId('question-row')).toHaveCount(6)

  // ── a spreadsheet with bad rows: every problem is listed and nothing is imported
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Questions')
  ws.addRow(['Question', 'Type', 'Marks', 'Correct options', 'Explanation', 'Option 1', 'Option 2'])
  ws.addRow(['A perfectly good question', 'Single choice', 1, '1', '', 'Yes', 'No'])
  ws.addRow(['Question with a made up type', 'essay', 1, '1', '', 'Yes', 'No'])
  ws.addRow(['Question with no answer marked', 'Single choice', 1, '', '', 'Yes', 'No'])
  const bad = Buffer.from(await wb.xlsx.writeBuffer())
  await page.getByLabel('Import questions from an Excel file').setInputFiles({ name: 'bad-rows.xlsx', mimeType: XLSX, buffer: bad })
  const errors = page.getByTestId('import-errors')
  await expect(page.getByRole('alert').filter({ hasText: '2 rows need fixing. Nothing was imported.' })).toBeVisible()
  await expect(errors).toContainText('Row 3: Type "essay" is not recognised')
  await expect(errors).toContainText('Row 4: Say which options are correct')
  await expect(page.getByTestId('question-row')).toHaveCount(6) // the good row was not imported either
  expect(sql(`select count(*) from questions where quiz_id='${quiz.id}'`)).toBe('6')

  // ── results export (no attempts yet: just the header)
  const results = await downloadOf(page, () => page.getByRole('button', { name: 'Export results (Excel)' }).click())
  expect(results.name).toMatch(/^cloudart-results-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const resultSheet = await readSheet(results.path)
  expect(resultSheet.header).toContain('Percentage')
  expect(resultSheet.rows).toHaveLength(0)

  expect(consoleErrors(), 'console errors').toEqual([])
})

test('Excel exports are closed to students and visitors', async ({ page, request }, info) => {
  const tag = `${info.project.name}${Date.now()}`
  const email = `success+cloudartxlv${tag}@simulator.amazonses.com`
  created.push(email)
  await makeVerifiedUser(request, { email, username: `xlv_${tag}`, fullName: 'Excel Viewer', organization: ORG })
  const token = await apiLogin(request, email)
  await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${token}` } })

  expect((await request.get(`${API}/admin/exports/users.xlsx`)).status()).toBe(401)
  const asStudent = await request.get(`${API}/admin/exports/users.xlsx`, { headers: { Authorization: `Bearer ${token}` } })
  expect(asStudent.status()).toBe(403)
  expect((await asStudent.json()).error.code).toBe('FORBIDDEN')
  expect((await request.get(`${API}/admin/question-template.xlsx`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403)

  // the UI never offers them to students
  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('button', { name: /Export/ })).toHaveCount(0)
})
