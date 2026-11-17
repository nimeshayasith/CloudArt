import SectionHeader from './SectionHeader'
import { model } from '../content/site'

export default function BusinessModel() {
  return (
    <section id="model" aria-labelledby="model-title" className="py-24 px-6" style={{ background: 'linear-gradient(180deg,#070B12,#0A1220 50%,#070B12)' }}>
      <SectionHeader eyebrow={model.eyebrow} title={<span id="model-title">{model.title}</span>} tone="cyan" />
      <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-3">
        {model.columns.map((c, i) => {
          const gold = c.tone === 'gold'
          return (
            <div key={c.heading} className="relative rounded-2xl border border-white/10 bg-ca-bg2/50 p-8">
              <span className={`font-mono text-xs ${gold ? 'text-ca-gold' : 'text-ca-cyan'}`}>0{i + 1}</span>
              <h3 className="font-display font-bold text-xl text-ca-text mt-2 mb-5">{c.heading}</h3>
              <ul className="space-y-4">
                {c.points.map(p => (
                  <li key={p} className="flex gap-3 text-sm text-ca-muted leading-relaxed">
                    <span className={`mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full ${gold ? 'bg-ca-gold' : 'bg-ca-cyan'}`} aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
