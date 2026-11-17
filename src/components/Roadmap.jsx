import SectionHeader from './SectionHeader'
import { roadmap } from '../content/site'

export default function Roadmap() {
  return (
    <section id="roadmap" aria-labelledby="roadmap-title" className="py-24 px-6">
      <SectionHeader eyebrow={roadmap.eyebrow} title={<span id="roadmap-title">{roadmap.title}</span>} />
      <ol className="max-w-6xl mx-auto grid gap-6 md:grid-cols-2 lg:grid-cols-4 relative">
        {roadmap.phases.map(p => (
          <li key={p.step} className="relative rounded-2xl border border-white/10 bg-ca-bg2/50 p-6">
            <span className="font-display font-extrabold text-4xl text-ca-gold/30">{p.step}</span>
            <h3 className="font-display font-bold text-lg text-ca-text mt-2 mb-2">{p.name}</h3>
            <p className="text-sm text-ca-muted leading-relaxed">{p.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
