import Navigation from '../components/Navigation'
import Hero from '../components/Hero'
import Services from '../components/Services'
import ArchitectureReveal from '../components/ArchitectureReveal'
import BusinessModel from '../components/BusinessModel'
import Roadmap from '../components/Roadmap'
import Contact from '../components/Contact'

export default function Home() {
  return (
    <div className="min-h-screen bg-ca-bg overflow-x-hidden">
      <a href="#services" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-ca-gold focus:text-ca-bg focus:px-4 focus:py-2 focus:rounded">
        Skip to content
      </a>
      <Navigation />
      <main>
        <Hero />
        <Services />
        <ArchitectureReveal />
        <BusinessModel />
        <Roadmap />
        <Contact />
      </main>
    </div>
  )
}
