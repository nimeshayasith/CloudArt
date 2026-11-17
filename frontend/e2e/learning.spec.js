import { expect, test } from '@playwright/test'
import { cleanup, makeVerifiedUser, sql, uiLogin } from './helpers.js'

const ORG = 'E2E Learning University'
const created = []
test.afterAll(() => cleanup(created, [ORG]))

// A stand-in for YouTube's IFrame API (the real one needs the internet and cannot be driven by a test).
// It exposes window.__fakePlayer so the test can "watch": seek(t), play(), pause(), end().
const FAKE_YOUTUBE = `
window.YT = {
  PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
  Player: class {
    constructor(el, opts) {
      const box = document.createElement('div')
      box.setAttribute('data-testid', 'fake-player')
      box.dataset.videoId = opts.videoId
      box.dataset.start = String((opts.playerVars && opts.playerVars.start) || 0)
      box.style.cssText = 'width:100%;height:100%'
      el.replaceWith(box)
      this.box = box
      this.opts = opts
      this.time = (opts.playerVars && opts.playerVars.start) || 0
      this.duration = 600
      window.__fakePlayer = this
      setTimeout(() => opts.events.onReady({ target: this }), 0)
    }
    getCurrentTime() { return this.time }
    getDuration() { return this.duration }
    destroy() { this.box.remove() }
    emit(state) { this.opts.events.onStateChange({ data: state }) }
    play() { this.emit(1) }
    pause() { this.emit(2) }
    seek(t) { this.time = t }
    end() { this.time = this.duration; this.emit(0) }
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
  // 403/404 console lines come from deliberate negative checks (opening a course before enrolling).
  return () => errors.filter((e) => !/\b(400|401|403|404|409)\b/.test(e))
}
const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

const IDS = { A: 'AAAAAAAAAAA', B: 'BBBBBBBBBBB', C: 'CCCCCCCCCCC' }

function seedCourse({ slug, email, tag }) {
  sql(`insert into courses (title, slug, category_id, created_by, status, description, difficulty, updated_at)
         select 'E2E Learning Course ${tag}', '${slug}', (select id from course_categories order by sort_order limit 1), id, 'PUBLISHED', 'Learn by watching', 'BEGINNER', now()
         from users where email='${email}';
       insert into course_modules (course_id, title, is_published, sort_order) select id, 'Basics', true, 0 from courses where slug='${slug}';
       insert into course_modules (course_id, title, is_published, sort_order) select id, 'Advanced', true, 1 from courses where slug='${slug}';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Intro to IAM', '${IDS.A}', 600, true, 0, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}' and m.title='Basics';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Users and groups', '${IDS.B}', 300, true, 1, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}' and m.title='Basics';
       insert into lessons (module_id, title, youtube_video_id, duration_seconds, is_published, sort_order, updated_at)
         select m.id, 'Roles in practice', '${IDS.C}', 120, true, 0, now() from course_modules m join courses c on c.id = m.course_id where c.slug='${slug}' and m.title='Advanced'`)
}

/** Pretend the student's previous save happened 10 minutes ago, so the server credits that much watch time. */
const backdateProgress = (email) =>
  sql(`update lesson_progress set last_watched_at = now() - interval '10 minutes'
       where enrollment_id in (select e.id from enrollments e join users u on u.id = e.user_id where u.email='${email}')`)

const savedProgress = (page) =>
  page.waitForResponse((r) => /\/learn\/lessons\/[0-9a-f-]+\/progress$/.test(r.url()) && r.request().method() === 'PUT')

test('student enrolls, watches, resumes where they stopped, completes a lesson and sees progress', async ({ page, request }, info) => {
  const ts = Date.now()
  const tag = `${info.project.name}${ts}`
  const email = `success+cloudartlrn${tag}@simulator.amazonses.com`
  const slug = `e2e-course-lrn-${tag}`.toLowerCase()
  const title = `E2E Learning Course ${tag}`
  created.push(email)
  const consoleErrors = trackConsole(page)
  await installFakeYouTube(page)

  await makeVerifiedUser(request, { email, username: `lrn_${tag}`, fullName: 'Learning Student', organization: ORG })
  await uiLogin(page, email)
  await expect(page).toHaveURL(/\/dashboard$/)
  seedCourse({ slug, email, tag })

  // ── not enrolled: the player is closed and offers to enroll
  await page.goto(`/learn/${slug}`)
  await expect(page.getByText('You’re not enrolled yet')).toBeVisible()
  await expect(page.getByTestId('fake-player')).toHaveCount(0)

  // ── enroll from the course page
  await page.goto(`/courses/${slug}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Enroll for free' }).click()
  await expect(page).toHaveURL(new RegExp(`/learn/${slug}$`))
  await expect(page.getByRole('heading', { name: 'Intro to IAM' })).toBeVisible()
  await expect(page.getByTestId('fake-player')).toHaveAttribute('data-video-id', IDS.A)
  await expect(page.getByTestId('fake-player')).toHaveAttribute('data-start', '0')
  await expect(page.getByText('0 of 3 lessons complete')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('aria-valuenow', '0')

  // the course page now says "continue"
  await page.goto(`/courses/${slug}`)
  await expect(page.getByText('You’re enrolled in this course.')).toBeVisible()
  await page.getByRole('link', { name: 'Continue learning' }).click()

  // ── watch for a while, pause: the position is saved
  await expect(page.getByTestId('fake-player')).toBeVisible()
  await page.evaluate(() => { window.__fakePlayer.seek(20); window.__fakePlayer.play() })
  const paused = savedProgress(page)
  await page.evaluate(() => window.__fakePlayer.pause())
  expect((await paused).status()).toBe(200)

  // ── leaving the page and coming back resumes at the saved position
  await page.goto('/dashboard')
  const row = page.getByTestId('enrollment-row')
  await expect(row).toContainText(title)
  await expect(row).toContainText('0/3 lessons')
  await row.getByRole('link', { name: `Continue ${title}` }).click()
  await expect(page.getByRole('heading', { name: 'Intro to IAM' })).toBeVisible()
  await expect(page.getByTestId('fake-player')).toHaveAttribute('data-start', '20')

  // ── switching lessons opens the other video from the beginning
  await page.getByRole('link', { name: /Users and groups/ }).click()
  await expect(page).toHaveURL(/lesson=/)
  await expect(page.getByRole('heading', { name: 'Users and groups' })).toBeVisible()
  await expect(page.getByTestId('fake-player')).toHaveAttribute('data-video-id', IDS.B)
  await expect(page.getByTestId('fake-player')).toHaveAttribute('data-start', '0')

  // ── finish the first lesson (server credits real watch time only, so backdate the last save)
  await page.getByRole('link', { name: /Intro to IAM/ }).click()
  await expect(page.getByRole('heading', { name: 'Intro to IAM' })).toBeVisible()
  await expect(page.getByTestId('fake-player')).toHaveAttribute('data-start', '20')
  backdateProgress(email)
  const finished = savedProgress(page)
  await page.evaluate(() => window.__fakePlayer.end())
  const body = await (await finished).json()
  expect(body.lesson.completed).toBe(true)
  expect(body.progress).toEqual({ completedLessons: 1, totalLessons: 3, percent: 33 })

  await expect(page.getByText('1 of 3 lessons complete')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('aria-valuenow', '33')
  await expect(page.getByRole('link', { name: /Intro to IAM.*completed/ })).toBeVisible()
  await expect(page.getByText('Lesson finished. Ready for the next one?')).toBeVisible()
  await noHorizontalOverflow(page)

  // ── a completed lesson restarts from the beginning; "Next lesson" continues
  await page.getByRole('link', { name: 'Next lesson →' }).click()
  await expect(page.getByRole('heading', { name: 'Users and groups' })).toBeVisible()

  // ── dashboard reflects real progress, and "Continue" resumes at the next unfinished lesson
  await page.goto('/dashboard')
  await expect(page.getByTestId('enrollment-row')).toContainText('1/3 lessons · 33%')
  await expect(page.getByRole('progressbar', { name: `Progress in ${title}` })).toHaveAttribute('aria-valuenow', '33')
  await page.getByRole('link', { name: `Continue ${title}` }).click()
  await expect(page.getByRole('heading', { name: 'Users and groups' })).toBeVisible()

  // ── leaving keeps the progress for next time
  await page.getByRole('button', { name: 'Leave this course' }).click()
  await page.getByRole('button', { name: 'Confirm leave' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('You haven’t enrolled in a course yet')).toBeVisible()
  await page.goto(`/learn/${slug}`)
  await expect(page.getByText('You’re not enrolled yet')).toBeVisible()
  await page.getByRole('button', { name: 'Enroll in this course' }).click()
  await expect(page.getByText('1 of 3 lessons complete')).toBeVisible()

  expect(consoleErrors(), 'console errors').toEqual([])
})

test('learning pages are closed to visitors who are not signed in', async ({ page }) => {
  await page.goto('/learn/some-course')
  await expect(page).toHaveURL(/\/login/)
})
