export const pretty = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '')

/** 5400 -> "1 h 30 min", 2700 -> "45 min", 0 -> "" */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return ''
  const totalMin = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h && m) return `${h} h ${m} min`
  return h ? `${h} h` : `${m} min`
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
