import { prisma } from '../config/prisma.js'

/** "Intro to IAM!" -> "intro-to-iam" (ASCII only, max 80 chars). */
export function slugify(text) {
  const s = String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '')
  return s || 'course'
}

/** A slug no other course uses; appends -2, -3 … on collision. */
export async function uniqueCourseSlug(title, ignoreCourseId) {
  const base = slugify(title)
  let candidate = base
  for (let i = 2; i < 200; i++) {
    const hit = await prisma.course.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!hit || hit.id === ignoreCourseId) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

const ID = /^[A-Za-z0-9_-]{11}$/

/**
 * Accepts a bare 11-character YouTube video id or a watch / youtu.be / embed / shorts / live URL
 * and returns the video id, or null when it is not a YouTube video reference.
 */
export function parseYouTubeId(input) {
  const value = String(input ?? '').trim()
  if (ID.test(value)) return value
  let url
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let id = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
      id = m?.[1] ?? null
    }
  }
  return id && ID.test(id) ? id : null
}
