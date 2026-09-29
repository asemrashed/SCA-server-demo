import * as argon2 from 'argon2'
import type { User as PrismaUser } from '@prisma/client'
import { prisma } from '../../config/db.js'
import { env } from '../../config/env.js'
import { classifyDeviceType } from '../../lib/device.js'
import { addDuration } from '../../lib/duration.js'
import {
  conflict,
  deviceBoundOther,
  forbidden,
  unauthorized,
  notFound,
  validationError,
} from '../../lib/errors.js'
import { notifier } from '../../lib/notifier.js'
import { buildPasswordResetEmail } from '../../lib/password-reset-email.js'
import { Role } from '../../shared/enums.js'
import { isLoginAllowed } from '../../shared/roles.js'
import { signAccessToken } from '../../lib/jwt.js'
import { generateRefreshToken, hashToken } from '../../lib/refresh-token.js'
import type {
  LoginInput,
  RegisterInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  UpdateMeInput,
} from '../../shared/schemas/auth.js'
import { bdPhoneLookupVariants } from '../../shared/phone.js'
import { allocateStudentIdNumber } from '../../lib/student-id.js'
import type { AuthTokensResponse, User } from '../../shared/types/index.js'
import { toPublicUser } from './auth.mapper.js'

export interface DeviceContext {
  deviceKey: string
  userAgent?: string
  ip?: string
}

export interface AuthSession {
  user: User
  accessToken: string
  refreshToken: string
  /** Absolute expiry of the refresh token (cookie maxAge follows this). */
  refreshExpiresAt: Date
  deviceKey?: string
}

export type IssueSessionOptions = {
  /** Duration string (e.g. `7d`). Ignored when `expiresAt` is set. */
  expiresIn?: string
  /** Preserve absolute expiry across refresh rotation. */
  expiresAt?: Date
}

/**
 * Students: lock first mobile + first desktop forever.
 * Logout / password change do not clear bindings — only admin remove does.
 */
async function enforceStudentDeviceBinding(
  user: PrismaUser,
  device: DeviceContext,
): Promise<void> {
  // Device-binding lock temporarily disabled.
  // Original logic intentionally kept below for reference and rollback.
  if (user.role !== Role.STUDENT) return

  return

  // --------------------------------------------------------------------------
  // Original code kept for reference; disabled to allow any student device.
  // console.log("device", device)
  // console.log("device.userAgent", device.userAgent)
  // console.log("device.deviceKey", device.deviceKey)
  // console.log("device.ip", device.ip)
  //
  // const deviceType = classifyDeviceType(device.userAgent)
  // const deviceKeyHash = hashToken(device.deviceKey)
  // const ua = device.userAgent?.slice(0, 512) ?? null
  //
  // const existing = await prisma.boundDevice.findUnique({
  //   where: {
  //     userId_deviceType: { userId: user.id, deviceType },
  //   },
  // })
  //
  // if (!existing) {
  //   await prisma.boundDevice.create({
  //     data: {
  //       userId: user.id,
  //       deviceType,
  //       deviceKeyHash,
  //       userAgent: ua,
  //     },
  //   })
  //   return
  // }
  //
  // if (existing.deviceKeyHash === deviceKeyHash) {
  //   await prisma.boundDevice.update({
  //     where: { id: existing.id },
  //     data: { lastSeenAt: new Date(), ...(ua ? { userAgent: ua } : {}) },
  //   })
  //   return
  // }
  //
  // await prisma.deviceLoginAttempt.create({
  //   data: {
  //     userId: user.id,
  //     deviceType,
  //     userAgent: ua,
  //     ip: device.ip?.slice(0, 64) ?? null,
  //   },
  // })
  // console.warn('[auth] blocked login from unbound device', {
  //   userId: user.id,
  //   deviceType,
  //   ip: device.ip,
  // })
  // throw deviceBoundOther()
  // --------------------------------------------------------------------------
}

async function issueSession(
  user: PrismaUser,
  deviceKey?: string,
  options?: IssueSessionOptions,
): Promise<AuthSession> {
  if (!isLoginAllowed(user.role as Role)) {
    throw forbidden('This account type cannot sign in')
  }

  const refreshToken = generateRefreshToken()
  const expiresAt =
    options?.expiresAt ??
    addDuration(new Date(), options?.expiresIn ?? env.JWT_REFRESH_EXPIRES_IN)

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  })

  return {
    user: toPublicUser(user),
    accessToken: signAccessToken({ sub: user.id, role: user.role as Role }),
    refreshToken,
    refreshExpiresAt: expiresAt,
    deviceKey,
  }
}

