import { z } from 'zod'
import { isBdE164Phone, normalizeBdPhone } from '../phone.js'

/** Accepts 01XXXXXXXXX or +8801XXXXXXXXX; stores/looks up as E.164. */
const bdPhoneSchema = z
  .string()
  .trim()
  .transform(normalizeBdPhone)
  .refine(isBdE164Phone, 'Use BD format: 01XXXXXXXXX or +8801XXXXXXXXX')

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: bdPhoneSchema,
  email: z.string().trim().email(),
  password: z.string().trim().min(8).max(128),
})

export const loginSchema = z.object({
  phone: bdPhoneSchema,
  password: z.string().trim().min(1),
  /** When true, refresh token lasts JWT_REFRESH_EXPIRES_IN; otherwise JWT_REFRESH_SESSION_EXPIRES_IN. */
  remember: z.boolean().optional(),
})

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().email(),
})

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  newPassword: z.string().trim().min(8).max(128),
})

export const verifyPhoneSchema = z.object({
  phone: bdPhoneSchema,
  otp: z.string().trim().length(6),
})

export const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().email().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type UpdateMeInput = z.infer<typeof updateMeSchema>
