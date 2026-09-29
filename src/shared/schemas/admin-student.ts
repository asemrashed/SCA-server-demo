import { z } from 'zod'
import { isBdE164Phone, normalizeBdPhone } from '../phone.js'

const bdPhoneSchema = z
  .string()
  .trim()
  .transform(normalizeBdPhone)
  .refine(isBdE164Phone, 'Use BD format: 01XXXXXXXXX or +8801XXXXXXXXX')

export const listAdminStudentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  courseId: z.string().cuid().optional(),
  batchId: z.string().cuid().optional(),
  sort: z.string().optional(),
})

export type ListAdminStudentsQuery = z.infer<typeof listAdminStudentsQuerySchema>

export const createAdminStudentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: bdPhoneSchema,
  password: z.string().trim().min(8).max(128),
  email: z.string().trim().email().optional().nullable(),
})

export type CreateAdminStudentInput = z.infer<typeof createAdminStudentSchema>

export const updateAdminStudentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: bdPhoneSchema.optional(),
    email: z.string().trim().email().optional().nullable(),
    avatarUrl: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  })

export type UpdateAdminStudentInput = z.infer<typeof updateAdminStudentSchema>

export const setAdminStudentEnrollmentBlockSchema = z.object({
  blocked: z.boolean(),
})

export type SetAdminStudentEnrollmentBlockInput = z.infer<
  typeof setAdminStudentEnrollmentBlockSchema
>
