import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/rbac.js'
import { validate } from '../../middleware/validate.js'
import { createBatchBodySchema } from '../../shared/schemas/batch.js'
import { applyBatchCurriculumSchema } from '../../shared/schemas/batch-curriculum.js'
import { confirmCascadeDeleteSchema } from '../../shared/schemas/cascade-delete.js'
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from '../../shared/roles.js'
import {
  courseListQuerySchema,
  createCourseSchema,
  createModuleBodySchema,
  updateCourseSchema,
  updateModuleBodySchema,
} from '../../shared/schemas/course.js'
import { attachCourseLiveRoutes } from '../liveclass/liveclass.routes.js'
import * as controller from './course.controller.js'

export const courseRouter = Router()

courseRouter.get('/', validate(courseListQuerySchema, 'query'), controller.list)

courseRouter.get('/:courseId/batches', controller.listBatchesForCourse)
courseRouter.post(
  '/:courseId/batches',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(createBatchBodySchema),
  controller.createBatchForCourse,
)
courseRouter.put(
  '/:courseId/batch-curriculum',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(applyBatchCurriculumSchema),
  controller.applyBatchCurriculum,
)

courseRouter.post(
  '/:id/modules',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(createModuleBodySchema),
  controller.createModule,
)
courseRouter.patch(
  '/:id/modules/:moduleId',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(updateModuleBodySchema),
  controller.updateModule,
)

attachCourseLiveRoutes(courseRouter)

courseRouter.get('/:idOrSlug', controller.getByIdOrSlug)
courseRouter.post(
  '/',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(createCourseSchema),
  controller.create,
)
courseRouter.patch(
  '/:id',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(updateCourseSchema),
  controller.update,
)
courseRouter.delete(
  '/:id',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(confirmCascadeDeleteSchema),
  controller.remove,
)
