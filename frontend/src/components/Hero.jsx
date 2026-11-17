import { useRef } from 'react'
import Tower from './Tower'
import { LAMP } from '../content/lamp'
import { hero } from '../content/site'

// Deterministic dust motes (no Math.random → stable across renders / SSR)
const MOTES = Array.from({ length: 14 }, (_, i) => ({
  left: 14 + ((i * 37) % 72),
  top: 24 + ((i * 53) % 62),
  size: 2 + (i % 3),
  delay: (i % 7) * 0.6,
  dur: 5 + (i % 5),
}))

const TONE = {
  gold: 'text-ca-gold border-ca-gold/30 bg-ca-gold/10',
  cyan: 'text-ca-cyan border-ca-cyan/30 bg-ca-cyan/10',
}

export default function Hero() {
  const stageRef = useRef(null)
  const beamRef = useRef(null)

  // Beam follows the pointer directly via the DOM (no React re-render per mouse move).
  const track = (e) => {
    const stage = stageRef.current
    const beam = beamRef.current
    if (!stage || !beam || e.pointerType === 'touch') return
    const r = stage.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + (r.height * LAMP.y) / LAMP.h)
    const deg = Math.max(-55, Math.min(55, -Math.atan2(dx, Math.max(dy, 80)) * (180 / Math.PI)))
    beam.style.animation = 'none'
    beam.style.transform = `rotate(${deg}deg)`
  }
  const release = () => {
    const beam = beamRef.current
    if (!beam) return
    beam.style.animation = ''
    beam.style.transform = ''
  }

  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      onPointerMove={track}
      onPointerLeave={release}
      className="relative overflow-hidden pt-28 pb-20 lg:pt-32 lg:pb-24 min-h-[100svh] flex items-center"
      style={{ background: 'radial-gradient(ellipse 70% 60% at 70% 45%, #0F1D31 0%, #070B12 70%)' }}
    >
      {/* grid backdrop, faded at the edges */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#64D8EB 1px, transparent 1px), linear-gradient(90deg, #64D8EB 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 75%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 grid items-center gap-12 lg:gap-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {/* ── Copy ── */}
        <div className="text-center lg:text-left">
          <p className="inline-flex items-center gap-2 font-mono text-xs tracking-[0.12em] sm:tracking-[0.2em] uppercase text-ca-cyan border border-ca-cyan/25 bg-ca-cyan/5 rounded-full px-4 py-1.5 mb-6 animate-slide-up">
            <span className="w-1.5 h-1.5 rounded-full bg-ca-cyan animate-flicker" aria-hidden="true" />
            {hero.eyebrow}
          </p>

          <h1
            id="hero-title"
            className="font-display font-extrabold text-ca-text tracking-tight leading-[1.05] text-[2.6rem] sm:text-6xl xl:text-7xl animate-slide-up"
            style={{ animationDelay: '0.1s' }}
          >
            {hero.headline[0]}{' '}
            <span className="block sm:inline">{hero.headline[1]}</span>{' '}
            <span className="text-ca-gold text-glow-gold">{hero.headline[2]}</span>
          </h1>

          <p
            className="mt-6 max-w-xl mx-auto lg:mx-0 text-ca-muted text-base sm:text-lg leading-relaxed animate-slide-up"
            style={{ animationDelay: '0.2s' }}
          >
            {hero.sub}
          </p>

          <div
            className="mt-9 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start animate-slide-up"
            style={{ animationDelay: '0.3s' }}
          >
            <a
              href={hero.primary.href}
              id="hero-primary-cta"
              className="font-display font-semibold text-sm text-center px-8 py-3.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a] hover:-translate-y-0.5 transition-all duration-300 shadow-[0_8px_30px_rgba(255,200,87,0.25)]"
            >
              {hero.primary.label}
            </a>
            <a
              href={hero.secondary.href}
              className="font-display font-semibold text-sm text-center px-8 py-3.5 rounded-full border border-ca-cyan/40 text-ca-cyan hover:bg-ca-cyan/10 hover:border-ca-cyan transition-all duration-300"
            >
              {hero.secondary.label}
            </a>
          </div>

          <ul
            className="mt-10 flex flex-wrap gap-x-6 gap-y-2 justify-center lg:justify-start font-mono text-xs text-ca-muted animate-slide-up"
            style={{ animationDelay: '0.4s' }}
          >
            {hero.pillars.map(p => (
              <li key={p} className="flex items-center gap-2">
                <span className="text-ca-gold" aria-hidden="true">✦</span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Tower stage ── */}
        <div className="relative mx-auto w-full max-w-[22rem] sm:max-w-md lg:max-w-none">
          <div
            ref={stageRef}
            className="relative mx-auto w-full max-w-md aspect-[260/340] rounded-3xl overflow-hidden border border-ca-gold/10 animate-fade-in"
            style={{
              background: 'radial-gradient(ellipse at 50% 20%, rgba(255,200,87,0.10), rgba(16,26,41,0.6) 55%)',
              boxShadow: '0 0 80px rgba(255,200,87,0.07), inset 0 0 60px rgba(7,11,18,0.8)',
            }}
          >
            {/* sweeping beam (hidden from assistive tech, motion-safe via global rule) */}
            <div
              ref={beamRef}
              aria-hidden="true"
              className="beam absolute pointer-events-none"
              style={{
                left: '-35%',
                width: '170%',
                top: `${(LAMP.y / LAMP.h) * 100}%`,
                height: '95%',
                transformOrigin: '50% 0%',
                clipPath: 'polygon(47% 0, 53% 0, 100% 100%, 0 100%)',
                background: 'linear-gradient(180deg, rgba(255,200,87,0.55) 0%, rgba(255,200,87,0.12) 55%, rgba(255,200,87,0) 100%)',
                transition: 'transform 0.2s ease-out',
              }}
            />

            {MOTES.map((m, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="absolute rounded-full bg-ca-gold/60 animate-float pointer-events-none"
                style={{ left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` }}
              />
            ))}

            <Tower />

            {hero.nodes.map(n => (
              <span
                key={n.label}
                className={`absolute font-mono text-[11px] px-3 py-1 rounded-full border backdrop-blur-sm ${n.pos} ${TONE[n.tone]}`}
              >
                {n.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* scroll cue */}
      <a
        href="#services"
        aria-label="Scroll to services"
        className="hidden lg:flex absolute bottom-6 left-1/2 -translate-x-1/2 flex-col items-center gap-2 font-mono text-[10px] text-ca-muted/60 hover:text-ca-gold transition-colors"
      >
        scroll
        <span className="w-px h-8 bg-gradient-to-b from-ca-gold/50 to-transparent animate-float" />
      </a>
    </section>
  )
}
