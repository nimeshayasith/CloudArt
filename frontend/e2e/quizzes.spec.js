import { expect, test } from '@playwright/test'
import { API, apiLogin, cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Quiz University'
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

/** A published course with one module ("Basics") and one published lesson, straight into PostgreSQL. */
function seedCourse({ slug, ownerEmail, tag }) {
  sql(`insert into courses (title, slug, category_id, created_by, status, description, difficulty, updated_at)
         select 'E2E Quiz Course ${tag}', '${slug}', (select id from course_categories order by sort_order limit 1), id, 'PUBLISHED', 'Quiz testing', 'BEGINNER', now()
         from users where email='${ownerEmail}';
       insert into course_modules (course_id, title, is_published, sort_order) select id, 'Basics', true, 0 from courses where slug='${slug}';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Warm up', 'AAAAAAAAAAA', 60, true, 0, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}'`)
}
const courseId = (slug) => sql(`select id from courses where slug='${slug}'`)
const moduleId = (slug) => sql(`select m.id from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}' and m.title='Basics'`)

async function enroll(request, token, slug) {
  const res = await request.post(`${API}/courses/${slug}/enroll`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.status()).toBe(201)
}

test('admin builds and publishes a quiz in the UI; a student fails, retries, passes and sees the review', async ({ page, request, browser }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartqza${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartqzs${tag}@simulator.amazonses.com`
  const slug = `e2e-course-qz-${tag}`.toLowerCase()
  created.push(adminEmail, studentEmail)
  const adminErrors = trackConsole(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `qza_${tag}`, fullName: 'Quiz Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: `qzs_${tag}`, fullName: 'Quiz Student', organization: ORG })
  const studentToken = await apiLogin(request, studentEmail)
  await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${studentToken}` } }) // provisions the profile
  await uiLogin(page, adminEmail)
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')
  seedCourse({ slug, ownerEmail: adminEmail, tag })
  await enroll(request, studentToken, slug)

  // ── admin: add a quiz to the module
  await page.goto(`/admin/courses/${courseId(slug)}`)
  await page.getByRole('button', { name: 'Add quiz to Basics' }).click()
  await expect(page).toHaveURL(/\/admin\/quizzes\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Basics quiz' })).toBeVisible()

  // settings: validation, then save (no shuffle so the order below is predictable)
  await page.getByLabel('Questions per attempt').fill('0')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Questions per attempt must be a whole number from 1 to 200')).toBeVisible()
  await page.getByLabel('Questions per attempt').fill('3')
  await page.getByLabel('Pass mark (%)').fill('60')
  await page.getByLabel('Maximum attempts').fill('3')
  await page.getByLabel('Draw questions in random order').uncheck()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Quiz settings saved.')).toBeVisible()

  // an empty quiz cannot be published
  await page.getByRole('button', { name: 'Publish quiz' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Add at least one question' })).toBeVisible()

  // ── question 1 (single choice): client validation, then success
  await page.getByRole('button', { name: '+ Add question' }).click()
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await expect(page.getByText('Write the question')).toBeVisible()
  await expect(page.getByText('Every option needs text')).toBeVisible()
  await page.getByLabel('Question', { exact: true }).fill('Which service stores objects?')
  await page.getByLabel('Option 1 text').fill('S3')
  await page.getByLabel('Option 2 text').fill('EC2')
  await page.getByLabel('Option 3 text').fill('S3') // duplicate on purpose
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await expect(page.getByText('Options must be different from each other')).toBeVisible()
  await page.getByLabel('Option 3 text').fill('VPC')
  await page.getByLabel('Explanation shown after the quiz (optional)').fill('S3 is object storage.')
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await expect(page.getByTestId('question-row')).toHaveCount(1)

  // ── question 2 (multiple select: two correct answers)
  await page.getByRole('button', { name: '+ Add question' }).click()
  await page.getByLabel('Question', { exact: true }).fill('Which of these are compute services?')
  await page.getByLabel('Question type').selectOption('MULTIPLE_SELECT')
  await page.getByLabel('Option 1 text').fill('EC2')
  await page.getByLabel('Option 2 text').fill('Lambda')
  await page.getByLabel('Option 3 text').fill('S3 Glacier')
  await page.getByLabel('Option 2 is correct').check() // option 1 is already ticked
  await page.getByLabel('Marks').fill('2')
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await expect(page.getByTestId('question-row')).toHaveCount(2)

  // ── question 3 (true / false, answer False)
  await page.getByRole('button', { name: '+ Add question' }).click()
  await page.getByLabel('Question', { exact: true }).fill('EC2 is a storage service.')
  await page.getByLabel('Question type').selectOption('TRUE_FALSE')
  await expect(page.getByLabel('Option 1 text')).toHaveValue('True')
  await expect(page.getByLabel('Option 2 text')).toHaveValue('False')
  await page.getByLabel('Option 2 is correct').check()
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await expect(page.getByTestId('question-row')).toHaveCount(3)
  await expect(page.getByTestId('question-row').nth(1)).toContainText('Multiple select')
  await expect(page.getByTestId('question-row').nth(1)).toContainText('2 marks')

  // ── reorder: the true/false question moves second
  await page.getByRole('button', { name: 'Move question 3 up' }).click()
  await expect(page.getByTestId('question-row').nth(1)).toContainText('EC2 is a storage service.')
  await page.reload()
  await expect(page.getByTestId('question-row').nth(1)).toContainText('EC2 is a storage service.')

  // ── edit question 1, then publish
  await page.getByRole('button', { name: 'Edit question 1' }).click()
  await page.getByLabel('Question', { exact: true }).fill('Which AWS service stores objects?')
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByTestId('question-row').first()).toContainText('Which AWS service stores objects?')
  await page.getByRole('button', { name: 'Publish quiz' }).click()
  await expect(page.getByText('Live: enrolled students can take this quiz')).toBeVisible()
  await noHorizontalOverflow(page)

  // ── student: finds the quiz in the course sidebar
  const ctx = await browser.newContext()
  const stu = await ctx.newPage()
  const studentErrors = trackConsole(stu)
  await uiLogin(stu, studentEmail)
  await expect(stu).toHaveURL(/\/dashboard$/)
  await stu.goto(`/learn/${slug}`)
  await expect(stu.getByTestId('module-quiz-link')).toContainText('Basics quiz')
  await expect(stu.getByTestId('module-quiz-link')).toContainText('3 questions')
  await stu.getByTestId('module-quiz-link').click()

  await expect(stu.getByRole('heading', { name: 'Basics quiz' })).toBeVisible()
  await expect(stu.getByText('3 questions', { exact: true })).toBeVisible()
  await expect(stu.getByText('Pass mark: 60%')).toBeVisible()
  await expect(stu.getByText('3 attempts allowed (3 left)')).toBeVisible()
  await stu.getByRole('button', { name: 'Start quiz' }).click()
  await expect(stu).toHaveURL(/\/attempt\/[0-9a-f-]{36}$/)

  // question 1: answer, autosave, survive a reload
  await expect(stu.getByText('Question 1 of 3')).toBeVisible()
  await expect(stu.getByTestId('question-text')).toHaveText('Which AWS service stores objects?')
  const saved = stu.waitForResponse((r) => r.url().includes('/answers') && r.request().method() === 'PUT')
  await stu.getByLabel('S3', { exact: true }).check()
  expect((await saved).status()).toBe(200)
  await expect(stu.getByText('All changes saved')).toBeVisible()
  await stu.reload()
  await expect(stu.getByLabel('S3', { exact: true })).toBeChecked()
  await expect(stu.getByRole('button', { name: 'Go to question 1 (answered)' })).toBeVisible()

  // question 2 (true / false): the wrong answer on purpose
  await stu.getByRole('button', { name: 'Next →' }).click()
  await expect(stu.getByTestId('question-text')).toHaveText('EC2 is a storage service.')
  await stu.getByLabel('True', { exact: true }).check()

  // question 3 (multi-select): leave unanswered first, and see the warning
  await stu.getByRole('button', { name: 'Next →' }).click()
  await expect(stu.getByText('Select all that apply.')).toBeVisible()
  await stu.getByRole('button', { name: 'Review and submit' }).click()
  await expect(stu.getByText('You have 1 unanswered question.')).toBeVisible()
  await stu.getByRole('button', { name: 'Keep working' }).click()
  await stu.getByLabel('EC2', { exact: true }).check() // only half of the right answer → counts as wrong
  await stu.getByRole('button', { name: 'Review and submit' }).click()
  await stu.getByRole('button', { name: 'Submit quiz' }).click()

  // ── result: 1 of 4 marks = 25% → not passed; the review shows the key and the explanation
  await expect(stu.getByTestId('result-percentage')).toHaveText('25%')
  await expect(stu.getByTestId('result-outcome')).toHaveText('Not passed')
  await expect(stu.getByText('1 of 4 marks · pass mark 60%')).toBeVisible()
  const review = stu.getByTestId('review-question')
  await expect(review).toHaveCount(3)
  await expect(review.nth(0)).toContainText('Correct')
  await expect(review.nth(0)).toContainText('S3 is object storage.')
  await expect(review.nth(1)).toContainText('Incorrect')
  await expect(review.nth(1)).toContainText('✓ correct answer')
  await expect(review.nth(2)).toContainText('Incorrect')
  await expect(review.nth(2)).toContainText('0 of 2 marks')
  await noHorizontalOverflow(stu)

  // ── try again and pass
  await stu.getByRole('link', { name: 'Try again' }).click()
  await expect(stu.getByText('3 attempts allowed (2 left)')).toBeVisible()
  await expect(stu.getByTestId('attempt-history')).toContainText('25%')
  await stu.getByRole('button', { name: 'Try again' }).click()
  await expect(stu.getByText('Question 1 of 3')).toBeVisible()
  await stu.getByLabel('S3', { exact: true }).check()
  await stu.getByRole('button', { name: 'Next →' }).click()
  await stu.getByLabel('False', { exact: true }).check()
  await stu.getByRole('button', { name: 'Next →' }).click()
  await stu.getByLabel('EC2', { exact: true }).check()
  await stu.getByLabel('Lambda', { exact: true }).check()
  await stu.getByRole('button', { name: 'Review and submit' }).click()
  await expect(stu.getByText('You have answered every question.')).toBeVisible()
  await stu.getByRole('button', { name: 'Submit quiz' }).click()
  await expect(stu.getByTestId('result-percentage')).toHaveText('100%')
  await expect(stu.getByTestId('result-outcome')).toHaveText('Passed ✓')

  // the course sidebar remembers the pass
  await stu.goto(`/learn/${slug}`)
  await expect(stu.getByTestId('module-quiz-link')).toContainText('Passed 100%')

  // ── admin: results, and used questions are locked
  await page.goto(`/admin/quizzes/${sql(`select id from quizzes where title='Basics quiz' and course_id='${courseId(slug)}'`)}`)
  await expect(page.getByTestId('attempt-row')).toHaveCount(2)
  await expect(page.getByTestId('attempt-row').first()).toContainText('Quiz Student')
  await expect(page.getByTestId('attempt-row').first()).toContainText('100% · Passed')
  await expect(page.getByTestId('attempt-row').nth(1)).toContainText('25% · Not passed')
  await expect(page.getByTestId('question-row').first()).toContainText('Used in 2 attempts')
  await expect(page.getByText('wording and options are locked').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete question 1' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit question 1' }).click()
  await expect(page.getByLabel('Question', { exact: true })).toHaveCount(0) // only the explanation can change
  await page.getByRole('textbox', { name: 'Explanation' }).fill('S3 stores objects, EBS stores blocks.')
  await page.getByRole('button', { name: 'Save explanation' }).click()
  await page.getByRole('button', { name: 'Delete quiz' }).click()
  await page.getByRole('button', { name: 'Confirm delete quiz' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'attempted this quiz' })).toBeVisible()
  await ctx.close()

  expect(adminErrors(), 'admin console errors').toEqual([])
  expect(studentErrors(), 'student console errors').toEqual([])
})

