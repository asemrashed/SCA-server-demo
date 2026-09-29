import { Router } from 'express'
import {
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updateMeSchema,
} from '../../shared/schemas/auth.js'
import { validate } from '../../middleware/validate.js'
import { authenticate } from '../../middleware/auth.js'
import * as controller from './auth.controller.js'

export const authRouter = Router()

authRouter.post('/register', validate(registerSchema), controller.register)
authRouter.post('/login', validate(loginSchema), controller.login)
authRouter.post('/request-password-reset', validate(requestPasswordResetSchema), controller.requestPasswordReset)
authRouter.post('/reset-password', validate(resetPasswordSchema), controller.resetPassword)
authRouter.post('/refresh', controller.refresh)
authRouter.post('/logout', authenticate, controller.logout)
authRouter.get('/me', authenticate, controller.me)
authRouter.patch('/me', authenticate, validate(updateMeSchema), controller.updateMe)
