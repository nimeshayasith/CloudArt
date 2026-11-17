import { STATUS_STYLE } from '../lib/courseConstants'
import { pretty } from '../lib/format'

export default function StatusBadge({ status }) {
  return <span className={`border rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT}`}>{pretty(status)}</span>
}
