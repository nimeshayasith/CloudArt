// Mirrors the backend/Cognito policy exactly.
export const PASSWORD_RULES = [
  { id: 'len', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { id: 'num', label: 'One number', test: (p) => /[0-9]/.test(p) },
  { id: 'sym', label: 'One symbol (e.g. ! @ # $)', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

export const isStrongPassword = (p) => PASSWORD_RULES.every((r) => r.test(p))

export const ROLES = [
  ['STUDENT', 'Student'],
  ['SOFTWARE_ENGINEER', 'Software Engineer'],
  ['CLOUD_ENGINEER', 'Cloud Engineer'],
  ['DEVOPS_ENGINEER', 'DevOps Engineer'],
  ['SOLUTIONS_ARCHITECT', 'Solutions Architect'],
  ['SRE', 'Site Reliability Engineer'],
  ['OTHER', 'Other'],
]
