import { Link } from 'react-router-dom'

/** Shown where Premium content is locked for the signed-in student. */
export default function UpgradePanel({ title = 'This is Premium content', message = 'Subscribe to a plan to unlock it.' }) {
  return (
    <div role="region" aria-label="Premium content" data-testid="upgrade-panel" className="rounded-2xl border border-ca-gold/40 bg-ca-gold/5 p-5 sm:p-6">
      <p className="font-display font-semibold text-ca-text"><span aria-hidden="true">🔒</span> {title}</p>
      <p className="mt-1 text-sm text-ca-muted">{message}</p>
      <Link to="/pricing" className="mt-4 inline-block rounded-full bg-ca-gold text-ca-bg px-5 py-2 text-sm font-medium hover:bg-[#ffd47a]">See plans</Link>
    </div>
  )
}

/** A small "Premium" tag for lists and cards. */
export function PremiumBadge({ className = '' }) {
  return <span className={`inline-flex items-center gap-1 border border-ca-gold/40 text-ca-gold rounded-full px-2 py-0.5 text-xs ${className}`}><span aria-hidden="true">★</span>Premium</span>
}