export async function register(
  input: RegisterInput,
  device: DeviceContext,
): Promise<AuthSession> {
  const existing = await prisma.user.findFirst({
    where: { phone: { in: bdPhoneLookupVariants(input.phone) } },
  })
  if (existing) {
    throw conflict('Phone number is already registered')
  }

  const emailTaken = await prisma.user.findFirst({
    where: {
      email: { equals: input.email.trim().toLowerCase(), mode: 'insensitive' },
      deletedAt: null,
    },
  })
  if (emailTaken) {
    throw conflict('Email is already registered')
  }

  const passwordHash = await argon2.hash(input.password)
  const user = await prisma.user.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email.trim().toLowerCase(),
      passwordHash,
      phoneVerified: true,
    },
  })

  const assignedIdNumber = await allocateStudentIdNumber(user.id)
  const withId = await prisma.user.update({
    where: { id: user.id },
    data: { idNumber: assignedIdNumber },
  })

  // Device-binding enforcement disabled temporarily.
  // Original line kept for reference below:
  // await enforceStudentDeviceBinding(withId, device)
  return issueSession(withId, device.deviceKey, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  })
}

export async function login(input: LoginInput, device: DeviceContext): Promise<AuthSession> {
  const user = await prisma.user.findFirst({
    where: { phone: { in: bdPhoneLookupVariants(input.phone) } },
  })
  if (!user || user.deletedAt || !user.isActive) {
    throw unauthorized('Invalid phone or password')
  }

  const valid = await argon2.verify(user.passwordHash, input.password)
  if (!valid) {
    throw unauthorized('Invalid phone or password')
  }

  // Device-binding check disabled temporarily.
  // Original line kept for reference below:
  // await enforceStudentDeviceBinding(user, device)

  const expiresIn = input.remember
    ? env.JWT_REFRESH_EXPIRES_IN
    : env.JWT_REFRESH_SESSION_EXPIRES_IN
  return issueSession(user, device.deviceKey, { expiresIn })

}

export async function refresh(refreshToken: string): Promise<AuthSession> {
  const tokenHash = hashToken(refreshToken)
  const stored = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  })

  if (!stored || stored.user.deletedAt || !stored.user.isActive) {
    throw unauthorized('Invalid or expired refresh token')
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  })

  // Keep the original absolute expiry so "remember me" cannot be extended via refresh.
  return issueSession(stored.user, undefined, { expiresAt: stored.expiresAt })
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return

  const tokenHash = hashToken(refreshToken)
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function getMe(userId: string): Promise<User> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  })
  if (!user) {
    throw notFound('User not found')
  }
  return toPublicUser(user)
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<User> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined
        ? { email: input.email === null ? null : input.email.trim().toLowerCase() }
        : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
  })
  return toPublicUser(user)
}

const PASSWORD_RESET_GENERIC_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.'

const PASSWORD_RESET_RATE_LIMIT_MS = 60 * 60 * 1000
const PASSWORD_RESET_RATE_LIMIT_COUNT = 3

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<{ message: string }> {
  const email = input.email.trim().toLowerCase()

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      deletedAt: null,
      isActive: true,
    },
  })

  if (!user?.email) {
    return { message: PASSWORD_RESET_GENERIC_MESSAGE }
  }

  const recentCount = await prisma.passwordResetToken.count({
    where: {
      userId: user.id,
      createdAt: { gte: new Date(Date.now() - PASSWORD_RESET_RATE_LIMIT_MS) },
    },
  })
  if (recentCount >= PASSWORD_RESET_RATE_LIMIT_COUNT) {
    return { message: PASSWORD_RESET_GENERIC_MESSAGE }
  }

  const rawToken = generateRefreshToken()
  const tokenHash = hashToken(rawToken)
  const expiresAt = addDuration(new Date(), env.PASSWORD_RESET_EXPIRES_IN)

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    }),
  ])

  const resetUrl = `${env.CLIENT_URL.replace(/\/$/, '')}/reset?token=${encodeURIComponent(rawToken)}`
  const emailContent = buildPasswordResetEmail(resetUrl, user.name)

  if (!env.SMTP_PASS) {
    console.info(
      `[auth] SMTP_PASS not set — email not sent. Dev reset link for ${user.email}:\n${resetUrl}`,
    )
  }

  void notifier
    .sendEmail({
      to: user.email,
      subject: emailContent.subject,
      body: emailContent.body,
      html: emailContent.html,
    })
    .catch((err: unknown) => {
      console.error('[auth] password reset email failed', err)
    })

  return { message: PASSWORD_RESET_GENERIC_MESSAGE }
}

export async function resetPassword(input: ResetPasswordInput): Promise<{ success: true }> {
  const tokenHash = hashToken(input.token.trim())
  const stored = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  })

  if (!stored || stored.user.deletedAt || !stored.user.isActive) {
    throw validationError('This password reset link is invalid or has expired.')
  }

  const passwordHash = await argon2.hash(input.newPassword)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: stored.userId, usedAt: null, id: { not: stored.id } },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  return { success: true }
}

export function toAuthResponse(session: AuthSession): AuthTokensResponse {
  return {
    user: session.user,
    accessToken: session.accessToken,
  }
}
