import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/rbac.js'
import { validate } from '../../middleware/validate.js'
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from '../../shared/roles.js'
import { createContentGrantSchema } from '../../shared/schemas/course.js'
import { batchListQuerySchema, updateBatchSchema } from '../../shared/schemas/batch.js'
import {
  createModuleBodySchema,
  createSubjectBodySchema,
  updateModuleBodySchema,
  updateSubjectBodySchema,
} from '../../shared/schemas/course.js'
import { confirmCascadeDeleteSchema } from '../../shared/schemas/cascade-delete.js'
import { batchCurriculumSchema } from '../../shared/schemas/batch-curriculum.js'
import * as controller from './batch.controller.js'
import { attachBatchLiveRoutes } from '../liveclass/liveclass.routes.js'

export const batchRouter = Router()

batchRouter.get('/', validate(batchListQuerySchema, 'query'), controller.list)

batchRouter.get(
  '/:id/content-grants',
  authenticate,
  requireRole(...ADMIN_ROLES),
  controller.listContentGrants,
)
batchRouter.post(
  '/:id/content-grants',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(createContentGrantSchema),
  controller.createContentGrant,
)
batchRouter.delete(
  '/:id/content-grants/:grantId',
  authenticate,
  requireRole(...ADMIN_ROLES),
  controller.deleteContentGrant,
)

attachBatchLiveRoutes(batchRouter)

batchRouter.get('/:id/curriculum', controller.getCurriculum)
batchRouter.put(
  '/:id/curriculum',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(batchCurriculumSchema),
  controller.replaceCurriculum,
)

batchRouter.post(
  '/:id/subjects',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(createSubjectBodySchema),
  controller.createSubject,
)
batchRouter.patch(
  '/:id/subjects/:subjectId',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(updateSubjectBodySchema),
  controller.updateSubject,
)
batchRouter.post(
  '/:id/subjects/:subjectId/modules',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(createModuleBodySchema),
  controller.createSubjectModule,
)
batchRouter.patch(
  '/:id/modules/:moduleId',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(updateModuleBodySchema),
  controller.updateModule,
)

batchRouter.get('/:idOrSlug', controller.getByIdOrSlug)
batchRouter.patch(
  '/:id',
  authenticate,
  requireRole(...ADMIN_ROLES),
  validate(updateBatchSchema),
  controller.update,
)
batchRouter.delete(
  '/:id',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(confirmCascadeDeleteSchema),
  controller.remove,
)
