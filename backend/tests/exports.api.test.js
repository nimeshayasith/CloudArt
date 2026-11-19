import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Only the Cognito JWT verifier is faked; middleware, authorization and PostgreSQL are real.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (token) => {
        const [prefix, sub, email, name] = token.split('|')
        if (prefix !== 'tok') throw new Error('bad token')
        return { sub, email, email_verified: true, name, preferred_username: sub, 'custom:prof_category': 'STUDENT' }
      },
    }),
  },
}))

const { createApp } = await import('../src/app.js')
const { prisma } = await import('../src/config/prisma.js')
const { safeText, fileSlug, cellText } = await import('../src/modules/exports/xlsx.js')

const app = createApp()
const s = Date.now()
const TAG = `P8-${s}`
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm8-${s}|admin8${s}@test.local|Admin Eight`
const tokA = `tok|stuA8-${s}|stua8${s}@test.local|Student A`
const tokB = `tok|stuB8-${s}|stub8${s}@test.local|Student B`
const tokC = `tok|stuC8-${s}|stuc8${s}@test.local|Student C`
const FORMULA_NAME = '=HYPERLINK("http://evil.example","click")'

const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok = tokA) => request(app)[method](`/api/v1${url}`).set(as(tok))
const opts = (...pairs) => pairs.map(([text, isCorrect]) => ({ text, isCorrect: !!isCorrect }))

const binary = (res, cb) => {
  const chunks = []
  res.on('data', (c) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}
/** Downloads a workbook and parses it. */
async function download(url, tok = adminTok) {
  const res = await request(app).get(`/api/v1/admin${url}`).set(as(tok)).buffer(true).parse(binary)
  if (res.status !== 200) return { res }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(res.body)
  const ws = wb.worksheets[0]
  const header = ws.getRow(1).values.slice(1).map((v) => cellText({ value: v }))
  const rows = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    rows.push(Object.fromEntries(header.map((h, i) => [h, cellText(row.getCell(i + 1))])))
  })
  return { res, wb, ws, header, rows }
}

const HEADERS = ['Question', 'Type', 'Marks', 'Correct options', 'Explanation', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Option 6', 'Option 7', 'Option 8']
async function sheetBuffer(rows, { headers = HEADERS, sheetName = 'Questions' } = {}) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  ws.addRow(headers)
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
const upload = (quizId, body, { type = XLSX, tok = adminTok } = {}) =>
  request(app).post(`/api/v1/admin/quizzes/${quizId}/questions/import`).set(as(tok)).set('Content-Type', type).send(body)

let adminUser, userA, userB, userC, category, course, module1, lessons, quiz, quizQs

/** Empty draft module quiz for import tests. */
async function emptyQuiz(title) {
  const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: `${title} module`, sortOrder: Math.floor(Math.random() * 1e6), isPublished: false } })
  const res = await admin('post', `/modules/${mod.id}/quiz`).send({ title: `${TAG} ${title}` })
  expect(res.status).toBe(201)
  return res.body.quiz.id
}
const questionCount = (quizId) => prisma.question.count({ where: { quizId } })

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm8-${s}`, fullName: 'Admin Eight', username: `admin8${s}`, email: `admin8${s}@test.local`, systemRole: 'ADMIN' } })
  category = await prisma.courseCategory.findFirstOrThrow()
  userA = (await api('get', '/users/me', tokA)).body.user
  userB = (await api('get', '/users/me', tokB)).body.user
  userC = (await api('get', '/users/me', tokC)).body.user
  // a user whose profile fields try to inject a formula
  await prisma.user.update({ where: { id: userC.id }, data: { fullName: FORMULA_NAME } })
  await prisma.user.update({ where: { id: userB.id }, data: { isActive: false } })
  await prisma.user.update({ where: { id: userB.id }, data: { isActive: true } })

  course = await prisma.course.create({ data: { title: `${TAG} Course`, slug: `p8-${s}-main`, categoryId: category.id, createdById: adminUser.id, status: 'PUBLISHED' } })
  module1 = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Module', sortOrder: 0, isPublished: true } })
  lessons = []
  for (const [i, published] of [true, true, false].entries()) {
    lessons.push(await prisma.lesson.create({ data: { moduleId: module1.id, title: `Lesson ${i + 1}`, youtubeVideoId: 'dQw4w9WgXcQ', durationSeconds: 60, sortOrder: i, isPublished: published } }))
  }
  const mq = await admin('post', `/modules/${module1.id}/quiz`).send({ title: `${TAG} progress quiz`, totalQuestions: 1, passPercentage: 50, shuffleQuestions: false })
  quiz = mq.body.quiz
  await admin('post', `/quizzes/${quiz.id}/questions`).send({ questionText: 'Progress question', questionType: 'SINGLE_CHOICE', options: opts(['Right', true], ['Wrong']) })
  await admin('patch', `/quizzes/${quiz.id}`).send({ status: 'PUBLISHED' })
  const key = (await admin('get', `/quizzes/${quiz.id}`)).body.quiz.questions[0]
  quizQs = new Map([[key.id, key.options.filter((o) => o.isCorrect).map((o) => o.id)]])

  // A: enrolled, finished lesson 1, passed the quiz.  B: enrolled, nothing.  C: enrolled then left.
  for (const t of [tokA, tokB, tokC]) await api('post', `/courses/${course.slug}/enroll`, t)
  await api('delete', `/courses/${course.slug}/enroll`, tokC)
  const enrollmentA = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: course.id } })
  await prisma.lessonProgress.create({ data: { enrollmentId: enrollmentA.id, lessonId: lessons[0].id, lastPositionSeconds: 60, maxPositionSeconds: 60, completed: true, completedAt: new Date() } })
  const attempt = (await api('post', `/learn/quizzes/${quiz.id}/attempts`, tokA)).body.attempt
  await api('post', `/learn/attempts/${attempt.id}/submit`, tokA).send({ answers: attempt.questions.map((q) => ({ questionId: q.id, selectedOptionIds: quizQs.get(q.id) })) })
  // a second, failing attempt by B
  const bAttempt = (await api('post', `/learn/quizzes/${quiz.id}/attempts`, tokB)).body.attempt
  await api('post', `/learn/attempts/${bAttempt.id}/submit`, tokB).send({})
})

