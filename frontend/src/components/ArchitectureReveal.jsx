import { useState } from 'react'

/* ──────────────────────────────────────────────────────────
   Architecture data — three tiers
─────────────────────────────────────────────────────────── */
const COMPONENTS = {
  frontend: {
    id: 'frontend',
    label: 'Frontend',
    sketchColor: '#E8C07D',
    techColor: '#64D8EB',
    sketchDesc: 'React UI · Vite · Tailwind CSS',
    techTitle: 'Presentation Layer',
    techDesc: 'React SPA served via CloudFront CDN. Handles routing, state management, and REST calls to the API layer. Deployed to S3 + CloudFront for global edge distribution.',
    services: ['React', 'Vite', 'CloudFront', 'S3', 'Route 53'],
    x: 130, y: 60,
    sketchX: 60, sketchY: 50,
  },
  backend: {
    id: 'backend',
    label: 'Backend / API',
    sketchColor: '#A8C89D',
    techColor: '#FFC857',
    sketchDesc: 'Node.js · Express · REST API',
    techTitle: 'Application Layer',
    techDesc: 'Node.js / Express REST API running on ECS Fargate inside a private VPC subnet. ALB routes traffic with health checks. Secrets stored in AWS Secrets Manager.',
    services: ['ECS Fargate', 'ALB', 'Secrets Manager', 'VPC', 'Express'],
    x: 130, y: 160,
    sketchX: 60, sketchY: 155,
  },
  database: {
    id: 'database',
    label: 'Database',
    sketchColor: '#9DAEC8',
    techColor: '#FF9900',
    sketchDesc: 'PostgreSQL · RDS · Data layer',
    techTitle: 'Data Layer',
    techDesc: 'Amazon RDS (PostgreSQL) in a private subnet with Multi-AZ standby. Accessed only from the API layer. Automated snapshots and parameter group hardening.',
    services: ['RDS PostgreSQL', 'Multi-AZ', 'Parameter Groups', 'CloudWatch', 'IAM'],
    x: 130, y: 260,
    sketchX: 60, sketchY: 255,
  },
}

