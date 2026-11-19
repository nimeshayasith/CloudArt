import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { buildSheet, fileSlug, safeText, today } from './xlsx.js'

const TYPE_LABEL = { SINGLE_CHOICE: 'Single choice', MULTIPLE_SELECT: 'Multiple select', TRUE_FALSE: 'True/False' }
const date = (d) => (d ? d.toISOString().slice(0, 10) : '')
const dateTime = (d) => (d ? d.toISOString().replace('T', ' ').slice(0, 19) : '')
const num = (d) => (d === null || d === undefined ? null : Number(d))

// ───────────────────────────── users ─────────────────────────────

export async function usersWorkbook() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      fullName: true,
      username: true,
      email: true,
      professionalCategory: true,
      systemRole: true,
      isActive: true,
      createdAt: true,
      organization: { select: { name: true } },
      _count: { select: { enrollments: true } },
    },
  })
  const { wb } = buildSheet({
    sheetName: 'Users',
    columns: [
      { header: 'Full name', key: 'fullName', width: 26 },
      { header: 'Username', key: 'username', width: 18 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Organization', key: 'organization', width: 28 },
      { header: 'Role category', key: 'category', width: 22 },
      { header: 'Account type', key: 'role', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Courses enrolled', key: 'courses', width: 16 },
      { header: 'Joined', key: 'joined', width: 14 },
    ],
    rows: users.map((u) => ({
      fullName: safeText(u.fullName),
      username: safeText(u.username),
      email: safeText(u.email),
      organization: safeText(u.organization?.name),
      category: u.professionalCategory.replaceAll('_', ' ').toLowerCase(),
      role: u.systemRole === 'ADMIN' ? 'Admin' : 'Student',
      status: u.isActive ? 'Active' : 'Disabled',
      courses: u._count.enrollments,
      joined: date(u.createdAt),
    })),
  })
  return { wb, filename: `cloudart-users-${today()}.xlsx` }
}

// ───────────────────────────── course progress ─────────────────────────────

export async function courseProgressWorkbook(courseId) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, slug: true } })
  if (!course) throw new HttpError(404, 'COURSE_NOT_FOUND', 'Course not found')

  const [lessons, quizzes, enrollments] = await Promise.all([
    prisma.lesson.findMany({ where: { isPublished: true, module: { courseId, isPublished: true } }, select: { id: true } }),
    prisma.quiz.findMany({ where: { courseId, status: { in: ['PUBLISHED', 'ARCHIVED'] } }, orderBy: [{ quizType: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, quizType: true } }),
    prisma.enrollment.findMany({
      where: { courseId },
      orderBy: { enrolledAt: 'asc' },
      select: { id: true, status: true, enrolledAt: true, user: { select: { fullName: true, username: true, email: true, organization: { select: { name: true } } } } },
    }),
  ])
  const lessonIds = lessons.map((l) => l.id)
  const enrollmentIds = enrollments.map((e) => e.id)

  const [done, activity, attempts] = await Promise.all([
    prisma.lessonProgress.groupBy({ by: ['enrollmentId'], where: { enrollmentId: { in: enrollmentIds }, completed: true, lessonId: { in: lessonIds } }, _count: { _all: true } }),
    prisma.lessonProgress.groupBy({ by: ['enrollmentId'], where: { enrollmentId: { in: enrollmentIds } }, _max: { lastWatchedAt: true } }),
    prisma.quizAttempt.findMany({ where: { enrollmentId: { in: enrollmentIds }, status: { not: 'IN_PROGRESS' }, quiz: { courseId } }, select: { enrollmentId: true, quizId: true, percentage: true, passed: true } }),
  ])
  const doneBy = new Map(done.map((d) => [d.enrollmentId, d._count._all]))
  const activityBy = new Map(activity.map((a) => [a.enrollmentId, a._max.lastWatchedAt]))
  const best = new Map() // `${enrollmentId}:${quizId}` -> { percentage, passed }
  for (const a of attempts) {
    const key = `${a.enrollmentId}:${a.quizId}`
    const cur = best.get(key) ?? { percentage: null, passed: false, count: 0 }
    cur.count += 1
    cur.percentage = Math.max(cur.percentage ?? 0, num(a.percentage) ?? 0)
    cur.passed = cur.passed || a.passed === true
    best.set(key, cur)
  }

  const quizColumns = quizzes.map((q, i) => ({ header: `${q.quizType === 'FINAL_EXAM' ? 'Final exam' : 'Quiz'}: ${safeText(q.title)} (best %)`, key: `quiz${i}`, width: 24 }))
  const rows = enrollments.map((e) => {
    const completed = doneBy.get(e.id) ?? 0
    const row = {
      fullName: safeText(e.user.fullName),
      username: safeText(e.user.username),
      email: safeText(e.user.email),
      organization: safeText(e.user.organization?.name),
      enrolled: date(e.enrolledAt),
      status: e.status === 'ACTIVE' ? 'In progress' : e.status === 'COMPLETED' ? 'Completed' : 'Left course',
      completedLessons: completed,
      totalLessons: lessonIds.length,
      percent: lessonIds.length ? Math.round((completed / lessonIds.length) * 100) : 0,
      lastActivity: dateTime(activityBy.get(e.id)),
    }
    quizzes.forEach((q, i) => {
      const b = best.get(`${e.id}:${q.id}`)
      row[`quiz${i}`] = b ? `${b.percentage}%${b.passed ? ' (passed)' : ''}` : ''
    })
    return row
  })

  const { wb } = buildSheet({
    sheetName: 'Student progress',
    columns: [
      { header: 'Full name', key: 'fullName', width: 26 },
      { header: 'Username', key: 'username', width: 18 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Organization', key: 'organization', width: 28 },
      { header: 'Enrolled', key: 'enrolled', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Lessons completed', key: 'completedLessons', width: 18 },
      { header: 'Total lessons', key: 'totalLessons', width: 14 },
      { header: 'Progress %', key: 'percent', width: 12 },
      { header: 'Last activity', key: 'lastActivity', width: 20 },
      ...quizColumns,
    ],
    rows,
  })
  return { wb, filename: `cloudart-progress-${fileSlug(course.slug, 'course')}-${today()}.xlsx` }
}

// ───────────────────────────── quiz results ─────────────────────────────

export async function quizResultsWorkbook(quizId) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true, title: true } })
  if (!quiz) throw new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found')
  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId },
    orderBy: [{ startedAt: 'desc' }],
    include: { enrollment: { select: { user: { select: { fullName: true, username: true, email: true } } } } },
  })
  const { wb } = buildSheet({
    sheetName: 'Results',
    columns: [
      { header: 'Full name', key: 'fullName', width: 26 },
      { header: 'Username', key: 'username', width: 18 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Attempt', key: 'attempt', width: 10 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Started', key: 'started', width: 20 },
      { header: 'Submitted', key: 'submitted', width: 20 },
      { header: 'Score (marks)', key: 'score', width: 14 },
      { header: 'Percentage', key: 'percentage', width: 12 },
      { header: 'Result', key: 'result', width: 14 },
    ],
    rows: attempts.map((a) => ({
      fullName: safeText(a.enrollment.user.fullName),
      username: safeText(a.enrollment.user.username),
      email: safeText(a.enrollment.user.email),
      attempt: a.attemptNumber,
      status: a.status === 'IN_PROGRESS' ? 'In progress' : a.status === 'EXPIRED' ? 'Time ran out' : 'Submitted',
      started: dateTime(a.startedAt),
      submitted: dateTime(a.submittedAt),
      score: num(a.score),
      percentage: num(a.percentage),
      result: a.status === 'IN_PROGRESS' ? '' : a.passed ? 'Passed' : 'Not passed',
    })),
  })
  return { wb, filename: `cloudart-results-${fileSlug(quiz.title, 'quiz')}-${today()}.xlsx` }
}

