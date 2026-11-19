/** Wording and colours for the client service requests, shared by the client and admin screens. */

export const REQUEST_STATUS = {
  SUBMITTED: { label: 'Submitted', style: 'border-ca-cyan/40 text-ca-cyan', hint: 'We have your request and will review it soon.' },
  UNDER_REVIEW: { label: 'Under review', style: 'border-amber-400/40 text-amber-200', hint: 'The team is reviewing your request.' },
  PROPOSAL_SENT: { label: 'Proposal sent', style: 'border-ca-gold/50 text-ca-gold', hint: 'A proposal is waiting for your answer.' },
  ACCEPTED: { label: 'Accepted', style: 'border-emerald-400/40 text-emerald-300', hint: 'You accepted the proposal. The project is under way.' },
  REJECTED: { label: 'Declined', style: 'border-red-400/40 text-red-300', hint: 'We could not take this request on.' },
  CANCELLED: { label: 'Cancelled', style: 'border-white/25 text-ca-muted', hint: 'This request was cancelled.' },
}

export const PROPOSAL_STATUS = {
  DRAFT: { label: 'Draft', style: 'border-white/25 text-ca-muted' },
  SENT: { label: 'Waiting for answer', style: 'border-ca-gold/50 text-ca-gold' },
  ACCEPTED: { label: 'Accepted', style: 'border-emerald-400/40 text-emerald-300' },
  REJECTED: { label: 'Declined', style: 'border-red-400/40 text-red-300' },
  WITHDRAWN: { label: 'Withdrawn', style: 'border-white/25 text-ca-muted' },
}

export const PROJECT_STATUS = {
  PLANNED: { label: 'Planned', style: 'border-ca-cyan/40 text-ca-cyan' },
  IN_PROGRESS: { label: 'In progress', style: 'border-amber-400/40 text-amber-200' },
  ON_HOLD: { label: 'On hold', style: 'border-white/25 text-ca-muted' },
  COMPLETED: { label: 'Completed', style: 'border-emerald-400/40 text-emerald-300' },
  CANCELLED: { label: 'Cancelled', style: 'border-red-400/40 text-red-300' },
}

export const MILESTONE_STATUS = {
  PENDING: { label: 'To do', style: 'text-ca-muted' },
  IN_PROGRESS: { label: 'In progress', style: 'text-amber-200' },
  DONE: { label: 'Done', style: 'text-emerald-300' },
}

export const CLOUD_PROVIDERS = ['AWS', 'Azure', 'Google Cloud', 'Multi-cloud', 'Other']

/** A request can still be edited by its owner only before review starts. */
export const OPEN_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT']

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 10
export const FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt'
export const FILE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** "YYYY-MM-DD" for a date input, `days` from today. */
export const dateInDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** A "YYYY-MM-DD" value shown as a local date, without the time zone shifting it a day. */
export const formatDay = (value) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')
