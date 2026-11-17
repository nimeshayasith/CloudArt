import { describe, expect, it } from 'vitest'
import { loginSchema, passwordSchema, registerSchema } from '../src/modules/auth/auth.validation.js'

const valid = {
  fullName: 'Test Student',
  email: 'Test.Student@Example.com',
  organization: 'University of Ruhuna',
  username: 'Test_Student',
  professionalCategory: 'STUDENT',
  password: 'Str0ng!Pass',
  confirmPassword: 'Str0ng!Pass',
}
const issues = (input) => {
  const r = registerSchema.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

describe('password policy', () => {
  it.each([
    ['Sh0rt!', 'at least 8'],
    ['nouppercase1!', 'uppercase'],
    ['NOLOWERCASE1!', 'lowercase'],
    ['NoNumber!!', 'number'],
    ['NoSymbol123', 'symbol'],
  ])('rejects %s', (pw, msg) => {
    const r = passwordSchema.safeParse(pw)
    expect(r.success).toBe(false)
    expect(r.error.issues.map((i) => i.message).join()).toContain(msg)
  })
  it('accepts a strong password', () => expect(passwordSchema.safeParse('Str0ng!Pass').success).toBe(true))
})

describe('register schema', () => {
  it('accepts valid input and normalises email + username to lowercase', () => {
    const r = registerSchema.parse(valid)
    expect(r.email).toBe('test.student@example.com')
    expect(r.username).toBe('test_student')
  })
  it('rejects invalid email', () => expect(issues({ ...valid, email: 'not-an-email' }).join()).toContain('email'))
  it('rejects mismatched confirmation', () =>
    expect(issues({ ...valid, confirmPassword: 'Different1!' })).toContain('confirmPassword: Passwords do not match'))
  it('rejects missing organization', () => expect(issues({ ...valid, organization: '' }).join()).toContain('organization'))
  it('rejects bad usernames', () => {
    for (const username of ['ab', 'has space', 'bad$char', 'x'.repeat(31)]) {
      expect(issues({ ...valid, username }).join(), username).toContain('username')
    }
  })
  it('rejects an unknown role and cannot self-assign ADMIN', () => {
    expect(issues({ ...valid, professionalCategory: 'ADMIN' }).join()).toContain('professionalCategory')
  })
  it('ignores a smuggled systemRole field', () => {
    expect(registerSchema.parse({ ...valid, systemRole: 'ADMIN' })).not.toHaveProperty('systemRole')
  })
})

describe('login schema', () => {
  it('requires a password', () => expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false))
})
