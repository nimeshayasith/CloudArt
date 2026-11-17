/**
 * CloudArt — single source of truth for all marketing / business-plan copy.
 * DRAFT: replace placeholder wording with the final business plan text.
 * No metrics or client names are asserted here on purpose.
 */

export const brand = {
  name: 'CloudArt',
  tagline: 'Where Cloud Engineering Becomes Art.',
  email: 'nimeshayasith@gmail.com',
  github: 'https://github.com/nimeshayasith/CloudArt',
}

export const nav = [
  { label: 'Services',     href: '#services' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Model',        href: '#model' },
  { label: 'Roadmap',      href: '#roadmap' },
]

export const hero = {
  eyebrow: 'Cloud architecture platform',
  headline: ['Where Cloud Engineering', 'Becomes', 'Art.'],
  sub: 'CloudArt turns an idea into a structured, secure and scalable cloud solution — designed first as architecture, then delivered as working infrastructure on AWS.',
  primary: { label: 'Start a project', href: '#contact' },
  secondary: { label: 'See how we work', href: '#architecture' },
  pillars: ['AWS-first', 'Architecture before code', 'Built to scale'],
  nodes: [
    { label: 'Compute',  pos: 'left-[2%] top-[34%]',  tone: 'gold' },
    { label: 'Storage',  pos: 'right-[2%] top-[42%]', tone: 'cyan' },
    { label: 'Network',  pos: 'left-[6%] top-[66%]',  tone: 'cyan' },
    { label: 'Security', pos: 'right-[6%] top-[72%]', tone: 'gold' },
  ],
}

export const services = {
  eyebrow: 'What we do',
  title: 'Four ways CloudArt creates value',
  intro: 'A focused service line that follows a workload from the first sketch to day-two operations.',
  items: [
    {
      id: 'architecture',
      icon: '◇',
      tone: 'gold',
      title: 'Cloud Architecture & Design',
      body: 'Well-Architected designs, cost models and security reviews that turn a business goal into a buildable blueprint.',
      tags: ['AWS', 'Well-Architected', 'Cost modelling'],
    },
    {
      id: 'migration',
      icon: '⇄',
      tone: 'cyan',
      title: 'Migration & Modernisation',
      body: 'Move legacy workloads to managed, cloud-native services with a clear plan, rollback path and minimal disruption.',
      tags: ['Rehost', 'Replatform', 'Serverless'],
    },
    {
      id: 'devops',
      icon: '⟳',
      tone: 'gold',
      title: 'DevOps & Automation',
      body: 'Infrastructure as code and CI/CD pipelines so every release is repeatable, reviewed and reversible.',
      tags: ['Terraform', 'GitHub Actions', 'Docker'],
    },
    {
      id: 'operations',
      icon: '◉',
      tone: 'cyan',
      title: 'Managed Cloud Operations',
      body: 'Monitoring, patching and optimisation on a retainer, so teams can focus on product instead of plumbing.',
      tags: ['Observability', 'Security', 'FinOps'],
    },
  ],
}

export const model = {
  eyebrow: 'Business model',
  title: 'From problem to sustainable revenue',
  columns: [
    {
      heading: 'The problem',
      tone: 'gold',
      points: [
        'Small and growing teams need cloud expertise they cannot yet hire full-time.',
        'Cloud bills and security risk grow quietly when architecture is an afterthought.',
        'Delivery slows when infrastructure is built by hand.',
      ],
    },
    {
      heading: 'The CloudArt answer',
      tone: 'cyan',
      points: [
        'Architecture-led engagements that fix the design before any build begins.',
        'Reusable infrastructure-as-code modules to speed up every delivery.',
        'One accountable partner from sketch to operations.',
      ],
    },
    {
      heading: 'How we earn',
      tone: 'gold',
      points: [
        'Fixed-scope architecture and migration projects.',
        'Monthly managed-operations retainers.',
        'Workshops and enablement for client teams.',
      ],
    },
  ],
}

export const roadmap = {
  eyebrow: 'Roadmap',
  title: 'Four phases of growth',
  phases: [
    { step: '01', name: 'Foundation', body: 'Define the service line, brand, reference architectures and delivery templates.' },
    { step: '02', name: 'Launch',     body: 'Take on the first pilot engagements and publish the platform.' },
    { step: '03', name: 'Growth',     body: 'Convert pilots into retainers; build a reusable module library and partnerships.' },
    { step: '04', name: 'Scale',      body: 'Grow the team, add certifications and expand into new industries.' },
  ],
}

export const contact = {
  title: 'Have an idea worth building?',
  body: 'Tell us what you want to achieve. We will come back with an architecture-first plan.',
  cta: 'Email CloudArt',
}
