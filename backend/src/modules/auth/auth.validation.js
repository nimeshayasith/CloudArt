import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'

export const PROFESSIONAL_CATEGORIES = [
  'STUDENT', 'SOFTWARE_ENGINEER', 'CLOUD_ENGINEER', 'DEVOPS_ENGINEER', 'SOLUTIONS_ARCHITECT', 'SRE', 'OTHER',
]

// Same policy as the Cognito user pool: 8+ chars, upper, lower, number, symbol.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol')

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(255)

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(150),
    email,
    organization: z.string().trim().min(2, 'University / organization is required').max(200),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_.-]{3,30}$/, 'Username must be 3-30 characters: letters, numbers, . _ -'),
    professionalCategory: z.enum(PROFESSIONAL_CATEGORIES, { message: 'Choose your role' }),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export const confirmSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export const resendSchema = z.object({ email })

export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) })

export const refreshSchema = z.object({ refreshToken: z.string().min(10) })

/** Express middleware factory: validates req.body and replaces it with the parsed value. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {})
  if (!result.success) {
    const fields = {}
    for (const issue of result.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message
    return next(new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', fields))
  }
  req.body = result.data
  next()
}
