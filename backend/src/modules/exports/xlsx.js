import ExcelJS from 'exceljs'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Text that comes from users (names, organizations, question wording) must not be able to run as a formula
 * when someone opens the file in Excel or imports it elsewhere. A leading apostrophe makes it plain text.
 */
export function safeText(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

/** "Intro to IAM / S3!" -> "intro-to-iam-s3" for file names. */
export const fileSlug = (text, fallback = 'export') =>
  String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback

export const today = () => new Date().toISOString().slice(0, 10)

/** A workbook with one sheet: a bold frozen header row, the data rows and sensible column widths. */
export function buildSheet({ sheetName, columns, rows }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CloudArt'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName)
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }))
  for (const row of rows) ws.addRow(row)
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return { wb, ws }
}

/** Streams a workbook to the client as a download. Exports contain personal data, so they are never cached. */
export async function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', XLSX_MIME)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Cache-Control', 'no-store')
  await wb.xlsx.write(res)
  res.end()
}

/** The plain text of a cell, whatever its type (rich text, formula result, number, date). */
export function cellText(cell) {
  const v = cell?.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString()
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if ('result' in v) return v.result === null || v.result === undefined ? '' : String(v.result)
    if ('text' in v) return String(v.text)
    return ''
  }
  return String(v)
}
