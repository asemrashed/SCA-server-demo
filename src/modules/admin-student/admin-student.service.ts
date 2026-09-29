import type { Prisma } from '@prisma/client'
import * as argon2 from 'argon2'
import { prisma } from '../../config/db.js'
import { conflict, notFound, validationError } from '../../lib/errors.js'
import {
  DeliveryMode,
  EnrollmentStatus,
  MonthlyPaymentStatus,
  Role,
} from '../../shared/enums.js'
import type {
  CreateAdminStudentInput,
  ListAdminStudentsQuery,
  UpdateAdminStudentInput,
} from '../../shared/schemas/admin-student.js'
import type { ApiListResponse } from '../../shared/types/index.js'
import { ensureStudentHasIdNumber } from '../../lib/student-id.js'

export interface AdminStudentListItem {
  id: string
  enrollmentId: string
  name: string
  avatarUrl: string | null
  phone: string
  email: string | null
  isActive: boolean
  idNumber: string | null
  isBlocked: boolean
  course: { id: string; title: string; deliveryMode: DeliveryMode } | null
  batch: { id: string; title: string } | null
  paidAmountMinor: number
  totalAmountMinor: number
  status: EnrollmentStatus
  enrolledAt: string
}

const studentEnrollmentInclude = {
  student: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      phone: true,
      email: true,
      isActive: true,
      deletedAt: true,
      role: true,
      idNumber: true,
    },
  },
  batch: {
    select: {
      id: true,
      title: true,
      priceMinor: true,
      course: {
        select: {
          id: true,
          title: true,
          deliveryMode: true,
        },
      },
    },
  },
  course: {
    select: {
      id: true,
      title: true,
      priceMinor: true,
      deliveryMode: true,
    },
  },
  monthlyPayments: {
    where: { status: MonthlyPaymentStatus.APPROVED },
    select: { amountMinor: true },
  },
} satisfies Prisma.EnrollmentInclude

type StudentEnrollmentRow = Prisma.EnrollmentGetPayload<{
  include: typeof studentEnrollmentInclude
}>

function parseSort(sort?: string): Prisma.EnrollmentOrderByWithRelationInput {
  if (!sort) return { enrolledAt: 'desc' }
  const [field, dir] = sort.split(':')
  const direction = dir === 'asc' ? 'asc' : 'desc'
  if (field === 'name') return { student: { name: direction } }
  if (field === 'enrolledAt') return { enrolledAt: direction }
  return { enrolledAt: 'desc' }
}

function toListItem(row: StudentEnrollmentRow): AdminStudentListItem {
  const isLive = Boolean(row.batchId && row.batch)
  const course = isLive
    ? row.batch!.course
      ? {
          id: row.batch!.course.id,
          title: row.batch!.course.title,
          deliveryMode: row.batch!.course.deliveryMode as DeliveryMode,
        }
      : null
    : row.course
      ? {
          id: row.course.id,
          title: row.course.title,
          deliveryMode: row.course.deliveryMode as DeliveryMode,
        }
      : null

  const paidAmountMinor = row.monthlyPayments.reduce(
    (sum, payment) => sum + (payment.amountMinor ?? 0),
    0,
  )
  const totalAmountMinor = row.batch?.priceMinor ?? row.course?.priceMinor ?? 0

  return {
    id: row.student.id,
    enrollmentId: row.id,
    name: row.student.name,
    avatarUrl: row.student.avatarUrl,
    phone: row.student.phone,
    email: row.student.email,
    isActive: row.student.isActive,
    idNumber: row.student.idNumber ?? row.idNumber,
    isBlocked: row.isBlocked,
    course,
    batch: row.batch ? { id: row.batch.id, title: row.batch.title } : null,
    paidAmountMinor,
    totalAmountMinor,
    status: row.status as EnrollmentStatus,
    enrolledAt: row.enrolledAt.toISOString(),
  }
}

function buildWhere(query: ListAdminStudentsQuery): Prisma.EnrollmentWhereInput {
  const search = query.search?.trim()
  const and: Prisma.EnrollmentWhereInput[] = [
    { status: { not: EnrollmentStatus.CANCELLED } },
    { student: { role: Role.STUDENT, deletedAt: null } },
  ]

  if (query.batchId) {
    and.push({ batchId: query.batchId })
  }

  if (query.courseId) {
    and.push({
      OR: [{ courseId: query.courseId }, { batch: { courseId: query.courseId } }],
    })
  }

  if (search) {
    and.push({
      OR: [
        { student: { name: { contains: search, mode: 'insensitive' } } },
        { student: { id: { contains: search, mode: 'insensitive' } } },
        { student: { idNumber: { contains: search, mode: 'insensitive' } } },
        { idNumber: { contains: search, mode: 'insensitive' } },
        { student: { phone: { contains: search } } },
      ],
    })
  }

  return { AND: and }
}

export async function listAdminStudents(
  query: ListAdminStudentsQuery,
): Promise<ApiListResponse<AdminStudentListItem>> {
  const where = buildWhere(query)
  const skip = (query.page - 1) * query.pageSize

  const [total, rows] = await prisma.$transaction([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      include: studentEnrollmentInclude,
      orderBy: parseSort(query.sort),
      skip,
      take: query.pageSize,
    }),
  ])

  return {
    data: rows.map(toListItem),
    meta: { page: query.page, pageSize: query.pageSize, total },
  }
}