// ───────────────────────────── question bank ─────────────────────────────

export const QUESTION_OPTION_COLUMNS = 8

export const questionColumns = () => [
  { header: 'Question', key: 'question', width: 60 },
  { header: 'Type', key: 'type', width: 18 },
  { header: 'Marks', key: 'marks', width: 8 },
  { header: 'Correct options', key: 'correct', width: 16 },
  { header: 'Explanation', key: 'explanation', width: 40 },
  ...Array.from({ length: QUESTION_OPTION_COLUMNS }, (_, i) => ({ header: `Option ${i + 1}`, key: `o${i + 1}`, width: 24 })),
]

function questionRow(q) {
  const row = {
    question: safeText(q.questionText),
    type: TYPE_LABEL[q.questionType],
    marks: Number(q.marks),
    correct: q.options.flatMap((o, i) => (o.isCorrect ? [i + 1] : [])).join(','),
    explanation: safeText(q.explanation),
  }
  q.options.forEach((o, i) => { row[`o${i + 1}`] = safeText(o.optionText) })
  return row
}

/** The quiz's questions in the same layout the importer reads, so an export can be edited and re-imported. */
export async function questionBankWorkbook(quizId) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, title: true, questions: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } } },
  })
  if (!quiz) throw new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found')
  const { wb } = buildSheet({ sheetName: 'Questions', columns: questionColumns(), rows: quiz.questions.map(questionRow) })
  return { wb, filename: `cloudart-questions-${fileSlug(quiz.title, 'quiz')}-${today()}.xlsx` }
}

/** A blank sheet with two worked examples and an instructions sheet. */
export function questionTemplateWorkbook() {
  const examples = [
    { question: 'Which AWS service stores objects?', type: 'Single choice', marks: 1, correct: '1', explanation: 'S3 is object storage.', o1: 'Amazon S3', o2: 'Amazon EC2', o3: 'Amazon VPC' },
    { question: 'Which of these are compute services?', type: 'Multiple select', marks: 2, correct: '1,2', explanation: 'EC2 and Lambda both run code.', o1: 'Amazon EC2', o2: 'AWS Lambda', o3: 'Amazon S3 Glacier', o4: 'Amazon Route 53' },
    { question: 'Amazon S3 is a block storage service.', type: 'True/False', marks: 1, correct: '2', explanation: 'S3 is object storage.', o1: 'True', o2: 'False' },
  ]
  const { wb } = buildSheet({ sheetName: 'Questions', columns: questionColumns(), rows: examples })
  const help = wb.addWorksheet('How to fill this in')
  help.columns = [{ width: 110 }]
  for (const line of [
    'One question per row. Keep the header row exactly as it is. Delete the example rows before you start, or keep them as questions.',
    'Type: Single choice, Multiple select or True/False.',
    'Marks: 0.5 to 100 in steps of 0.5. Leave empty for 1.',
    'Correct options: the NUMBERS of the correct options, separated by commas. Example: 2 or 1,3. Single choice and True/False need exactly one.',
    'Options: fill Option 1, Option 2, ... in order with no gaps (2 to 8 options). True/False questions use exactly two options.',
    'Explanation is optional. For module quizzes it is shown to students after they submit. It is never shown for the final exam.',
    'Importing ADDS the questions to the quiz. If any row has a problem nothing is imported, and you get a list of the rows to fix.',
    'At most 500 rows and 2 MB per file.',
  ]) help.addRow([line])
  return { wb, filename: 'cloudart-question-template.xlsx' }
}
