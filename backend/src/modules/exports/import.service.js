import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { questionProblem } from '../quizzes/quiz.rules.js'
import { QUESTION_OPTION_COLUMNS } from './export.service.js'
import { cellText } from './xlsx.js'

export const MAX_IMPORT_ROWS = 500
const MAX_REPORTED_ERRORS = 50

const invalidFile = (message) => new HttpError(400, 'INVALID_FILE', message)

/** Undoes the apostrophe the exporter adds in front of text that would otherwise look like a formula. */
const unsafeText = (text) => (/^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text)

const TYPES = new Map([
  ['singlechoice', 'SINGLE_CHOICE'],
  ['single', 'SINGLE_CHOICE'],
  ['multipleselect', 'MULTIPLE_SELECT'],
  ['multiple', 'MULTIPLE_SELECT'],
  ['multichoice', 'MULTIPLE_SELECT'],
  ['truefalse', 'TRUE_FALSE'],
])
const normalizeType = (text) => TYPES.get(text.toLowerCase().replace(/[^a-z]/g, '')) ?? null

/** Reads the spreadsheet into plain row objects. Throws INVALID_FILE for anything that is not a usable .xlsx. */
async function readRows(buffer) {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    throw invalidFile('That file could not be read. Upload an .xlsx file, such as the template.')
  }
  const ws = wb.getWorksheet('Questions') ?? wb.worksheets[0]
  if (!ws) throw invalidFile('The workbook has no sheets.')

  // Columns are found by their header names, so reordering columns in Excel is harmless.
  const columns = new Map()
  ws.getRow(1).eachCell((cell, col) => columns.set(cellText(cell).trim().toLowerCase(), col))
  const required = ['question', 'type', 'correct options', 'option 1', 'option 2']
  const missing = required.filter((h) => !columns.has(h))
  if (missing.length) throw invalidFile(`The header row is missing: ${missing.join(', ')}. Use the template.`)

  const at = (row, header) => (columns.has(header) ? unsafeText(cellText(row.getCell(columns.get(header))).trim()) : '')
  const rows = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const data = {
      rowNumber: r,
      question: at(row, 'question'),
      type: at(row, 'type'),
      marks: at(row, 'marks'),
      correct: at(row, 'correct options'),
      explanation: at(row, 'explanation'),
      options: Array.from({ length: QUESTION_OPTION_COLUMNS }, (_, i) => at(row, `option ${i + 1}`)),
    }
    const blank = !data.question && !data.type && !data.correct && !data.explanation && data.options.every((o) => !o)
    if (!blank) rows.push(data)
    if (rows.length > MAX_IMPORT_ROWS) throw invalidFile(`Too many rows. Import at most ${MAX_IMPORT_ROWS} questions at a time.`)
  }
  if (rows.length === 0) throw invalidFile('The sheet has no questions. Fill in at least one row under the header.')
  return rows
}

/** One row -> a question, or the reason it cannot be used. */
function parseRow(row) {
  if (row.question.length < 3) return { error: 'Write the question (at least 3 characters)' }
  if (row.question.length > 5000) return { error: 'The question is longer than 5000 characters' }
  const questionType = normalizeType(row.type)
  if (!questionType) return { error: `Type "${row.type}" is not recognised. Use Single choice, Multiple select or True/False` }

  let marks = 1
  if (row.marks !== '') {
    marks = Number(row.marks)
    if (!(marks >= 0.5 && marks <= 100 && Number.isInteger(marks * 2))) return { error: 'Marks must be between 0.5 and 100 in steps of 0.5' }
  }

  // Options must be contiguous: Option 3 filled while Option 2 is empty is almost certainly a typo.
  const filled = row.options.filter((o) => o !== '')
  const firstGap = row.options.findIndex((o) => o === '')
  if (firstGap !== -1 && row.options.slice(firstGap).some((o) => o !== '')) return { error: 'There is an empty option between filled ones. Fill the options in order' }
  if (filled.some((o) => o.length > 1000)) return { error: 'An option is longer than 1000 characters' }
  if (row.explanation.length > 5000) return { error: 'The explanation is longer than 5000 characters' }

  const picked = row.correct.split(/[,;\s]+/).filter(Boolean)
  if (picked.length === 0) return { error: 'Say which options are correct, e.g. 2 or 1,3' }
  const numbers = picked.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > filled.length)) {
    return { error: `Correct options must be numbers from 1 to ${filled.length} (the options you filled in)` }
  }
  if (new Set(numbers).size !== numbers.length) return { error: 'A correct option is listed twice' }

  const options = filled.map((text, i) => ({ text, isCorrect: numbers.includes(i + 1) }))
  const problem = questionProblem({ questionType, options })
  if (problem) return { error: problem }
  return { question: { questionText: row.question, questionType, marks, explanation: row.explanation || null, options } }
}

/**
 * Adds the questions in an uploaded workbook to a quiz. All or nothing: if any row is wrong nothing is
 * imported and the response lists the rows to fix.
 */
export async function importQuestions(quizId, buffer) {
  if (!(await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true } }))) throw new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found')
  if (!buffer || buffer.length === 0) throw invalidFile('No file was uploaded.')

  const rows = await readRows(buffer)
  const questions = []
  const problems = []
  for (const row of rows) {
    const parsed = parseRow(row)
    if (parsed.error) {
      if (problems.length < MAX_REPORTED_ERRORS) problems.push({ row: row.rowNumber, message: parsed.error })
    } else {
      questions.push(parsed.question)
    }
  }
  if (problems.length > 0) {
    throw new HttpError(400, 'IMPORT_INVALID', `${problems.length >= MAX_REPORTED_ERRORS ? `At least ${problems.length}` : problems.length} row${problems.length === 1 ? '' : 's'} need fixing. Nothing was imported.`, { rows: problems })
  }

  await prisma.$transaction(async (tx) => {
    const last = await tx.question.aggregate({ where: { quizId }, _max: { sortOrder: true } })
    const start = (last._max.sortOrder ?? -1) + 1
    const withIds = questions.map((q, i) => ({ ...q, id: randomUUID(), sortOrder: start + i }))
    await tx.question.createMany({
      data: withIds.map((q) => ({ id: q.id, quizId, questionText: q.questionText, questionType: q.questionType, explanation: q.explanation, marks: q.marks, sortOrder: q.sortOrder })),
    })
    await tx.questionOption.createMany({
      data: withIds.flatMap((q) => q.options.map((o, i) => ({ questionId: q.id, optionText: o.text, isCorrect: o.isCorrect, sortOrder: i }))),
    })
  })
  return { imported: questions.length }
}
