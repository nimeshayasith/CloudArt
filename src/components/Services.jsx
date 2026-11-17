import SectionHeader from './SectionHeader'
import { services } from '../content/site'

const TONE = {
  gold: { text: 'text-ca-gold', border: 'hover:border-ca-gold/50', chip: 'text-ca-gold/80 border-ca-gold/25 bg-ca-gold/10', icon: 'bg-ca-gold/10 border-ca-gold/30' },
  cyan: { text: 'text-ca-cyan', border: 'hover:border-ca-cyan/50', chip: 'text-ca-cyan/80 border-ca-cyan/25 bg-ca-cyan/10', icon: 'bg-ca-cyan/10 border-ca-cyan/30' },
}

export default function Services() {
  return (
    <section id="services" aria-labelledby="services-title" className="py-24 px-6" style={{ background: 'linear-gradient(180deg,#070B12,#0C1420 50%,#070B12)' }}>
      <SectionHeader eyebrow={services.eyebrow} title={<span id="services-title">{services.title}</span>} intro={services.intro} />
      <div className="max-w-6xl mx-auto grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {services.items.map(s => {
          const t = TONE[s.tone]
          return (
            <article
              key={s.id}
              className={`group flex flex-col gap-4 p-6 rounded-2xl border border-white/10 bg-ca-bg2/60 transition-all duration-300 hover:-translate-y-1 ${t.border}`}
            >
              <div className={`w-12 h-12 rounded-xl border flex items-center justify-center text-xl ${t.icon} ${t.text}`} aria-hidden="true">
                {s.icon}
              </div>
              <h3 className="font-display font-bold text-lg text-ca-text">{s.title}</h3>
              <p className="text-ca-muted text-sm leading-relaxed flex-1">{s.body}</p>
              <ul className="flex flex-wrap gap-2">
                {s.tags.map(tag => (
                  <li key={tag} className={`font-mono text-[11px] px-2.5 py-1 rounded-full border ${t.chip}`}>{tag}</li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
    </section>
  )
}
