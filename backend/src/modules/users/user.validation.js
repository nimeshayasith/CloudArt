import { z } from 'zod'
import { PROFESSIONAL_CATEGORIES } from '../auth/auth.validation.js'

/** Fields a user may change on their own profile. Username and email are immutable. */
export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(150).optional(),
    organization: z.string().trim().min(2, 'University / organization is required').max(200).optional(),
    professionalCategory: z.enum(PROFESSIONAL_CATEGORIES, { message: 'Choose your role' }).optional(),
  })
  .strict() // reject attempts to send role / email / username etc.
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' })
