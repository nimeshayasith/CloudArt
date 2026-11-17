/**
 * Real end-to-end check of the Phase 2 auth flow against the live Cognito dev pool + local PostgreSQL.
 * Uses the SES mailbox simulator address (no real inbox receives mail), confirms the user with an
 * admin API call (we cannot read the emailed code), and deletes everything it created.
 *
 *   node --env-file=.env scripts/e2e-cognito.mjs
 * Requires AWS credentials allowed to call cognito-idp:AdminConfirmSignUp / AdminDeleteUser.
 */
import { AdminConfirmSignUpCommand, AdminDeleteUserCommand, AdminUpdateUserAttributesCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { prisma } from '../src/config/prisma.js'

const admin = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION })
const poolId = process.env.COGNITO_USER_POOL_ID
const app = createApp()
const ts = Date.now()
const email = `success+cloudart${ts}@simulator.amazonses.com`
const username = `e2e_${ts}`
const password = 'Str0ng!Pass#1'

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + extra}`)
  if (!ok) failures++
}

try {
  const reg = await request(app).post('/api/v1/auth/register').send({
    fullName: 'E2E Tester', email, organization: 'E2E University', username,
    professionalCategory: 'CLOUD_ENGINEER', password, confirmPassword: password,
  })
  check('register -> 201', reg.status === 201, JSON.stringify(reg.body))

  const early = await request(app).post('/api/v1/auth/login').send({ email, password })
  check('login before verification -> 403 EMAIL_NOT_VERIFIED', early.status === 403 && early.body.error?.code === 'EMAIL_NOT_VERIFIED', JSON.stringify(early.body))

  const bad = await request(app).post('/api/v1/auth/confirm').send({ email, code: '000000' })
  check('wrong verification code -> 400', bad.status === 400, JSON.stringify(bad.body))

  const dup = await request(app).post('/api/v1/auth/register').send({
    fullName: 'E2E Tester', email, organization: 'E2E University', username: `${username}b`,
    professionalCategory: 'STUDENT', password, confirmPassword: password,
  })
  check('duplicate (unconfirmed) email rejected by Cognito -> 409', dup.status === 409, JSON.stringify(dup.body))

  await admin.send(new AdminConfirmSignUpCommand({ UserPoolId: poolId, Username: email }))
  // Confirming with the emailed code also sets email_verified=true; the admin API does not, so mimic it.
  await admin.send(new AdminUpdateUserAttributesCommand({ UserPoolId: poolId, Username: email, UserAttributes: [{ Name: 'email_verified', Value: 'true' }] }))

  const wrong = await request(app).post('/api/v1/auth/login').send({ email, password: 'Wr0ng!Password' })
  check('wrong password -> 401', wrong.status === 401, JSON.stringify(wrong.body))

  // An unverified-email token must be refused by the API even if it is otherwise valid.
  const login = await request(app).post('/api/v1/auth/login').send({ email, password })
  check('login after verification -> 200 + tokens', login.status === 200 && !!login.body.idToken, JSON.stringify(login.body))
  const auth = { Authorization: `Bearer ${login.body.idToken}` }

  const noTok = await request(app).get('/api/v1/users/me')
  check('/users/me without token -> 401', noTok.status === 401)

  // first-ever requests in parallel: profile must be created exactly once
  const burst = await Promise.all([1, 2, 3].map(() => request(app).get('/api/v1/users/me').set(auth)))
  check('concurrent first /users/me -> all 200', burst.every((r) => r.status === 200), burst.map((r) => r.status).join())
  const me = burst[0].body.user
  check('profile created from signup data', me?.username === username && me?.organization === 'E2E University' && me?.professionalCategory === 'CLOUD_ENGINEER' && me?.role === 'STUDENT', JSON.stringify(me))
  check('exactly one DB row for the user', (await prisma.user.count({ where: { email } })) === 1)
  check('cognitoSub not leaked', !JSON.stringify(burst[0].body).includes('cognito'))

  const ping = await request(app).get('/api/v1/users/admin/ping').set(auth)
  check('student -> admin API -> 403', ping.status === 403, JSON.stringify(ping.body))

  const dupAfter = await request(app).post('/api/v1/auth/register').send({
    fullName: 'X Y', email: `other${ts}@example.org`, organization: 'E2E University', username,
    professionalCategory: 'STUDENT', password, confirmPassword: password,
  })
  check('duplicate username after signup -> 409 USERNAME_TAKEN', dupAfter.status === 409 && dupAfter.body.error?.code === 'USERNAME_TAKEN', JSON.stringify(dupAfter.body))

  const ref = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken })
  check('refresh token -> new id token', ref.status === 200 && !!ref.body.idToken, JSON.stringify(ref.body))

  await prisma.user.update({ where: { email }, data: { systemRole: 'ADMIN' } })
  const ping2 = await request(app).get('/api/v1/users/admin/ping').set(auth)
  check('admin role in PostgreSQL -> admin API -> 200', ping2.status === 200, JSON.stringify(ping2.body))

  await prisma.user.update({ where: { email }, data: { isActive: false } })
  const off = await request(app).get('/api/v1/users/me').set(auth)
  check('disabled account -> 403', off.status === 403, JSON.stringify(off.body))
} finally {
  for (const u of [email, `other${ts}@example.org`]) {
    await admin.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: u })).catch(() => {})
  }
  await prisma.user.deleteMany({ where: { email } })
  await prisma.organization.deleteMany({ where: { name: 'E2E University' } })
  await prisma.$disconnect()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