test('a timed quiz submits itself when the countdown reaches zero', async ({ page, request }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const adminEmail = `success+cloudartqta${tag}@simulator.amazonses.com`
  const studentEmail = `success+cloudartqts${tag}@simulator.amazonses.com`
  const slug = `e2e-course-qt-${tag}`.toLowerCase()
  created.push(adminEmail, studentEmail)
  const consoleErrors = trackConsole(page)

  await makeVerifiedUser(request, { email: adminEmail, username: `qta_${tag}`, fullName: 'Timer Admin', organization: ORG })
  await makeVerifiedUser(request, { email: studentEmail, username: `qts_${tag}`, fullName: 'Timer Student', organization: ORG })
  const adminToken = await apiLogin(request, adminEmail)
  const studentToken = await apiLogin(request, studentEmail)
  for (const t of [adminToken, studentToken]) await request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${t}` } })
  expect(sql(`update users set system_role='ADMIN' where email='${adminEmail}' returning 1`)).toContain('1')
  seedCourse({ slug, ownerEmail: adminEmail, tag })
  await enroll(request, studentToken, slug)

  // Build the quiz through the admin API (the UI path is covered above).
  const auth = { Authorization: `Bearer ${adminToken}` }
  const quiz = (await (await request.post(`${API}/admin/modules/${moduleId(slug)}/quiz`, { headers: auth, data: { title: 'Timed quiz', durationMinutes: 5, totalQuestions: 1, shuffleQuestions: false } })).json()).quiz
  const q = await request.post(`${API}/admin/quizzes/${quiz.id}/questions`, {
    headers: auth,
    data: { questionText: 'Is the sky blue?', questionType: 'TRUE_FALSE', options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] },
  })
  expect(q.status()).toBe(201)
  expect((await request.patch(`${API}/admin/quizzes/${quiz.id}`, { headers: auth, data: { status: 'PUBLISHED' } })).status()).toBe(200)

  await uiLogin(page, studentEmail)
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto(`/quiz/${quiz.id}`)
  await expect(page.getByText('Time limit: 5 minutes')).toBeVisible()
  await page.getByRole('button', { name: 'Start quiz' }).click()
  await expect(page.getByRole('timer', { name: 'Time left' })).toContainText(/0[45]:\d\d/)
  await page.getByLabel('True', { exact: true }).check()
  await expect(page.getByText('All changes saved')).toBeVisible()

  // Shorten the deadline to a few seconds and reload: the countdown restarts from the server's clock.
  sql(`update quiz_attempts set expires_at = now() + interval '4 seconds' where quiz_id='${quiz.id}'`)
  await page.reload()
  await expect(page.getByRole('timer', { name: 'Time left' })).toContainText(/00:0[0-4]/)

  // No click: the quiz submits itself and the saved answer is graded.
  await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('result-percentage')).toHaveText('100%')
  await expect(page.getByTestId('result-outcome')).toHaveText('Passed ✓')
  expect(sql(`select status from quiz_attempts where quiz_id='${quiz.id}'`)).toMatch(/SUBMITTED|EXPIRED/)

  expect(consoleErrors(), 'console errors').toEqual([])
})

test('quiz pages are closed to visitors who are not signed in, and to admin routes for students', async ({ page }) => {
  for (const path of ['/quiz/11111111-1111-4111-8111-111111111111', '/attempt/11111111-1111-4111-8111-111111111111', '/admin/quizzes/11111111-1111-4111-8111-111111111111']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
  }
})
