import { brand, contact } from '../content/site'

const YEAR = new Date().getFullYear()

export default function Contact() {
  return (
    <>
      <section id="contact" aria-labelledby="contact-title" className="py-28 px-6 text-center" style={{ background: 'radial-gradient(ellipse 60% 80% at 50% 100%, rgba(255,200,87,0.10), transparent 70%)' }}>
        <h2 id="contact-title" className="font-display font-bold text-3xl md:text-5xl text-ca-text leading-tight max-w-2xl mx-auto">
          {contact.title}
        </h2>
        <p className="mt-5 text-ca-muted max-w-xl mx-auto">{contact.body}</p>
        <a
          href={`mailto:${brand.email}`}
          className="inline-block mt-9 font-display font-semibold text-sm px-8 py-3.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a] hover:-translate-y-0.5 transition-all shadow-[0_8px_30px_rgba(255,200,87,0.25)]"
        >
          {contact.cta}
        </a>
      </section>

      <footer className="border-t border-white/5 px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs text-ca-muted">
          <span>© {YEAR} {brand.name} — {brand.tagline}</span>
          <a href={brand.github} target="_blank" rel="noopener noreferrer" className="hover:text-ca-gold transition-colors">GitHub ↗</a>
        </div>
      </footer>
    </>
  )
}
