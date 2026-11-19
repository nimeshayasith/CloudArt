import express, { Router } from 'express'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import * as exports_ from './export.service.js'
import { importQuestions } from './import.service.js'
import { XLSX_MIME, sendWorkbook } from './xlsx.js'

// Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
export const exportRouter = Router()

const course = idParam('COURSE_NOT_FOUND', 'Course not found')
const quiz = idParam('QUIZ_NOT_FOUND', 'Quiz not found')

const download = (build) => handle(async (req, res) => {
  const { wb, filename } = await build(req)
  await sendWorkbook(res, wb, filename)
})

exportRouter.get('/exports/users.xlsx', download(() => exports_.usersWorkbook()))
exportRouter.get('/exports/courses/:id/progress.xlsx', course, download((req) => exports_.courseProgressWorkbook(req.params.id)))
exportRouter.get('/exports/quizzes/:id/results.xlsx', quiz, download((req) => exports_.quizResultsWorkbook(req.params.id)))
exportRouter.get('/quizzes/:id/questions/export.xlsx', quiz, download((req) => exports_.questionBankWorkbook(req.params.id)))
exportRouter.get('/question-template.xlsx', download(async () => exports_.questionTemplateWorkbook()))

// The spreadsheet is sent as the raw request body (no multipart parser needed). 2 MB is plenty for 500 questions.
const rawFile = express.raw({ type: () => true, limit: '2mb' })

exportRouter.post('/quizzes/:id/questions/import', quiz, rawFile, handle(async (req, res) => {
  if (!req.is(XLSX_MIME) && !req.is('application/octet-stream')) {
    throw new HttpError(415, 'INVALID_FILE', 'Upload an .xlsx file (Excel workbook).')
  }
  res.status(201).json(await importQuestions(req.params.id, Buffer.isBuffer(req.body) ? req.body : null))
}))