afterAll(async () => {
  const mine = await prisma.course.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  const ids = mine.map((c) => c.id)
  await prisma.enrollment.deleteMany({ where: { courseId: { in: ids } } })
  await prisma.course.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

describe('spreadsheet helpers', () => {
  it('safeText neutralises formula starters and leaves normal text alone', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=x', '\r=x']) expect(safeText(bad)).toBe(`'${bad}`)
    for (const ok of ['Alice', 'a=b', '1+1', ' =spaced', '']) expect(safeText(ok)).toBe(ok)
    expect(safeText(null)).toBe('')
    expect(safeText(undefined)).toBe('')
    expect(safeText(42)).toBe('42')
  })
  it('fileSlug makes safe file names', () => {
    expect(fileSlug('Intro to AWS: Part 1!')).toBe('intro-to-aws-part-1')
    expect(fileSlug('../../etc/passwd')).toBe('etc-passwd')
    expect(fileSlug('日本語', 'quiz')).toBe('quiz')
  })
  it('cellText reads plain, rich-text, formula-result and empty cells', () => {
    expect(cellText({ value: 'x' })).toBe('x')
    expect(cellText({ value: 3 })).toBe('3')
    expect(cellText({ value: { richText: [{ text: 'a' }, { text: 'b' }] } })).toBe('ab')
    expect(cellText({ value: { formula: 'A1', result: 7 } })).toBe('7')
    expect(cellText({ value: null })).toBe('')
    expect(cellText(undefined)).toBe('')
  })
})

describe('export authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const routes = [
    ['get', '/exports/users.xlsx'],
    ['get', `/exports/courses/${id}/progress.xlsx`],
    ['get', `/exports/quizzes/${id}/results.xlsx`],
    ['get', `/quizzes/${id}/questions/export.xlsx`],
    ['get', '/question-template.xlsx'],
    ['post', `/quizzes/${id}/questions/import`],
  ]
  it.each(routes)('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](`/api/v1/admin${url}`).send({})).status).toBe(401)
  })
  it.each(routes)('%s %s → 403 for a student', async (method, url) => {
    const res = await admin(method, url, tokA).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('users export', () => {
  it('is an uncacheable .xlsx attachment', async () => {
    const { res } = await download('/exports/users.xlsx')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain(XLSX)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="cloudart-users-\d{4}-\d{2}-\d{2}\.xlsx"$/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.subarray(0, 2).toString()).toBe('PK') // a zip container
  })

  it('has one row per user with the right columns and values', async () => {
    const { header, rows } = await download('/exports/users.xlsx')
    expect(header).toEqual(['Full name', 'Username', 'Email', 'Organization', 'Role category', 'Account type', 'Status', 'Courses enrolled', 'Joined'])
    expect(rows).toHaveLength(await prisma.user.count())
    const a = rows.find((r) => r.Email === `stua8${s}@test.local`)
    expect(a).toMatchObject({ 'Full name': 'Student A', 'Account type': 'Student', Status: 'Active', 'Courses enrolled': '1' })
    expect(a.Joined).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rows.find((r) => r.Email === `admin8${s}@test.local`)['Account type']).toBe('Admin')
    expect(rows.every((r) => !/cognito/i.test(JSON.stringify(r)))).toBe(true)
  })

  it('stores a formula in a user-supplied field as harmless text', async () => {
    const { rows, ws } = await download('/exports/users.xlsx')
    const c = rows.find((r) => r.Email === `stuc8${s}@test.local`)
    expect(c['Full name']).toBe(`'${FORMULA_NAME}`)
    // and no cell anywhere is a formula
    let formulas = 0
    ws.eachRow((row) => row.eachCell((cell) => { if (cell.type === ExcelJS.ValueType.Formula) formulas++ }))
    expect(formulas).toBe(0)
  })

  it('reflects disabled accounts', async () => {
    await prisma.user.update({ where: { id: userB.id }, data: { isActive: false } })
    const { rows } = await download('/exports/users.xlsx')
    expect(rows.find((r) => r.Email === `stub8${s}@test.local`).Status).toBe('Disabled')
    await prisma.user.update({ where: { id: userB.id }, data: { isActive: true } })
  })
})

describe('course progress export', () => {
  it('lists every enrollee with real progress and quiz results', async () => {
    const { res, header, rows } = await download(`/exports/courses/${course.id}/progress.xlsx`)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain(`cloudart-progress-p8-${s}-main-`)
    const quizHeader = header.find((h) => h.startsWith('Quiz:'))
    expect(quizHeader).toBe(`Quiz: ${TAG} progress quiz (best %)`)
    expect(header.slice(0, 10)).toEqual(['Full name', 'Username', 'Email', 'Organization', 'Enrolled', 'Status', 'Lessons completed', 'Total lessons', 'Progress %', 'Last activity'])
    expect(rows).toHaveLength(3)

    const byEmail = (n) => rows.find((r) => r.Email === `stu${n}8${s}@test.local`)
    // 2 published lessons count; the unpublished third one does not
    expect(byEmail('a')).toMatchObject({ Status: 'In progress', 'Lessons completed': '1', 'Total lessons': '2', 'Progress %': '50', [quizHeader]: '100% (passed)' })
    expect(byEmail('a')['Last activity']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(byEmail('b')).toMatchObject({ Status: 'In progress', 'Lessons completed': '0', 'Progress %': '0', [quizHeader]: '0%', 'Last activity': '' })
    expect(byEmail('c')).toMatchObject({ Status: 'Left course', 'Lessons completed': '0', [quizHeader]: '' })
  })

  it('returns 404 for unknown or malformed course ids', async () => {
    expect((await download('/exports/courses/11111111-1111-4111-8111-111111111111/progress.xlsx')).res.status).toBe(404)
    expect((await download('/exports/courses/not-a-uuid/progress.xlsx')).res.status).toBe(404)
  })

  it('marks a completed course', async () => {
    await prisma.enrollment.updateMany({ where: { userId: userA.id, courseId: course.id }, data: { status: 'COMPLETED' } })
    const { rows } = await download(`/exports/courses/${course.id}/progress.xlsx`)
    expect(rows.find((r) => r.Email === `stua8${s}@test.local`).Status).toBe('Completed')
    await prisma.enrollment.updateMany({ where: { userId: userA.id, courseId: course.id }, data: { status: 'ACTIVE' } })
  })
})

describe('quiz results export', () => {
  it('has one row per attempt with the score and result', async () => {
    const { res, header, rows } = await download(`/exports/quizzes/${quiz.id}/results.xlsx`)
    expect(res.status).toBe(200)
    expect(header).toEqual(['Full name', 'Username', 'Email', 'Attempt', 'Status', 'Started', 'Submitted', 'Score (marks)', 'Percentage', 'Result'])
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.Email === `stua8${s}@test.local`)
    expect(a).toMatchObject({ Attempt: '1', Status: 'Submitted', 'Score (marks)': '1', Percentage: '100', Result: 'Passed' })
    const b = rows.find((r) => r.Email === `stub8${s}@test.local`)
    expect(b).toMatchObject({ Percentage: '0', Result: 'Not passed' })
  })

  it('shows an unfinished attempt as in progress with no result', async () => {
    await api('post', `/learn/quizzes/${quiz.id}/attempts`, tokC).catch(() => {})
    await prisma.enrollment.updateMany({ where: { userId: userC.id, courseId: course.id }, data: { status: 'ACTIVE' } })
    await api('post', `/learn/quizzes/${quiz.id}/attempts`, tokC)
    const { rows } = await download(`/exports/quizzes/${quiz.id}/results.xlsx`)
    const c = rows.find((r) => r.Email === `stuc8${s}@test.local`)
    expect(c).toMatchObject({ Status: 'In progress', Result: '' })
  })

  it('returns 404 for unknown quizzes', async () => {
    expect((await download('/exports/quizzes/11111111-1111-4111-8111-111111111111/results.xlsx')).res.status).toBe(404)
  })
})

describe('question bank export and import', () => {
  it('serves a template with examples that imports cleanly', async () => {
    const { res, header, rows, wb } = await download('/question-template.xlsx')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('cloudart-question-template.xlsx')
    expect(header).toEqual(HEADERS)
    expect(rows).toHaveLength(3)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Questions', 'How to fill this in'])

    const target = await emptyQuiz('template import')
    const up = await upload(target, res.body)
    expect(up.status).toBe(201)
    expect(up.body.imported).toBe(3)
    const saved = (await admin('get', `/quizzes/${target}`)).body.quiz.questions
    expect(saved.map((q) => q.questionType)).toEqual(['SINGLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE'])
    expect(saved[1].marks).toBe(2)
    expect(saved[1].options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(['Amazon EC2', 'AWS Lambda'])
  })

  it('round-trips a quiz exactly: export, import into another quiz, compare', async () => {
    const source = await emptyQuiz('round trip source')
    const specs = [
      { questionText: 'Pick the storage service', questionType: 'SINGLE_CHOICE', marks: 1, explanation: 'Because S3', options: opts(['S3', true], ['EC2'], ['VPC']) },
      { questionText: '=2+2 is this a formula?', questionType: 'MULTIPLE_SELECT', marks: 2.5, explanation: '+hidden formula-looking text', options: opts(['One', true], ['Two', true], ['@Three'], ['Four']) },
      { questionText: 'The sky is blue.', questionType: 'TRUE_FALSE', marks: 1, options: opts(['True', true], ['False']) },
    ]
    for (const q of specs) expect((await admin('post', `/quizzes/${source}/questions`).send(q)).status).toBe(201)

    const exported = await download(`/quizzes/${source}/questions/export.xlsx`)
    expect(exported.res.status).toBe(200)
    expect(exported.header).toEqual(HEADERS)
    expect(exported.rows).toHaveLength(3)
    expect(exported.rows[0]).toMatchObject({ Question: 'Pick the storage service', Type: 'Single choice', Marks: '1', 'Correct options': '1', 'Option 1': 'S3', 'Option 3': 'VPC', 'Option 4': '' })
    expect(exported.rows[1]).toMatchObject({ Type: 'Multiple select', Marks: '2.5', 'Correct options': '1,2' })
    expect(exported.rows[1].Question).toBe("'=2+2 is this a formula?") // formula guard in the file
    expect(exported.rows[1]['Option 3']).toBe("'@Three")

    const target = await emptyQuiz('round trip target')
    const up = await upload(target, exported.res.body)
    expect(up.status).toBe(201)
    expect(up.body.imported).toBe(3)

    const shape = (qs) => qs.map((q) => ({ t: q.questionText, type: q.questionType, marks: q.marks, e: q.explanation, o: q.options.map((o) => [o.text, o.isCorrect]) }))
    const a = (await admin('get', `/quizzes/${source}`)).body.quiz.questions
    const b = (await admin('get', `/quizzes/${target}`)).body.quiz.questions
    expect(shape(b)).toEqual(shape(a)) // the guard apostrophes were removed again
    expect(b[1].questionText).toBe('=2+2 is this a formula?')
  })

  it('adds to existing questions rather than replacing them, keeping the order', async () => {
    const target = await emptyQuiz('append')
    await admin('post', `/quizzes/${target}/questions`).send({ questionText: 'Existing one', questionType: 'SINGLE_CHOICE', options: opts(['a', true], ['b']) })
    const buf = await sheetBuffer([['Imported one', 'Single choice', '', '2', '', 'x', 'y']])
    expect((await upload(target, buf)).status).toBe(201)
    const qs = (await admin('get', `/quizzes/${target}`)).body.quiz.questions
    expect(qs.map((q) => q.questionText)).toEqual(['Existing one', 'Imported one'])
    expect(qs.map((q) => q.sortOrder)).toEqual([0, 1])
    expect(qs[1].marks).toBe(1) // empty marks default to 1
    expect(qs[1].explanation).toBe('')
  })

  it('reads columns by their header names, in any order, and accepts friendly type names', async () => {
    const target = await emptyQuiz('shuffled columns')
    const headers = ['Option 2', 'Correct options', 'Type', 'Option 1', 'Question', 'Option 3']
    const buf = await sheetBuffer(
      [
        ['No', '1', 'single', 'Yes', 'Is column order free?', ''],
        ['B', '1;3', 'MULTIPLE_SELECT', 'A', 'Pick A and C', 'C'],
        ['False', '2', 'True / False', 'True', 'Water is wet.', ''],
      ],
      { headers },
    )
    const res = await upload(target, buf)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const qs = (await admin('get', `/quizzes/${target}`)).body.quiz.questions
    expect(qs.map((q) => q.questionType)).toEqual(['SINGLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE'])
    expect(qs[0].options.map((o) => [o.text, o.isCorrect])).toEqual([['Yes', true], ['No', false]])
    expect(qs[1].options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(['A', 'C'])
  })

  it('ignores blank rows and reads the first sheet when none is called Questions', async () => {
    const target = await emptyQuiz('blank rows')
    const buf = await sheetBuffer([['Row one here', 'single', '', '1', '', 'a', 'b'], [], [null, null], ['Row two here', 'single', '', '2', '', 'a', 'b']], { sheetName: 'Sheet1' })
    const res = await upload(target, buf)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.imported).toBe(2)
  })

  it('imports nothing and lists every bad row when any row is invalid', async () => {
    const target = await emptyQuiz('all or nothing')
    const buf = await sheetBuffer([
      ['A perfectly good question', 'single', '', '1', '', 'a', 'b'], // row 2 ok
      ['Unknown type here', 'essay', '', '1', '', 'a', 'b'], // row 3
      ['No correct answer', 'single', '', '', '', 'a', 'b'], // row 4
      ['Answer out of range', 'single', '', '3', '', 'a', 'b'], // row 5
      ['Two right for single', 'single', '', '1,2', '', 'a', 'b'], // row 6
      ['Gap in options here', 'single', '', '1', '', 'a', '', 'c'], // row 7
      ['True or false with three', 'true/false', '', '1', '', 'True', 'False', 'Maybe'], // row 8
      ['Marks are odd here', 'single', '0.3', '1', '', 'a', 'b'], // row 9
      ['Duplicate options here', 'single', '', '1', '', 'same', 'Same'], // row 10
      ['ab', 'single', '', '1', '', 'a', 'b'], // row 11 (question too short)
      ['Letters as answers', 'single', '', 'A', '', 'a', 'b'], // row 12
      ['Only one option given', 'single', '', '1', '', 'a'], // row 13
      ['Listed twice here', 'multiple', '', '1,1', '', 'a', 'b'], // row 14
    ])
    const res = await upload(target, buf)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('IMPORT_INVALID')
    expect(res.body.error.message).toBe('12 rows need fixing. Nothing was imported.')
    const rows = res.body.error.details.rows
    expect(rows.map((r) => r.row)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(rows[0].message).toMatch(/Type "essay" is not recognised/)
    expect(rows[1].message).toMatch(/which options are correct/)
    expect(rows[2].message).toMatch(/numbers from 1 to 2/)
    expect(rows[4].message).toMatch(/empty option between/)
    expect(rows[8].message).toMatch(/at least 3 characters/)
    expect(await questionCount(target)).toBe(0) // the one good row was not imported either
  })

  it('rejects unusable files with a clear message', async () => {
    const target = await emptyQuiz('bad files')
    const cases = [
      [Buffer.from('this is not a spreadsheet'), 400, /could not be read/],
      [Buffer.alloc(0), 400, /No file was uploaded/],
      [await sheetBuffer([['Q', 'single', '', '1', '', 'a', 'b']], { headers: ['Question', 'Type', 'Option 1'] }), 400, /header row is missing: correct options, option 2/],
      [await sheetBuffer([]), 400, /no questions/],
      [await sheetBuffer(Array.from({ length: 501 }, (_, i) => [`Question number ${i}`, 'single', '', '1', '', 'a', 'b'])), 400, /Too many rows/],
    ]
    for (const [buf, status, message] of cases) {
      const res = await upload(target, buf)
      expect(res.status, message.toString()).toBe(status)
      expect(res.body.error.code).toBe('INVALID_FILE')
      expect(res.body.error.message).toMatch(message)
    }
    expect(await questionCount(target)).toBe(0)
  })

  it('accepts exactly 500 questions in one import', async () => {
    const target = await emptyQuiz('five hundred')
    const buf = await sheetBuffer(Array.from({ length: 500 }, (_, i) => [`Question number ${i + 1}`, 'single', '', '1', '', 'a', 'b']))
    const res = await upload(target, buf)
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201)
    expect(await questionCount(target)).toBe(500)
  })

  it('rejects the wrong content type, an oversized body and unknown quizzes', async () => {
    const target = await emptyQuiz('transport')
    const buf = await sheetBuffer([['Valid question', 'single', '', '1', '', 'a', 'b']])
    for (const type of ['application/json', 'text/plain', 'text/csv']) {
      const res = await upload(target, buf, { type })
      expect(res.status, type).toBeGreaterThanOrEqual(400)
      expect(res.status, type).toBeLessThan(500)
    }
    expect((await upload(target, buf, { type: 'application/octet-stream' })).status).toBe(201) // some browsers send this for .xlsx
    const big = await upload(target, Buffer.alloc(3 * 1024 * 1024, 1))
    expect(big.status).toBe(413)
    expect((await upload('11111111-1111-4111-8111-111111111111', buf)).status).toBe(404)
    expect((await upload('not-a-uuid', buf)).status).toBe(404)
  })

  it('exports the question bank of an unknown quiz as 404', async () => {
    expect((await download('/quizzes/11111111-1111-4111-8111-111111111111/questions/export.xlsx')).res.status).toBe(404)
  })

  it('does not let an import touch another quiz', async () => {
    const a = await emptyQuiz('isolation a')
    const b = await emptyQuiz('isolation b')
    await upload(a, await sheetBuffer([['Only for quiz a', 'single', '', '1', '', 'x', 'y']]))
    expect(await questionCount(a)).toBe(1)
    expect(await questionCount(b)).toBe(0)
  })
})