export async function createAdminStudent(
  input: CreateAdminStudentInput,
): Promise<{ id: string; name: string; phone: string; email: string | null; isActive: boolean; idNumber: string }> {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } })
  if (existing && !existing.deletedAt) {
    throw conflict('Phone number is already registered')
  }

  if (input.email) {
    const emailTaken = await prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
    })
    if (emailTaken) {
      throw conflict('Email is already registered')
    }
  }

  const passwordHash = await argon2.hash(input.password)

  if (existing?.deletedAt) {
    const restored = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        email: input.email ?? null,
        passwordHash,
        role: Role.STUDENT,
        phoneVerified: true,
        isActive: true,
        deletedAt: null,
      },
    })
    const idNumber = await ensureStudentHasIdNumber(restored.id)
    return {
      id: restored.id,
      name: restored.name,
      phone: restored.phone,
      email: restored.email,
      isActive: restored.isActive,
      idNumber,
    }
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      passwordHash,
      role: Role.STUDENT,
      phoneVerified: true,
    },
  })

  const idNumber = await ensureStudentHasIdNumber(user.id)

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    isActive: user.isActive,
    idNumber,
  }
}

async function findStudentOrThrow(userId: string) {
  const student = await prisma.user.findFirst({
    where: { id: userId, role: Role.STUDENT, deletedAt: null },
  })
  if (!student) {
    throw notFound('Student not found')
  }
  return student
}

export async function updateAdminStudent(userId: string, input: UpdateAdminStudentInput) {
  const student = await findStudentOrThrow(userId)

  if (input.phone && input.phone !== student.phone) {
    const phoneTaken = await prisma.user.findFirst({
      where: { phone: input.phone, deletedAt: null, id: { not: userId } },
    })
    if (phoneTaken) {
      throw conflict('Phone number is already registered')
    }
  }

  if (input.email !== undefined && input.email && input.email !== student.email) {
    const emailTaken = await prisma.user.findFirst({
      where: { email: input.email, deletedAt: null, id: { not: userId } },
    })
    if (emailTaken) {
      throw conflict('Email is already registered')
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  })

  return {
    id: updated.id,
    name: updated.name,
    phone: updated.phone,
    email: updated.email,
    avatarUrl: updated.avatarUrl,
    isActive: updated.isActive,
  }
}

export async function deleteAdminStudent(userId: string): Promise<void> {
  await findStudentOrThrow(userId)
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date(), isActive: false },
  })
}

export async function setEnrollmentBlocked(
  enrollmentId: string,
  blocked: boolean,
): Promise<AdminStudentListItem> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: studentEnrollmentInclude,
  })
  if (!enrollment || enrollment.student.deletedAt || enrollment.student.role !== Role.STUDENT) {
    throw notFound('Student enrollment not found')
  }
  if (enrollment.status === EnrollmentStatus.CANCELLED) {
    throw validationError('Cannot block a cancelled enrollment')
  }
  if (enrollment.status !== EnrollmentStatus.ACTIVE && blocked) {
    throw validationError('Only active enrollments can be blocked')
  }

  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { isBlocked: blocked },
    include: studentEnrollmentInclude,
  })

  return toListItem(updated)
}

export interface BoundDeviceListItem {
  id: string
  deviceType: 'MOBILE' | 'DESKTOP'
  userAgent: string | null
  boundAt: string
  lastSeenAt: string
}

export interface DeviceLoginAttemptListItem {
  id: string
  deviceType: 'MOBILE' | 'DESKTOP'
  userAgent: string | null
  ip: string | null
  createdAt: string
}

export async function listBoundDevices(userId: string): Promise<{
  devices: BoundDeviceListItem[]
  recentBlockedAttempts: DeviceLoginAttemptListItem[]
}> {
  await findStudentOrThrow(userId)

  const [devices, attempts] = await Promise.all([
    prisma.boundDevice.findMany({
      where: { userId },
      orderBy: { boundAt: 'asc' },
    }),
    prisma.deviceLoginAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  return {
    devices: devices.map((d) => ({
      id: d.id,
      deviceType: d.deviceType as 'MOBILE' | 'DESKTOP',
      userAgent: d.userAgent,
      boundAt: d.boundAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
    })),
    recentBlockedAttempts: attempts.map((a) => ({
      id: a.id,
      deviceType: a.deviceType as 'MOBILE' | 'DESKTOP',
      userAgent: a.userAgent,
      ip: a.ip,
      createdAt: a.createdAt.toISOString(),
    })),
  }
}

/** Remove one bound device so the student can lock a new one of that type. */
export async function removeBoundDevice(
  userId: string,
  deviceId: string,
): Promise<{ success: true }> {
  await findStudentOrThrow(userId)

  const device = await prisma.boundDevice.findFirst({
    where: { id: deviceId, userId },
  })
  if (!device) {
    throw notFound('Bound device not found')
  }

  await prisma.$transaction([
    prisma.boundDevice.delete({ where: { id: device.id } }),
    // Force re-login everywhere; remaining device re-binds via matching cookie.
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  return { success: true }
}
