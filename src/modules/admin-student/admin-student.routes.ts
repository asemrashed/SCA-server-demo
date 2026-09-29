import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/rbac.js'
import { validate } from '../../middleware/validate.js'
import {
  createAdminStudentSchema,
  listAdminStudentsQuerySchema,
  setAdminStudentEnrollmentBlockSchema,
  updateAdminStudentSchema,
} from '../../shared/schemas/admin-student.js'
import { SUPER_ADMIN_ROLES } from '../../shared/roles.js'
import * as controller from './admin-student.controller.js'

export const adminStudentRouter = Router()

adminStudentRouter.get(
  '/',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(listAdminStudentsQuerySchema, 'query'),
  controller.list,
)

adminStudentRouter.post(
  '/',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(createAdminStudentSchema),
  controller.create,
)

adminStudentRouter.patch(
  '/enrollments/:enrollmentId/block',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(setAdminStudentEnrollmentBlockSchema),
  controller.setEnrollmentBlock,
)

adminStudentRouter.get(
  '/:id/bound-devices',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  controller.listBoundDevices,
)

adminStudentRouter.delete(
  '/:id/bound-devices/:deviceId',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  controller.removeBoundDevice,
)

adminStudentRouter.patch(
  '/:id',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  validate(updateAdminStudentSchema),
  controller.update,
)

adminStudentRouter.delete(
  '/:id',
  authenticate,
  requireRole(...SUPER_ADMIN_ROLES),
  controller.remove,
)
