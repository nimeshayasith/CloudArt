import { detectImageType } from '../subscriptions/pricing.js'

// ───────────────────────────── request status ─────────────────────────────

/** A request is "open" while the client can still change their mind and the admin can still work on it. */
export const OPEN_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT']
/** Nobody writes to a declined or cancelled request any more. Accepted ones stay active: they became a project. */
export const CLOSED_STATUSES = ['REJECTED', 'CANCELLED']

/**
 * Every allowed move of a request, whoever makes it. Accepting happens only through the client accepting a proposal,
 * and PROPOSAL_SENT only through the admin sending one, so neither has an endpoint of its own.
 */
export const REQUEST_TRANSITIONS = {
  SUBMITTED: ['UNDER_REVIEW', 'PROPOSAL_SENT', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['PROPOSAL_SENT', 'REJECTED', 'CANCELLED'],
  PROPOSAL_SENT: ['ACCEPTED', 'UNDER_REVIEW', 'REJECTED', 'CANCELLED'],
  ACCEPTED: [],
  REJECTED: [],
  CANCELLED: [],
}
export const canMoveRequest = (from, to) => REQUEST_TRANSITIONS[from]?.includes(to) ?? false

// ───────────────────────────── project status ─────────────────────────────

export const PROJECT_TRANSITIONS = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}
export const canMoveProject = (from, to) => PROJECT_TRANSITIONS[from]?.includes(to) ?? false
export const PROJECT_FINISHED = ['COMPLETED', 'CANCELLED']

/** { done, total, percent } for a project's milestones. */
export function milestoneProgress(milestones) {
  const total = milestones.length
  const done = milestones.filter((m) => m.status === 'DONE').length
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}

// ───────────────────────────── conversation ─────────────────────────────

/** True when the other side wrote something the viewer has not opened yet. */
export function hasUnread(lastOtherMessageAt, mySeenAt) {
  if (!lastOtherMessageAt) return false
  return !mySeenAt || lastOtherMessageAt > mySeenAt
}

// ───────────────────────────── attachments ─────────────────────────────

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

export const ATTACHMENT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}
export const ATTACHMENT_MIME_TYPES = Object.values(ATTACHMENT_MIME)

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04])

function isPlainText(buffer) {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * The file type decided from the bytes, never from the file name or the header the client sent:
 * "pdf" | "png" | "jpg" | "webp" | "docx" | "xlsx" | "txt", or null for anything else (executables, scripts, archives).
 * Word and Excel files are zip containers, so they must also hold their own marker part.
 */
export function detectAttachmentType(buffer) {
  if (!buffer || buffer.length === 0) return null
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  const image = detectImageType(buffer)
  if (image) return image
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP)) {
    if (buffer.includes('word/document.xml')) return 'docx'
    if (buffer.includes('xl/workbook.xml')) return 'xlsx'
    return null
  }
  return isPlainText(buffer) ? 'txt' : null
}

/**
 * A file name that is safe to store, show and send in a download header: no folders, no control or reserved
 * characters, bounded length, and always ending in the extension the bytes proved the file to be.
 */
export function cleanFileName(name, ext) {
  let base = String(name ?? '')
    .replace(/^.*[\\/]/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>:|?*\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
  if (!base) base = 'file'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

/** Content-Disposition for a download: ASCII fallback plus the real name encoded per RFC 5987. */
export function attachmentDisposition(fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
