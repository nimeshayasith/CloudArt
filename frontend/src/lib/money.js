/** "19.99", "USD" -> "$19.99". Unknown currency codes fall back to "19.99 XYZ" instead of throwing. */
export function formatMoney(amount, currency) {
  const value = Number(amount)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')

export const formatDays = (days) => (days % 365 === 0 ? `${days / 365} year${days === 365 ? '' : 's'}` : days % 30 === 0 ? `${days / 30} month${days === 30 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`)
