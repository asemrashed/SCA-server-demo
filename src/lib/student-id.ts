import { prisma } from '../config/db.js'
import { conflict } from './errors.js'
import { EnrollmentStatus, Role } from '../shared/enums.js'

/** Human-facing fallback from internal user id (legacy; prefer allocated unique IDs). */
export function formatScaStudentId(userId: string): string {
  const suffix = userId.replace(/\D/g, '').slice(-6) || userId.slice(-6).toUpperCase()
  return `SCA - ${suffix}`
}

/** Display ID: assigned value or SCA-prefixed fallback. */
export function resolveStudentDisplayId(
  studentUserId: string,
  assignedIdNumber?: string | null,
): string {
  const trimmed = assignedIdNumber?.trim()
  return trimmed || formatScaStudentId(studentUserId)
}

export function parseNumericStudentIdSuffix(idNumber: string): number {
  const scaMatch = idNumber.trim().match(/^SCA\s*-\s*(\d+)$/i)
  if (scaMatch) return Number.parseInt(scaMatch[1]!, 10)
  const digits = idNumber.replace(/\D/g, '')
  if (digits) return Number.parseInt(digits, 10)
  return 0
}

export function formatSequentialStudentId(sequence: number): string {
  return `SCA - ${String(sequence).padStart(6, '0')}`
}

async function isIdNumberAvailable(idNumber: string, exceptUserId?: string): Promise<boolean> {
  const taken = await prisma.user.findFirst({
    where: {
      idNumber,
      deletedAt: null,
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  })
  return !taken
}

async function maxAssignedStudentIdSuffix(): Promise<number> {
  const [users, enrollments] = await Promise.all([
    prisma.user.findMany({
      where: { idNumber: { not: null } },
      select: { idNumber: true },
    }),
    prisma.enrollment.findMany({
      where: { idNumber: { not: null } },
      select: { idNumber: true },
    }),
  ])

  let max = 0
  for (const row of [...users, ...enrollments]) {
    if (!row.idNumber) continue
    max = Math.max(max, parseNumericStudentIdSuffix(row.idNumber))
  }
  return max
}

/** Allocate a unique student ID, preferring `preferred` then CUID-based then sequential. */
export async function allocateStudentIdNumber(
  userId: string,
  preferred?: string,
): Promise<string> {
  const trimmed = preferred?.trim()
  if (trimmed && (await isIdNumberAvailable(trimmed))) {
    return trimmed
  }

  const fromUserId = formatScaStudentId(userId)
  if (await isIdNumberAvailable(fromUserId)) {
    return fromUserId
  }

  let sequence = (await maxAssignedStudentIdSuffix()) + 1
  while (!(await isIdNumberAvailable(formatSequentialStudentId(sequence)))) {
    sequence += 1
  }
  return formatSequentialStudentId(sequence)
}

export async function assertIdNumberAvailable(
  idNumber: string,
  exceptUserId?: string,
): Promise<void> {
  if (!(await isIdNumberAvailable(idNumber, exceptUserId))) {
    throw conflict(`Student ID "${idNumber}" is already assigned to another student`)
  }
}

/** Copy student ID onto all non-cancelled enrollments (keeps legacy column in sync). */
export async function syncEnrollmentIdNumbers(
  studentId: string,
  idNumber: string,
): Promise<number> {
  const result = await prisma.enrollment.updateMany({
    where: {
      studentId,
      status: { not: EnrollmentStatus.CANCELLED },
    },
    data: { idNumber },
  })
  return result.count
}

/**
 * Return the student's permanent ID, assigning one if missing.
 * Optionally accepts admin-provided `preferred` on first assignment.
 */
export async function ensureStudentHasIdNumber(
  userId: string,
  preferred?: string,
): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { id: userId, role: Role.STUDENT, deletedAt: null },
    select: { idNumber: true },
  })
  if (!user) {
    throw conflict('Student account not found')
  }

  if (user.idNumber) {
    await syncEnrollmentIdNumbers(userId, user.idNumber)
    return user.idNumber
  }

  const idNumber = await allocateStudentIdNumber(userId, preferred)
  await prisma.user.update({
    where: { id: userId },
    data: { idNumber },
  })
  await syncEnrollmentIdNumbers(userId, idNumber)
  return idNumber
}

/**
 * Set or validate student ID (admin paths). Existing ID cannot change to a different value.
 */
export async function resolveStudentIdNumberForAdmin(
  userId: string,
  inputIdNumber?: string,
): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { id: userId, role: Role.STUDENT, deletedAt: null },
    select: { idNumber: true },
  })
  if (!user) {
    throw conflict('Student account not found')
  }

  if (user.idNumber) {
    const trimmed = inputIdNumber?.trim()
    if (trimmed && trimmed !== user.idNumber) {
      throw conflict(
        `This student is already assigned ID "${user.idNumber}". Use the same ID for all enrollments.`,
      )
    }
    await syncEnrollmentIdNumbers(userId, user.idNumber)
    return user.idNumber
  }

  const idNumber = await allocateStudentIdNumber(
    userId,
    inputIdNumber?.trim() || undefined,
  )
  await assertIdNumberAvailable(idNumber, userId)
  await prisma.user.update({
    where: { id: userId },
    data: { idNumber },
  })
  await syncEnrollmentIdNumbers(userId, idNumber)
  return idNumber
}
