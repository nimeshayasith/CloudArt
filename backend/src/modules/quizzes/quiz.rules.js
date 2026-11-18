import { randomInt } from 'node:crypto'

export const QUESTION_TYPES = ['SINGLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE']
export const MAX_OPTIONS = 8

/**
 * Why a question cannot be used, or null when it is well formed.
 *  - TRUE_FALSE: exactly two options, one correct
 *  - SINGLE_CHOICE: 2-8 options, exactly one correct
 *  - MULTIPLE_SELECT: 2-8 options, at least one correct
 */
export function questionProblem({ questionType, options }) {
  if (!QUESTION_TYPES.includes(questionType)) return 'Choose a valid question type'
  if (!Array.isArray(options) || options.length < 2) return 'Add at least two options'
  if (options.length > MAX_OPTIONS) return `Use at most ${MAX_OPTIONS} options`
  if (options.some((o) => !String(o.text ?? '').trim())) return 'Every option needs text'
  const texts = options.map((o) => String(o.text).trim().toLowerCase())
  if (new Set(texts).size !== texts.length) return 'Options must be different from each other'
  const correct = options.filter((o) => o.isCorrect).length
  if (questionType === 'TRUE_FALSE' && options.length !== 2) return 'True/False questions have exactly two options'
  if (questionType !== 'MULTIPLE_SELECT' && correct !== 1) return 'Mark exactly one option as correct'
  if (questionType === 'MULTIPLE_SELECT' && correct < 1) return 'Mark at least one option as correct'
  return null
}

/** Multi-select is all-or-nothing: the selection must equal the correct set exactly. */
export function isCorrectAnswer(selectedIds, correctIds) {
  const selected = new Set(selectedIds)
  const correct = new Set(correctIds)
  if (selected.size !== correct.size) return false
  for (const id of correct) if (!selected.has(id)) return false
  return true
}

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Grades an attempt.
 * @param questions [{ id, marks, correctOptionIds }]
 * @param answers Map<questionId, selectedOptionIds[]>
 * @returns per-question awarded marks plus the totals
 */
export function gradeAttempt(questions, answers, passPercentage) {
  let score = 0
  let total = 0
  const perQuestion = questions.map((q) => {
    const marks = Number(q.marks)
    const awarded = isCorrectAnswer(answers.get(q.id) ?? [], q.correctOptionIds) ? marks : 0
    score += awarded
    total += marks
    return { questionId: q.id, awardedMarks: awarded }
  })
  const percentage = total > 0 ? round2((score / total) * 100) : 0
  return { score: round2(score), total: round2(total), percentage, passed: percentage >= Number(passPercentage), perQuestion }
}

/** Fisher-Yates with a cryptographic RNG, so the draw cannot be predicted. */
export function shuffled(items) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Questions for one attempt: a random draw when shuffling, otherwise the first N in the admin's order. */
export function drawQuestions(pool, count, shuffle) {
  const n = Math.min(count, pool.length)
  return (shuffle ? shuffled(pool) : pool).slice(0, n)
}
