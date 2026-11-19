import { z } from 'zod'

/** An update body must change something. */
export const atLeastOne = (schema) => schema.refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })

/** A price: not negative, at most two decimals. */
export const money = z
  .number({ message: 'Enter an amount' })
  .min(0, 'The price cannot be negative')
  .max(10_000_000, 'That price is too high')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places')

/** A 3-letter currency code such as USD or LKR. */
export const currencyCode = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code such as USD or LKR')

/** A calendar date as "YYYY-MM-DD" that really exists (no 2026-02-31). */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, 'Enter a real date')

/** Empty text means "not given" (null); undefined stays undefined so a PATCH can leave the field alone. */
export const blankToNull = (v) => (v === undefined ? undefined : v || null)
