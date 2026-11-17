import { execFileSync } from 'node:child_process'
import { expect } from '@playwright/test'

export const POOL = process.env.COGNITO_USER_POOL_ID ?? 'ap-south-1_KXQljZJGU'
export const REGION = process.env.COGNITO_REGION ?? 'ap-south-1'
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'
export const PASSWORD = 'Str0ng!Pass#1'

// The AWS link from a dev machine drops connections now and then, so retry transient failures.
export const aws = (...args) => {
  let last
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return execFileSync('aws', ['cognito-idp', ...args, '--region', REGION, '--user-pool-id', POOL], { stdio: 'pipe', timeout: 90_000 }).toString()
    } catch (err) {
      last = err
      const msg = String(err.stderr ?? err.message)
      if (!/Connection was closed|timed out|ETIMEDOUT|ECONNRESET|Could not connect/i.test(msg) && !err.killed) throw err
    }
  }
  throw last
}
export const sql = (q) =>
  execFileSync('docker', ['exec', 'cloudart-db', 'psql', '-U', 'cloudart', '-d', 'cloudart_db', '-t', '-A', '-c', q], { stdio: 'pipe' }).toString().trim()

/** Registers a real Cognito user, then confirms it as the emailed code would (we cannot read the inbox). */
export async function makeVerifiedUser(request, { email, username, fullName, organization }) {
  const res = await request.post(`${API}/auth/register`, {
    data: { fullName, email, organization, username, professionalCategory: 'CLOUD_ENGINEER', password: PASSWORD, confirmPassword: PASSWORD },
  })
  expect(res.status(), await res.text()).toBe(201)
  aws('admin-confirm-sign-up', '--username', email)
  aws('admin-update-user-attributes', '--username', email, '--user-attributes', 'Name=email_verified,Value=true')
}

export async function apiLogin(request, email) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()).idToken
}

export const me = (request, idToken) => request.get(`${API}/users/me`, { headers: { Authorization: `Bearer ${idToken}` } })

export async function uiLogin(page, email, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

export function cleanup(emails, orgs = []) {
  for (const email of emails) {
    try { aws('admin-delete-user', '--username', email) } catch { /* already gone */ }
  }
  try {
    sql(`delete from enrollments where course_id in (select id from courses where slug like 'e2e-course-%');
         delete from courses where slug like 'e2e-course-%';
         ${emails.map((e) => `delete from users where email='${e}';`).join('\n')}
         ${orgs.map((o) => `delete from organizations where name='${o}';`).join('\n')}`)
  } catch { /* ignore */ }
}