/* ──────────────────────────────────────────────────────────
   SketchDiagram — hand-drawn pencil-style SVG
─────────────────────────────────────────────────────────── */
function SketchDiagram({ activeId, onSelect }) {
  const [hovered, setHovered] = useState(null)

  const boxW = 140, boxH = 40

  const sketch = (comp) => {
    const isActive  = activeId === comp.id
    const isHovered = hovered === comp.id
    const show      = isActive || isHovered

    return (
      <g
        key={comp.id}
        tabIndex={0}
        role="button"
        aria-label={`Select ${comp.label} to reveal architecture`}
        aria-pressed={isActive}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(comp.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(comp.id) }}
        onMouseEnter={() => setHovered(comp.id)}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Sketch box — slightly wobbly */}
        <path
          d={`M ${comp.sketchX - 2} ${comp.sketchY + 1}
              Q ${comp.sketchX + boxW/2} ${comp.sketchY - 2}
                ${comp.sketchX + boxW + 2} ${comp.sketchY + 1}
              Q ${comp.sketchX + boxW + 1} ${comp.sketchY + boxH/2}
                ${comp.sketchX + boxW + 2} ${comp.sketchY + boxH - 1}
              Q ${comp.sketchX + boxW/2} ${comp.sketchY + boxH + 2}
                ${comp.sketchX - 2} ${comp.sketchY + boxH - 1}
              Q ${comp.sketchX - 1} ${comp.sketchY + boxH/2}
                ${comp.sketchX - 2} ${comp.sketchY + 1} Z`}
          fill={`${comp.sketchColor}15`}
          stroke={comp.sketchColor}
          strokeWidth={show ? '1.8' : '1.2'}
          strokeLinecap="round"
          style={{ transition: 'all 0.3s ease' }}
        />
        {/* Label */}
        <text
          x={comp.sketchX + boxW / 2}
          y={comp.sketchY + 16}
          textAnchor="middle"
          fill={comp.sketchColor}
          fontSize="11"
          fontFamily="'JetBrains Mono', monospace"
          fontWeight={show ? '600' : '400'}
          style={{ transition: 'all 0.3s ease' }}
        >
          {comp.label}
        </text>
        {/* Sub-label */}
        <text
          x={comp.sketchX + boxW / 2}
          y={comp.sketchY + 30}
          textAnchor="middle"
          fill={comp.sketchColor}
          fontSize="7.5"
          fontFamily="'JetBrains Mono', monospace"
          fillOpacity="0.7"
        >
          {comp.sketchDesc}
        </text>
        {/* Hover glow */}
        {show && (
          <rect
            x={comp.sketchX - 4}
            y={comp.sketchY - 4}
            width={boxW + 8}
            height={boxH + 8}
            rx="4"
            fill="none"
            stroke={comp.techColor}
            strokeWidth="0.8"
            strokeOpacity="0.5"
            strokeDasharray="4 3"
          >
            <animate attributeName="stroke-dashoffset" values="0;14" dur="1s" repeatCount="indefinite"/>
          </rect>
        )}
      </g>
    )
  }

  return (
    <svg viewBox="0 0 260 330" fill="none" className="w-full h-full" aria-label="Three-tier architecture sketch">
      {/* ── Construction lines (faint) ── */}
      <line x1="130" y1="0" x2="130" y2="330" stroke="#A6B2C3" strokeWidth="0.3" strokeOpacity="0.1" strokeDasharray="6 4"/>
      <line x1="0" y1="165" x2="260" y2="165" stroke="#A6B2C3" strokeWidth="0.3" strokeOpacity="0.1" strokeDasharray="6 4"/>

      {/* ── Hand-drawn arrows ── */}
      {/* Frontend → Backend */}
      <path
        d="M 130 91 Q 125 115 130 120"
        stroke="#E8C07D"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        strokeOpacity="0.6"
        strokeDasharray="3 2"
      />
      <polygon points="127,120 133,120 130,128" fill="#E8C07D" fillOpacity="0.6"/>
      {/* Annotation */}
      <text x="142" y="112" fontSize="7" fill="#A6B2C3" fillOpacity="0.7" fontFamily="'JetBrains Mono',monospace">REST</text>

      {/* Backend → Database */}
      <path
        d="M 128 200 Q 122 225 130 220"
        stroke="#A8C89D"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        strokeOpacity="0.6"
        strokeDasharray="3 2"
      />
      <polygon points="127,220 133,220 130,228" fill="#A8C89D" fillOpacity="0.6"/>
      <text x="143" y="217" fontSize="7" fill="#A6B2C3" fillOpacity="0.7" fontFamily="'JetBrains Mono',monospace">SQL</text>

      {/* ── Pencil texture lines (hatching) ── */}
      {[52,56,60,64,68].map(y => (
        <line key={`ht${y}`} x1="62" y1={y} x2="200" y2={y} stroke="#E8C07D" strokeWidth="0.3" strokeOpacity="0.06"/>
      ))}
      {[157,161,165,169,173].map(y => (
        <line key={`hm${y}`} x1="62" y1={y} x2="200" y2={y} stroke="#A8C89D" strokeWidth="0.3" strokeOpacity="0.06"/>
      ))}
      {[257,261,265,269,273].map(y => (
        <line key={`hb${y}`} x1="62" y1={y} x2="200" y2={y} stroke="#9DAEC8" strokeWidth="0.3" strokeOpacity="0.06"/>
      ))}

      {/* ── Component boxes ── */}
      {Object.values(COMPONENTS).map(sketch)}

      {/* ── Corner sketch marks ── */}
      {[[10,10],[250,10],[10,320],[250,320]].map(([x,y], i) => (
        <g key={i} stroke="#A6B2C3" strokeWidth="0.6" strokeOpacity="0.2">
          <line x1={x} y1={y} x2={x + (x < 130 ? 8 : -8)} y2={y}/>
          <line x1={x} y1={y} x2={x} y2={y + (y < 165 ? 8 : -8)}/>
        </g>
      ))}

      {/* ── "Sketch" paper texture label ── */}
      <text x="130" y="16" textAnchor="middle" fontSize="6.5" fill="#A6B2C3" fillOpacity="0.35" fontFamily="'JetBrains Mono',monospace">
        Three-Tier Application — Draft v1
      </text>
    </svg>
  )
}

