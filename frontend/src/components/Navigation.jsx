import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { brand, nav } from '../content/site'

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const solid = scrolled || open

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
        solid ? 'bg-ca-bg/90 backdrop-blur-md border-b border-white/5 py-3' : 'bg-transparent py-5'
      }`}
    >
      <nav aria-label="Main navigation" className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <a href="#hero" className="font-display font-bold text-xl tracking-tight text-ca-text" aria-label={`${brand.name} — back to top`}>
          Cloud<span className="text-ca-gold">Art</span>
        </a>

        <div className="hidden md:flex items-center gap-8 font-mono text-sm text-ca-muted">
          {nav.map(l => (
            <a key={l.href} href={l.href} className="hover:text-ca-gold transition-colors">{l.label}</a>
          ))}
          <Link to="/login" className="hover:text-ca-gold transition-colors">Log in</Link>
          <Link
            to="/register"
            className="bg-ca-gold text-ca-bg px-4 py-1.5 rounded-full hover:bg-[#ffd47a] transition-all font-medium"
          >
            Sign up
          </Link>
        </div>

        <button
          type="button"
          className="md:hidden p-2 -mr-2 text-ca-text"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen(o => !o)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="md:hidden px-6 pt-4 pb-6 flex flex-col gap-1 font-display text-lg">
          {[...nav, { label: 'Contact', href: '#contact' }].map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="py-3 text-ca-text border-b border-white/5 hover:text-ca-gold">
              {l.label}
            </a>
          ))}
          <Link to="/login" className="py-3 text-ca-text border-b border-white/5 hover:text-ca-gold">Log in</Link>
          <Link to="/register" className="mt-4 text-center font-semibold py-3 rounded-full bg-ca-gold text-ca-bg">Sign up</Link>
        </div>
      )}
    </header>
  )
}
