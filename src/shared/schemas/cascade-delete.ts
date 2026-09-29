import { z } from 'zod'

/** Required body for permanent cascade deletes (Super Admin). */
export const confirmCascadeDeleteSchema = z.object({
  confirm: z.literal('DELETE'),
})

export const cascadeDeletePreviewQuerySchema = z
  .object({
    courseId: z.string().cuid().optional(),
    batchId: z.string().cuid().optional(),
    subjectId: z.string().cuid().optional(),
    moduleId: z.string().cuid().optional(),
    lessonId: z.string().cuid().optional(),
  })
  .refine(
    (q) => Boolean(q.courseId || q.batchId || q.subjectId || q.moduleId || q.lessonId),
    { message: 'Provide courseId, batchId, subjectId, moduleId, or lessonId' },
  )
