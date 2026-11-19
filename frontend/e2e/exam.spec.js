import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Exam University'
const created = []
test.afterAll(() => cleanup(created, [ORG]))

const trackConsole = (page) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  // 400/403/404/409 console lines come from deliberate negative checks.
  return () => errors.filter((e) => !/\b(400|401|403|404|409)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

function seedCourse({ slug, ownerEmail, tag }) {
  sql(`insert into courses (title, slug, category_id, created_by, status, description, difficulty, updated_at)
         select 'E2E Exam Course ${tag}', '${slug}', (select id from course_categories order by sort_order limit 1), id, 'PUBLISHED', 'Exam testing', 'BEGINNER', now()
         from users where email='${ownerEmail}';
       insert into course_modules (course_id, title, is_published, sort_order) select id, 'Basics', true, 0 from courses where slug='${slug}';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Warm up', 'AAAAAAAAAAA', 60, true, 0, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}'`)
}
const courseId = (slug) => sql(`select id from courses where slug='${slug}'`)

/** Pretend the student has watched the lesson (the watching flow itself is covered by the learning spec). */
const completeLessons = (email, slug) =>
  sql(`insert into lesson_progress (enrollment_id, lesson_id, last_position_seconds, max_position_seconds, completed, completed_at)
       select e.id, l.id, 60, 60, true, now()
       from enrollments e
       join users u on u.id = e.user_id
       join courses c on c.id = e.course_id
       join course_modules m on m.course_id = c.id
       join lessons l on l.module_id = m.id
       where u.email='${email}' and c.slug='${slug}'`)

test('admin sets up the final exam; a student unlocks it, fails once, passes, and completes the course', async ({ page, request, browser }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartexa${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartexs${tag}@simulator.amazonses.com`
  const slug = `e2e-course-ex-${tag}`.toLowerCase()
  const title = `E2E Exam Course ${tag}`
  created.push(adminEmail, studentEmail)
  const adminErrors = trackConsole(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `exa_${tag}`, fullName: 'Exam Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: `exs_${tag}`, fullName: 'Exam Student', organization: ORG })
  const adminToken = await apiLogin(request, adminEmail)
  const studentToken = await apiLogin(request, studentEmail)
  for (const t of [adminToken, studentToken]) await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${t}` } })
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')
  seedCourse({ slug, ownerEmail: adminEmail, tag })
  expect((await request.post(`${API}/courses/${slug}/enroll`, { headers: { Authorization: `Bearer ${studentToken}` } })).status()).toBe(201)

  // ── admin: create the exam from the course editor
  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/admin$/) // promoted before logging in, so admins land on the admin dashboard
  await page.goto(`/admin/courses/${courseId(slug)}`)
  await expect(page.getByRole('heading', { name: 'Final exam' })).toBeVisible()
  await expect(page.getByText('No final exam yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Create final exam' }).click()
  await expect(page).toHaveURL(/\/admin\/quizzes\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: `${title} final exam` })).toBeVisible()
  await expect(page.getByText('Students never see the correct answers')).toBeVisible()
  await expect(page.getByLabel('Questions per attempt')).toHaveValue('65')
  await expect(page.getByLabel('Time limit (minutes)')).toHaveValue('90')
  await expect(page.getByLabel('Maximum attempts')).toHaveValue('3')

  // the 65-question default cannot be published yet
  await page.getByRole('button', { name: 'Publish quiz' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Add at least one question' })).toBeVisible()

  await page.getByLabel('Questions per attempt').fill('3')
  await page.getByLabel('Maximum attempts').fill('2')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Quiz settings saved.')).toBeVisible()

  // new exam questions default to multiple select
  await page.getByRole('button', { name: '+ Add question' }).click()
  await expect(page.getByLabel('Question type')).toHaveValue('MULTIPLE_SELECT')
  await page.getByLabel('Question', { exact: true }).fill('Which of these are AWS regions?')
  await page.getByLabel('Option 1 text').fill('Alpha')
  await page.getByLabel('Option 2 text').fill('Beta')
  await page.getByLabel('Option 3 text').fill('Gamma')
  await page.getByLabel('Option 2 is correct').check()
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await expect(page.getByTestId('question-row')).toHaveCount(1)

  // two more questions through the API, then publish
  const auth = { Authorization: `Bearer ${adminToken}` }
  const examId = new URL(page.url()).pathname.split('/').pop()
  for (const text of ['Which of these are AWS services?', 'Which of these are storage options?']) {
    const res = await request.post(`${API}/admin/quizzes/${examId}/questions`, {
      headers: auth,
      data: { questionText: text, questionType: 'MULTIPLE_SELECT', options: [{ text: 'Alpha', isCorrect: true }, { text: 'Beta', isCorrect: true }, { text: 'Gamma', isCorrect: false }, { text: 'Delta', isCorrect: false }] },
    })
    expect(res.status()).toBe(201)
  }
  await page.reload()
  await expect(page.getByTestId('question-row')).toHaveCount(3)
  await page.getByRole('button', { name: 'Publish quiz' }).click()
  await expect(page.getByText('Live: enrolled students can take this quiz')).toBeVisible()

  // ── admin: unlock rules persist
  await page.goto(`/admin/courses/${courseId(slug)}`)
  await expect(page.getByTestId('final-exam')).toContainText('3 questions in the bank')
  await expect(page.getByLabel('The student must complete every lesson')).toBeChecked()
  await page.getByLabel('A lesson counts as complete after watching (%)').fill('150')
  await page.getByRole('button', { name: 'Save unlock rules' }).click()
  await expect(page.getByText('The watch threshold must be a whole number from 1 to 100')).toBeVisible()
  await page.getByLabel('A lesson counts as complete after watching (%)').fill('50')
  await page.getByRole('button', { name: 'Save unlock rules' }).click()
  await expect(page.getByText('Unlock rules saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('A lesson counts as complete after watching (%)')).toHaveValue('50')
  await noHorizontalOverflow(page)

  // ── student: the exam is locked and says why
  const ctx = await browser.newContext()
  const stu = await ctx.newPage()
  const studentErrors = trackConsole(stu)
  await uiLogin(stu, studentEmail)
  await expect(stu).toHaveURL(/\/dashboard$/)
  await stu.goto(`/learn/${slug}`)
  const card = stu.getByTestId('exam-card')
  await expect(card).toContainText('Locked')
  await expect(card).toContainText('Complete every lesson')
  await expect(card).toContainText('0 of 1 lessons complete (not yet)')
  await expect(card.getByRole('link')).toHaveCount(0)
  await stu.goto(`/quiz/${examId}`)
  await expect(stu.getByTestId('exam-locked')).toContainText('The final exam is locked')
  await expect(stu.getByRole('button', { name: 'Locked' })).toBeDisabled()
  const direct = await request.post(`${API}/learn/quizzes/${examId}/attempts`, { headers: { Authorization: `Bearer ${studentToken}` } })
  expect(direct.status()).toBe(403)
  expect((await direct.json()).error.code).toBe('EXAM_LOCKED')

  // ── finishing the lesson unlocks it
  completeLessons(studentEmail, slug)
  await stu.goto(`/learn/${slug}`)
  await expect(stu.getByTestId('exam-card')).not.toContainText('Locked')
  await expect(stu.getByTestId('course-completed')).toHaveCount(0)
  await stu.getByRole('link', { name: 'Start the final exam' }).click()
  await expect(stu.getByText('3 questions', { exact: true })).toBeVisible()
  await expect(stu.getByText('2 attempts allowed (2 left)')).toBeVisible()
  await expect(stu.getByText('The correct answers are not shown after the exam.')).toBeVisible()
  await stu.getByRole('button', { name: 'Start quiz' }).click()

  // attempt 1: only half of each multi-select answer → every question wrong
  await expect(stu.getByText('Question 1 of 3')).toBeVisible()
  for (let i = 0; i < 3; i++) {
    await expect(stu.getByText('Select all that apply.')).toBeVisible()
    await stu.getByLabel('Alpha', { exact: true }).check()
    if (i < 2) await stu.getByRole('button', { name: 'Next →' }).click()
  }
  await stu.getByRole('button', { name: 'Review and submit' }).click()
  await stu.getByRole('button', { name: 'Submit quiz' }).click()
  await expect(stu.getByTestId('result-percentage')).toHaveText('0%')
  await expect(stu.getByTestId('result-outcome')).toHaveText('Not passed')
  await expect(stu.getByText('The correct answers for the final exam are not shown')).toBeVisible()
  await expect(stu.getByText('✓ correct answer')).toHaveCount(0)
  await expect(stu.getByText('Why:')).toHaveCount(0)
  await expect(stu.getByTestId('review-question').first()).toContainText('Incorrect')
  await noHorizontalOverflow(stu)

  // attempt 2: both right answers on every question
  await stu.getByRole('link', { name: 'Try again' }).click()
  await expect(stu.getByText('2 attempts allowed (1 left)')).toBeVisible()
  await stu.getByRole('button', { name: 'Try again' }).click()
  for (let i = 0; i < 3; i++) {
    await stu.getByLabel('Alpha', { exact: true }).check()
    await stu.getByLabel('Beta', { exact: true }).check()
    if (i < 2) await stu.getByRole('button', { name: 'Next →' }).click()
  }
  await stu.getByRole('button', { name: 'Review and submit' }).click()
  await stu.getByRole('button', { name: 'Submit quiz' }).click()
  await expect(stu.getByTestId('result-percentage')).toHaveText('100%')
  await expect(stu.getByTestId('result-outcome')).toHaveText('Passed ✓')
  await expect(stu.getByText('✓ correct answer')).toHaveCount(0)

  // ── the course is complete
  await stu.goto(`/learn/${slug}`)
  await expect(stu.getByTestId('course-completed')).toBeVisible()
  await expect(stu.getByTestId('exam-card')).toContainText('Passed with 100%')
  await stu.goto('/dashboard')
  await expect(stu.getByTestId('enrollment-row')).toContainText('Completed')
  expect(sql(`select e.status from enrollments e join users u on u.id=e.user_id where u.email='${studentEmail}'`)).toBe('COMPLETED')

  // no attempts are left on the exam
  await stu.goto(`/quiz/${examId}`)
  await expect(stu.getByRole('button', { name: 'No attempts left' })).toBeDisabled()
  await ctx.close()

  expect(adminErrors(), 'admin console errors').toEqual([])
  expect(studentErrors(), 'student console errors').toEqual([])
})
