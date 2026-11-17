export default function SectionHeader({ eyebrow, title, intro, tone = 'gold' }) {
  return (
    <div className="max-w-3xl mx-auto text-center mb-14">
      <p className={`font-mono text-xs tracking-widest uppercase mb-4 ${tone === 'gold' ? 'text-ca-gold' : 'text-ca-cyan'}`}>
        ✦ {eyebrow}
      </p>
      <h2 className="font-display font-bold text-3xl md:text-4xl text-ca-text leading-tight">{title}</h2>
      {intro && <p className="mt-4 text-ca-muted text-base">{intro}</p>}
    </div>
  )
}