/* ──────────────────────────────────────────────────────────
   TechPanel — detail panel for the selected component
─────────────────────────────────────────────────────────── */
function TechPanel({ comp, onClose }) {
  if (!comp) return null

  return (
    <div
      className="rounded-2xl border p-6 transition-all duration-500 glass"
      style={{ borderColor: `${comp.techColor}40` }}
      role="dialog"
      aria-label={`${comp.techTitle} architecture details`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <p className="font-mono text-xs mb-1" style={{ color: comp.techColor }}>
            ▶ {comp.label.toUpperCase()}
          </p>
          <h3 className="font-display font-bold text-xl text-ca-text">{comp.techTitle}</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Close architecture panel"
          className="text-ca-muted hover:text-ca-text transition-colors text-lg flex-shrink-0"
        >
          ✕
        </button>
      </div>

      {/* Description */}
      <p className="text-ca-muted text-sm leading-relaxed mb-5">{comp.techDesc}</p>

      {/* Services */}
      <div>
        <p className="font-mono text-xs text-ca-muted/60 mb-2 uppercase tracking-widest">Services & Technologies</p>
        <div className="flex flex-wrap gap-2">
          {comp.services.map(s => (
            <span
              key={s}
              className="font-mono text-xs px-3 py-1 rounded-full border"
              style={{ color: comp.techColor, borderColor: `${comp.techColor}35`, backgroundColor: `${comp.techColor}10` }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Architecture connector visual */}
      <div className="mt-5 pt-4 border-t border-white/5">
        <svg viewBox="0 0 280 50" fill="none" className="w-full" aria-hidden="true">
          {/* Simple flow: Source → Transform → Destination */}
          {['Request', comp.label, 'Response'].map((label, i) => (
            <g key={label}>
              <rect x={i * 96 + 2} y="10" width="80" height="28" rx="4"
                fill={`${comp.techColor}12`}
                stroke={comp.techColor}
                strokeWidth="0.7"
                strokeOpacity="0.5"
              />
              <text x={i * 96 + 42} y="28" textAnchor="middle"
                fontSize="8" fill={comp.techColor} fillOpacity="0.85"
                fontFamily="'JetBrains Mono',monospace"
              >
                {label}
              </text>
              {i < 2 && (
                <line x1={i * 96 + 84} y1="24" x2={i * 96 + 100} y2="24"
                  stroke={comp.techColor} strokeWidth="0.8" strokeOpacity="0.5"/>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────
   ArchitectureReveal — main exported section
─────────────────────────────────────────────────────────── */
export default function ArchitectureReveal() {
  const [activeId, setActiveId] = useState(null)

  const handleSelect = (id) => setActiveId(prev => prev === id ? null : id)
  const activeComp = activeId ? COMPONENTS[activeId] : null

  return (
    <section
      id="architecture"
      aria-label="Signature architecture reveal"
      className="relative py-28 px-6 overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #070B12 0%, #0A1220 50%, #070B12 100%)' }}
    >
      {/* Background decoration */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'radial-gradient(circle at 30% 60%, rgba(100,216,235,0.06) 0%, transparent 60%), radial-gradient(circle at 70% 30%, rgba(255,200,87,0.06) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      {/* Section header */}
      <div className="max-w-4xl mx-auto text-center mb-16">
        <p className="font-mono text-xs text-ca-cyan tracking-widest uppercase mb-4">
          ✦ How we work
        </p>
        <h2 className="font-display font-bold text-3xl md:text-4xl text-ca-text mb-4 leading-tight">
          From Sketch to{' '}
          <span className="text-ca-gold text-glow-gold">Cloud Architecture</span>
        </h2>
        <p className="text-ca-muted text-base max-w-xl mx-auto mb-6">
          Every CloudArt engagement starts as a sketch. Here is a typical three-tier solution — drawn first, then revealed as production architecture.
        </p>
        {/* Interaction hint */}
        <p className="font-mono text-xs text-ca-gold/70 animate-flicker" aria-live="polite">
          ✦ Select a component to reveal the system architecture behind it
        </p>
      </div>

      {/* Main interactive area */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
        {/* Left — Sketch diagram */}
        <div className="relative">
          <div
            className="relative rounded-2xl overflow-hidden border border-white/8 bg-ca-bg2/40 p-6"
            style={{ minHeight: '360px' }}
          >
            {/* Paper texture overlay */}
            <div
              className="absolute inset-0 opacity-[0.025] pointer-events-none"
              style={{
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(200,180,150,0.5) 28px)',
              }}
              aria-hidden="true"
            />
            <SketchDiagram activeId={activeId} onSelect={handleSelect} />
          </div>
          {/* "Pencil sketch" label */}
          <p className="font-mono text-xs text-ca-muted/40 text-center mt-3">
            ✏ Hand-drawn illustration — tap a component
          </p>
        </div>

        {/* Right — Technical panel */}
        <div className="flex flex-col gap-4">
          {activeComp ? (
            <TechPanel comp={activeComp} onClose={() => setActiveId(null)} />
          ) : (
            <div className="rounded-2xl border border-white/6 bg-ca-bg2/30 p-8 flex flex-col items-center justify-center text-center" style={{ minHeight: '240px' }}>
              <div className="text-4xl mb-4 opacity-40" aria-hidden="true">⬡</div>
              <p className="font-display text-ca-muted/70 text-base mb-2">Select a layer from the diagram</p>
              <p className="font-mono text-xs text-ca-muted/40">
                Frontend · Backend / API · Database
              </p>
            </div>
          )}

          {/* Quick-select buttons */}
          <div className="flex gap-3 flex-wrap" role="group" aria-label="Architecture layer shortcuts">
            {Object.values(COMPONENTS).map(c => (
              <button
                key={c.id}
                id={`arch-btn-${c.id}`}
                onClick={() => handleSelect(c.id)}
                aria-pressed={activeId === c.id}
                className={`flex-1 font-mono text-xs py-2.5 px-4 rounded-xl border transition-all duration-300
                  ${activeId === c.id
                    ? 'text-ca-bg font-semibold'
                    : 'text-ca-muted border-white/10 hover:border-white/25 hover:text-ca-text bg-ca-bg2/40'
                  }
                `}
                style={activeId === c.id ? {
                  backgroundColor: c.techColor,
                  borderColor: c.techColor,
                } : {}}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Footer note */}
          <p className="font-mono text-xs text-ca-muted/35 text-center pt-2">
            Illustrative reference architecture.
          </p>
        </div>
      </div>
    </section>
  )
}
