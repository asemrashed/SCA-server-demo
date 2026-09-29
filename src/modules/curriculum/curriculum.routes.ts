import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/rbac.js'
import { validate } from '../../middleware/validate.js'
import { SUPER_ADMIN_ROLES } from '../../shared/roles.js'
import {
  cascadeDeletePreviewQuerySchema,
  confirmCascadeDeleteSchema,
} from '../../shared/schemas/cascade-delete.js'
import * as controller from './curriculum.controller.js'

export const curriculumRouter = Router()

curriculumRouter.get(
  '/delete-preview',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(cascadeDeletePreviewQuerySchema, 'query'),
  controller.previewCascadeDelete,
)

curriculumRouter.delete(
  '/subjects/:subjectId',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(confirmCascadeDeleteSchema),
  controller.removeSubject,
)

curriculumRouter.delete(
  '/modules/:moduleId',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(confirmCascadeDeleteSchema),
  controller.removeModule,
)

curriculumRouter.delete(
  '/lessons/:lessonId',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(confirmCascadeDeleteSchema),
  controller.removeLesson,
)
