/**
 * Seed: course categories, service categories and the single bootstrap admin.
 * Idempotent — safe to run repeatedly.
 *
 * The admin row is created with a placeholder cognito_sub ("pending:<email>").
 * When the Cognito auth module (Phase 2) sees a verified login for that email it
 * replaces the placeholder with the real `sub`. Public registration can never
 * create an ADMIN; only this seed can.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const courseCategories = ['AWS', 'Microsoft Azure', 'DevOps', 'Kubernetes', 'Software Engineering', 'AI and Machine Learning', 'Big Data']
const serviceCategories = [
  'AWS Cloud Deployment', 'Azure Cloud Deployment', 'Website Deployment', 'CI/CD Implementation',
  'Docker and Kubernetes', 'Terraform Infrastructure', 'Cloud Migration', 'Monitoring and Maintenance',
]
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function main() {
  for (const [i, name] of courseCategories.entries()) {
    await prisma.courseCategory.upsert({ where: { slug: slugify(name) }, update: {}, create: { name, slug: slugify(name), sortOrder: i } })
  }
  for (const [i, name] of serviceCategories.entries()) {
    await prisma.serviceCategory.upsert({ where: { slug: slugify(name) }, update: {}, create: { name, slug: slugify(name), sortOrder: i } })
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) {
    console.log('ADMIN_EMAIL not set - skipped admin bootstrap.')
  } else {
    await prisma.user.upsert({
      where: { email },
      update: { systemRole: 'ADMIN' },
      create: {
        email,
        cognitoSub: `pending:${email}`,
        fullName: process.env.ADMIN_FULL_NAME || 'CloudArt Admin',
        username: (process.env.ADMIN_USERNAME || 'admin').toLowerCase(),
        systemRole: 'ADMIN',
        professionalCategory: 'CLOUD_ENGINEER',
      },
    })
    console.log(`Admin ensured: ${email}`)
  }
  console.log('Seed complete.')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
