import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/db.js'
import { adminWhatsappPhone } from '../../config/env.js'
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js'
import {
  EnrollmentKind,
  EnrollmentStatus,
  MonthlyPaymentStatus,
} from '../../shared/enums.js'
import type {
  CreateManualPaymentInput,
  ListMonthlyPaymentsQuery,
  ReviewMonthlyPaymentInput,
  SetPaymentAccessInput,
  UpdateManualPaymentInput,
} from '../../shared/schemas/monthly-payment.js'
import {
  currentBillingMonth,
  ENROLLMENT_BILLING_MONTH,
  computeIsFullyPaid,
  isAdminWaiverPayment,
  isEnrollmentPaymentBlocked,
  isPastPaymentDeadline,
  paymentDeadlineIso,
  paymentHistoryStatusLabel,
  remainingBalanceMinor,
} from './monthly-payment.utils.js'

export interface MonthlyPaymentStudentDto {
  id: string
  name: string
  phone: string
  idNumber: string | null
}

export interface MonthlyPaymentEnrollmentDto {
  id: string
  kind: EnrollmentKind
  status: EnrollmentStatus
  idNumber: string | null
  isFullyPaid: boolean
  isBlocked: boolean
  courseTitle: string
  batchTitle: string | null
  courseId: string | null
  batchId: string | null
  priceMinor: number
}

export interface MonthlyPaymentDto {
  id: string
  billingMonth: string
  amountMinor: number | null
  status: MonthlyPaymentStatus
  note: string | null
  requestedAt: string
  reviewedAt: string | null
  student: MonthlyPaymentStudentDto
  enrollment: MonthlyPaymentEnrollmentDto
}

export interface EnrollmentPaymentHistoryItem {
  id: string
  type: 'MONTHLY' | 'ENROLLMENT' | 'FULL'
  billingMonth: string | null
  amountMinor: number
  status: string
  paidAt: string | null
  createdAt: string
  isAdminWaiver?: boolean
}

export interface EnrollmentPaymentHistoryDto {
  enrollment: MonthlyPaymentEnrollmentDto
  currentBillingMonth: string
  paymentDeadline: string
  isPastDeadline: boolean
  isAccessBlocked: boolean
  isCurrentMonthPaid: boolean
  isFullyPaid: boolean
  canRequestCurrentMonth: boolean
  currentMonthRequest: MonthlyPaymentDto | null
  whatsappUrl: string
  history: EnrollmentPaymentHistoryItem[]
}

export interface UnpaidStudentDto {
  billingMonth: string
  paymentDeadline: string
  isPastDeadline: boolean
  isAccessBlocked: boolean
  hasAccessGrant: boolean
  isBlocked: boolean
  student: MonthlyPaymentStudentDto
  enrollment: MonthlyPaymentEnrollmentDto
  currentMonthRequest: MonthlyPaymentDto | null
}

const enrollmentSelect = {
  id: true,
  studentId: true,
  status: true,
  idNumber: true,
  isFullyPaid: true,
  isBlocked: true,
  batchId: true,
  courseId: true,
  batch: {
    select: {
      id: true,
      title: true,
      priceMinor: true,
      course: { select: { id: true, title: true } },
    },
  },
  course: { select: { id: true, title: true, priceMinor: true } },
} satisfies Prisma.EnrollmentSelect

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof enrollmentSelect }>

const monthlyPaymentInclude = {
  student: { select: { id: true, name: true, phone: true, idNumber: true } },
  enrollment: { select: enrollmentSelect },
} satisfies Prisma.MonthlyPaymentInclude

type MonthlyPaymentRow = Prisma.MonthlyPaymentGetPayload<{
  include: typeof monthlyPaymentInclude
}>

function formatBillingMonthLabel(billingMonth: string): string {
  const [year, month] = billingMonth.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function resolveEnrollmentPriceMinor(row: EnrollmentRow): number {
  if (row.batchId && row.batch) return row.batch.priceMinor
  if (row.courseId && row.course) return row.course.priceMinor
  return 0
}

function toEnrollmentDto(row: EnrollmentRow): MonthlyPaymentEnrollmentDto {
  const priceMinor = resolveEnrollmentPriceMinor(row)
  if (row.batchId && row.batch) {
    return {
      id: row.id,
      kind: EnrollmentKind.BATCH,
      status: row.status as EnrollmentStatus,
      idNumber: row.idNumber,
      isFullyPaid: row.isFullyPaid,
      isBlocked: row.isBlocked,
      courseTitle: row.batch.course.title,
      batchTitle: row.batch.title,
      courseId: row.batch.course.id,
      batchId: row.batch.id,
      priceMinor,
    }
  }
  if (row.courseId && row.course) {
    return {
      id: row.id,
      kind: EnrollmentKind.COURSE,
      status: row.status as EnrollmentStatus,
      idNumber: row.idNumber,
      isFullyPaid: row.isFullyPaid,
      isBlocked: row.isBlocked,
      courseTitle: row.course.title,
      batchTitle: null,
      courseId: row.course.id,
      batchId: null,
      priceMinor,
    }
  }
  throw notFound('Enrollment product not found')
}

function toMonthlyPaymentDto(row: MonthlyPaymentRow): MonthlyPaymentDto {
  return {
    id: row.id,
    billingMonth: row.billingMonth,
    amountMinor: row.amountMinor,
    status: row.status as MonthlyPaymentStatus,
    note: row.note,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    student: {
      id: row.student.id,
      name: row.student.name,
      phone: row.student.phone,
      idNumber: row.student.idNumber ?? row.enrollment.idNumber,
    },
    enrollment: toEnrollmentDto(row.enrollment),
  }
}

function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('880') ? digits : `880${digits.replace(/^0/, '')}`
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`
}

function buildPaymentRequestMessage(
  studentName: string,
  enrollment: MonthlyPaymentEnrollmentDto,
  billingMonth: string,
): string {
  const product =
    enrollment.kind === EnrollmentKind.BATCH
      ? `${enrollment.courseTitle} · ${enrollment.batchTitle}`
      : enrollment.courseTitle
  const idLabel = enrollment.idNumber ? ` (ID: ${enrollment.idNumber})` : ''
  return `Hello, I would like to pay my monthly fee for ${formatBillingMonthLabel(billingMonth)}.\n\nStudent: ${studentName}${idLabel}\nCourse: ${product}`
}

export function whatsappUrlForRequest(
  studentName: string,
  enrollment: MonthlyPaymentEnrollmentDto,
  billingMonth: string,
): string {
  return buildWhatsAppUrl(
    adminWhatsappPhone(),
    buildPaymentRequestMessage(studentName, enrollment, billingMonth),
  )
}

async function getActiveEnrollmentForStudent(
  studentId: string,
  enrollmentId: string,
): Promise<EnrollmentRow> {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      id: enrollmentId,
      studentId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    },
    select: enrollmentSelect,
  })
  if (!enrollment) {
    throw notFound('Enrollment not found')
  }
  return enrollment
}

async function loadMonthlyPayment(id: string): Promise<MonthlyPaymentRow> {
  const row = await prisma.monthlyPayment.findUnique({
    where: { id },
    include: monthlyPaymentInclude,
  })
  if (!row) {
    throw notFound('Payment request not found')
  }
  return row
}

export async function getAdminEnrollmentPaymentHistory(
  enrollmentId: string,
): Promise<EnrollmentPaymentHistoryDto> {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      id: enrollmentId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    },
    select: enrollmentSelect,
  })
  if (!enrollment) {
    throw notFound('Enrollment not found')
  }
  return getEnrollmentPaymentHistory(enrollment.studentId, enrollmentId)
}

async function getActiveEnrollmentForAdmin(enrollmentId: string): Promise<EnrollmentRow> {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      id: enrollmentId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    },
    select: enrollmentSelect,
  })
  if (!enrollment) {
    throw notFound('Enrollment not found')
  }
  return enrollment
}

async function sumApprovedPaymentsMinor(
  enrollmentId: string,
  excludePaymentId?: string,
): Promise<number> {
  const agg = await prisma.monthlyPayment.aggregate({
    where: {
      enrollmentId,
      status: MonthlyPaymentStatus.APPROVED,
      amountMinor: { not: null },
      ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
    },
    _sum: { amountMinor: true },
  })
  return agg._sum.amountMinor ?? 0
}

async function assertPaymentWithinRemaining(
  enrollmentId: string,
  priceMinor: number,
  amountMinor: number,
  excludePaymentId?: string,
): Promise<void> {
  if (priceMinor <= 0) return
  if (amountMinor > priceMinor) {
    throw validationError('Payment amount cannot exceed the course or batch price')
  }
  const alreadyPaid = await sumApprovedPaymentsMinor(enrollmentId, excludePaymentId)
  const remaining = remainingBalanceMinor(priceMinor, alreadyPaid)
  if (amountMinor > remaining) {
    throw validationError(
      `Payment amount cannot exceed the remaining balance (${Math.round(remaining / 100)} TK)`,
    )
  }
}

/**
 * Sets isFullyPaid from cumulative approved payments (not a single installment).
 * Call after the payment row is already APPROVED in DB.
 */
async function syncEnrollmentFullyPaid(
  enrollment: EnrollmentRow,
  markFullyPaid?: boolean,
): Promise<void> {
  const priceMinor = resolveEnrollmentPriceMinor(enrollment)
  const paidSumMinor = await sumApprovedPaymentsMinor(enrollment.id)
  const nextFullyPaid = computeIsFullyPaid(priceMinor, paidSumMinor, markFullyPaid)
  if (nextFullyPaid === enrollment.isFullyPaid) return
  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { isFullyPaid: nextFullyPaid },
  })
}

function resolveManualBillingMonth(
  enrollment: EnrollmentRow,
  billingMonth: string,
): string {
  if (enrollment.batchId) {
    return billingMonth
  }
  return ENROLLMENT_BILLING_MONTH
}

export async function createManualPayment(
  adminId: string,
  input: CreateManualPaymentInput,
): Promise<MonthlyPaymentDto> {
  const enrollment = await getActiveEnrollmentForAdmin(input.enrollmentId)
  const billingMonth = resolveManualBillingMonth(enrollment, input.billingMonth)
  const priceMinor = resolveEnrollmentPriceMinor(enrollment)

  const existing = await prisma.monthlyPayment.findUnique({
    where: {
      enrollmentId_billingMonth: {
        enrollmentId: enrollment.id,
        billingMonth,
      },
    },
  })

  if (existing?.status === MonthlyPaymentStatus.APPROVED) {
    throw conflict('A payment for this month already exists. Use Edit payment instead.')
  }

  await assertPaymentWithinRemaining(
    enrollment.id,
    priceMinor,
    input.amountMinor,
    existing?.id,
  )

  const row = existing
    ? await prisma.monthlyPayment.update({
        where: { id: existing.id },
        data: {
          status: MonthlyPaymentStatus.APPROVED,
          amountMinor: input.amountMinor,
          note: input.note ?? null,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
        include: monthlyPaymentInclude,
      })
    : await prisma.monthlyPayment.create({
        data: {
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          billingMonth,
          amountMinor: input.amountMinor,
          status: MonthlyPaymentStatus.APPROVED,
          note: input.note ?? null,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
        include: monthlyPaymentInclude,
      })

  await syncEnrollmentFullyPaid(enrollment, input.markFullyPaid)

  const refreshed = await loadMonthlyPayment(row.id)
  return toMonthlyPaymentDto(refreshed)
}

export async function updateManualPayment(
  adminId: string,
  paymentId: string,
  input: UpdateManualPaymentInput,
): Promise<MonthlyPaymentDto> {
  const existing = await loadMonthlyPayment(paymentId)

  if (existing.status !== MonthlyPaymentStatus.APPROVED) {
    throw validationError('Only approved payments can be edited')
  }

  const enrollment = existing.enrollment
  const priceMinor = resolveEnrollmentPriceMinor(enrollment)
  const nextAmountMinor = input.amountMinor ?? existing.amountMinor ?? 0

  await assertPaymentWithinRemaining(
    enrollment.id,
    priceMinor,
    nextAmountMinor,
    existing.id,
  )

  const nextBillingMonth = input.billingMonth
    ? resolveManualBillingMonth(enrollment, input.billingMonth)
    : existing.billingMonth

  if (nextBillingMonth !== existing.billingMonth) {
    const conflictRow = await prisma.monthlyPayment.findUnique({
      where: {
        enrollmentId_billingMonth: {
          enrollmentId: enrollment.id,
          billingMonth: nextBillingMonth,
        },
      },
    })
    if (conflictRow && conflictRow.id !== existing.id) {
      throw conflict('Another payment already exists for the selected month')
    }
  }

  const row = await prisma.monthlyPayment.update({
    where: { id: paymentId },
    data: {
      ...(input.billingMonth ? { billingMonth: nextBillingMonth } : {}),
      ...(input.amountMinor != null ? { amountMinor: input.amountMinor } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      reviewedAt: new Date(),
      reviewedById: adminId,
    },
    include: monthlyPaymentInclude,
  })

  await syncEnrollmentFullyPaid(enrollment, input.markFullyPaid)

  const refreshed = await loadMonthlyPayment(row.id)
  return toMonthlyPaymentDto(refreshed)
}

export async function getEnrollmentPaymentHistory(
  studentId: string,
  enrollmentId: string,
): Promise<EnrollmentPaymentHistoryDto> {
  const enrollment = await getActiveEnrollmentForStudent(studentId, enrollmentId)
  const enrollmentDto = toEnrollmentDto(enrollment)
  const billingMonth = currentBillingMonth()

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { name: true },
  })
  if (!student) {
    throw notFound('User not found')
  }

  const [monthlyRows, enrollmentFeeRow, currentRequest] = await Promise.all([
    prisma.monthlyPayment.findMany({
      where: {
        enrollmentId,
        status: MonthlyPaymentStatus.APPROVED,
        billingMonth: { not: ENROLLMENT_BILLING_MONTH },
      },
      orderBy: [{ billingMonth: 'desc' }, { reviewedAt: 'desc' }],
    }),
    prisma.monthlyPayment.findUnique({
      where: {
        enrollmentId_billingMonth: {
          enrollmentId,
          billingMonth: ENROLLMENT_BILLING_MONTH,
        },
      },
    }),
    prisma.monthlyPayment.findUnique({
      where: {
        enrollmentId_billingMonth: { enrollmentId, billingMonth },
      },
      include: monthlyPaymentInclude,
    }),
  ])

  const history: EnrollmentPaymentHistoryItem[] = monthlyRows
    .map((row) => {
      const amountMinor = row.amountMinor ?? 0
      const priceMinor = resolveEnrollmentPriceMinor(enrollment)
      const isAdminWaiver = isAdminWaiverPayment(amountMinor, priceMinor, enrollment.isFullyPaid)
      return {
        id: row.id,
        type: 'MONTHLY' as const,
        billingMonth: row.billingMonth,
        amountMinor,
        status: paymentHistoryStatusLabel(
          amountMinor,
          priceMinor,
          enrollment.isFullyPaid,
          row.status,
        ),
        paidAt: row.reviewedAt?.toISOString() ?? null,
        createdAt: row.requestedAt.toISOString(),
        ...(isAdminWaiver ? { isAdminWaiver: true } : {}),
      }
    })

  if (enrollmentFeeRow?.status === MonthlyPaymentStatus.APPROVED && enrollmentFeeRow.amountMinor) {
    const amountMinor = enrollmentFeeRow.amountMinor
    const priceMinor = resolveEnrollmentPriceMinor(enrollment)
    const isAdminWaiver = isAdminWaiverPayment(amountMinor, priceMinor, enrollment.isFullyPaid)
    const isFull = enrollment.isFullyPaid
    history.push({
      id: enrollmentFeeRow.id,
      type: isFull ? 'FULL' : 'ENROLLMENT',
      billingMonth: null,
      amountMinor,
      status: paymentHistoryStatusLabel(
        amountMinor,
        priceMinor,
        enrollment.isFullyPaid,
        isFull ? 'FULL_PAID' : enrollmentFeeRow.status,
      ),
      paidAt: enrollmentFeeRow.reviewedAt?.toISOString() ?? null,
      createdAt: enrollmentFeeRow.requestedAt.toISOString(),
      ...(isAdminWaiver ? { isAdminWaiver: true } : {}),
    })
  }

  history.sort((a, b) => {
      const aTime = new Date(a.paidAt ?? a.createdAt).getTime()
      const bTime = new Date(b.paidAt ?? b.createdAt).getTime()
      return bTime - aTime
    })

  const isFullyPaidFlag = enrollment.isFullyPaid
  const paidSumMinor = await sumApprovedPaymentsMinor(enrollmentId)
  const priceMinor = resolveEnrollmentPriceMinor(enrollment)
  const isFullyPaid =
    isFullyPaidFlag || computeIsFullyPaid(priceMinor, paidSumMinor)

  if (isFullyPaid && !isFullyPaidFlag) {
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { isFullyPaid: true },
    })
    enrollment.isFullyPaid = true
  }

  const canRequestCurrentMonth =
    !isFullyPaid &&
    (!currentRequest || currentRequest.status === MonthlyPaymentStatus.REJECTED)

  const isCurrentMonthPaid =
    isFullyPaid || currentRequest?.status === MonthlyPaymentStatus.APPROVED
  const isPastDeadline = isPastPaymentDeadline(undefined, billingMonth)
  const isAccessBlocked = await isEnrollmentPaymentBlocked(enrollmentId, enrollment.batchId)

  return {
    enrollment: {
      ...enrollmentDto,
      isFullyPaid,
    },
    currentBillingMonth: billingMonth,
    paymentDeadline: paymentDeadlineIso(billingMonth),
    isPastDeadline,
    isAccessBlocked,
    isCurrentMonthPaid,
    isFullyPaid,
    canRequestCurrentMonth,
    currentMonthRequest: currentRequest ? toMonthlyPaymentDto(currentRequest) : null,
    whatsappUrl: whatsappUrlForRequest(student.name, enrollmentDto, billingMonth),
    history,
  }
}

export async function requestMonthlyPayment(
  studentId: string,
  enrollmentId: string,
): Promise<{ payment: MonthlyPaymentDto; whatsappUrl: string }> {
  const enrollment = await getActiveEnrollmentForStudent(studentId, enrollmentId)
  const priceMinor = resolveEnrollmentPriceMinor(enrollment)
  const paidSumMinor = await sumApprovedPaymentsMinor(enrollmentId)

  // Heal stale isFullyPaid when installments already cover the price.
  if (!enrollment.isFullyPaid && computeIsFullyPaid(priceMinor, paidSumMinor)) {
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { isFullyPaid: true },
    })
    enrollment.isFullyPaid = true
  }

  if (enrollment.isFullyPaid || computeIsFullyPaid(priceMinor, paidSumMinor)) {
    throw conflict('This enrollment is fully paid; monthly payments are not required')
  }
  const enrollmentDto = toEnrollmentDto(enrollment)
  const billingMonth = currentBillingMonth()

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { name: true },
  })
  if (!student) {
    throw notFound('User not found')
  }

  const existing = await prisma.monthlyPayment.findUnique({
    where: {
      enrollmentId_billingMonth: { enrollmentId, billingMonth },
    },
    include: monthlyPaymentInclude,
  })

  if (existing?.status === MonthlyPaymentStatus.APPROVED) {
    throw conflict('Monthly fee for this month is already paid')
  }

  if (existing?.status === MonthlyPaymentStatus.REQUESTED) {
    return {
      payment: toMonthlyPaymentDto(existing),
      whatsappUrl: whatsappUrlForRequest(student.name, enrollmentDto, billingMonth),
    }
  }

  const row = existing
    ? await prisma.monthlyPayment.update({
        where: { id: existing.id },
        data: {
          status: MonthlyPaymentStatus.REQUESTED,
          amountMinor: null,
          note: null,
          reviewedAt: null,
          reviewedById: null,
          requestedAt: new Date(),
        },
        include: monthlyPaymentInclude,
      })
    : await prisma.monthlyPayment.create({
        data: {
          enrollmentId,
          studentId,
          billingMonth,
        },
        include: monthlyPaymentInclude,
      })

  return {
    payment: toMonthlyPaymentDto(row),
    whatsappUrl: whatsappUrlForRequest(student.name, enrollmentDto, billingMonth),
  }
}

function buildListWhere(query: ListMonthlyPaymentsQuery): Prisma.MonthlyPaymentWhereInput {
  const where: Prisma.MonthlyPaymentWhereInput = {}

  if (query.status) {
    where.status = query.status
  }

  const enrollmentWhere: Prisma.EnrollmentWhereInput = {}

  if (query.batchId) {
    enrollmentWhere.batchId = query.batchId
  } else if (query.courseId) {
    enrollmentWhere.OR = [
      { courseId: query.courseId },
      { batch: { courseId: query.courseId } },
    ]
  }

  if (Object.keys(enrollmentWhere).length > 0) {
    where.enrollment = enrollmentWhere
  }

  if (query.search) {
    const term = query.search.trim()
    where.OR = [
      { student: { name: { contains: term, mode: 'insensitive' } } },
      { student: { phone: { contains: term } } },
      { enrollment: { idNumber: { contains: term, mode: 'insensitive' } } },
      { enrollment: { id: term } },
      { student: { id: term } },
    ]
  }

  return where
}

export async function listMonthlyPayments(
  query: ListMonthlyPaymentsQuery,
): Promise<{ data: MonthlyPaymentDto[]; meta: { total: number; page: number; pageSize: number } }> {
  const where = buildListWhere(query)
  const skip = (query.page - 1) * query.pageSize

  const [rows, total] = await Promise.all([
    prisma.monthlyPayment.findMany({
      where,
      include: monthlyPaymentInclude,
      orderBy: [{ requestedAt: 'desc' }],
      skip,
      take: query.pageSize,
    }),
    prisma.monthlyPayment.count({ where }),
  ])

  return {
    data: rows.map(toMonthlyPaymentDto),
    meta: { total, page: query.page, pageSize: query.pageSize },
  }
}

export interface AdminPaymentSummaryDto {
  totalRevenueMinor: number
  totalDueMinor: number
  currentBillingMonth: string
  unpaidStudentCount: number
}

export async function getAdminPaymentSummary(): Promise<AdminPaymentSummaryDto> {
  const billingMonth = currentBillingMonth()

  const [revenueAgg, approvedRows] = await Promise.all([
    prisma.monthlyPayment.aggregate({
      where: {
        status: MonthlyPaymentStatus.APPROVED,
        amountMinor: { not: null },
      },
      _sum: { amountMinor: true },
    }),
    prisma.monthlyPayment.findMany({
      where: { billingMonth, status: MonthlyPaymentStatus.APPROVED },
      select: { enrollmentId: true },
    }),
  ])

  const paidEnrollmentIds = approvedRows.map((row) => row.enrollmentId)
  const unpaidWhere = buildUnpaidEnrollmentWhere(
    { page: 1, pageSize: 1 },
    paidEnrollmentIds,
  )

  const unpaidEnrollments = await prisma.enrollment.findMany({
    where: unpaidWhere,
    select: { batch: { select: { priceMinor: true } } },
  })

  const totalDueMinor = unpaidEnrollments.reduce(
    (sum, row) => sum + (row.batch?.priceMinor ?? 0),
    0,
  )

  return {
    totalRevenueMinor: revenueAgg._sum.amountMinor ?? 0,
    totalDueMinor,
    currentBillingMonth: billingMonth,
    unpaidStudentCount: unpaidEnrollments.length,
  }
}

export async function reviewMonthlyPayment(
  adminId: string,
  paymentId: string,
  input: ReviewMonthlyPaymentInput,
): Promise<MonthlyPaymentDto> {
  const existing = await loadMonthlyPayment(paymentId)

  if (existing.status !== MonthlyPaymentStatus.REQUESTED) {
    throw validationError('Only pending payment requests can be reviewed')
  }

  if (input.action === 'approve') {
    const enrollment = existing.enrollment
    const priceMinor = resolveEnrollmentPriceMinor(enrollment)
    const nextBillingMonth = input.billingMonth ?? existing.billingMonth

    if (nextBillingMonth !== existing.billingMonth) {
      const conflictRow = await prisma.monthlyPayment.findUnique({
        where: {
          enrollmentId_billingMonth: {
            enrollmentId: enrollment.id,
            billingMonth: nextBillingMonth,
          },
        },
      })
      if (conflictRow && conflictRow.id !== paymentId) {
        throw conflict('Another payment already exists for the selected month')
      }
    }

    await assertPaymentWithinRemaining(
      enrollment.id,
      priceMinor,
      input.amountMinor,
      paymentId,
    )

    await prisma.monthlyPayment.update({
      where: { id: paymentId },
      data: {
        status: MonthlyPaymentStatus.APPROVED,
        amountMinor: input.amountMinor,
        billingMonth: nextBillingMonth,
        note: input.note ?? null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
      include: monthlyPaymentInclude,
    })
    await syncEnrollmentFullyPaid(enrollment, input.markFullyPaid)
    const refreshed = await loadMonthlyPayment(paymentId)
    return toMonthlyPaymentDto(refreshed)
  }

  const row = await prisma.monthlyPayment.update({
    where: { id: paymentId },
    data: {
      status: MonthlyPaymentStatus.REJECTED,
      note: input.note ?? null,
      reviewedAt: new Date(),
      reviewedById: adminId,
    },
    include: monthlyPaymentInclude,
  })
  return toMonthlyPaymentDto(row)
}

function buildUnpaidEnrollmentWhere(
  query: ListMonthlyPaymentsQuery,
  paidEnrollmentIds: string[],
): Prisma.EnrollmentWhereInput {
  const where: Prisma.EnrollmentWhereInput = {
    status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    batchId: { not: null },
    isFullyPaid: false,
    id: { notIn: paidEnrollmentIds },
  }

  if (query.batchId) {
    where.batchId = query.batchId
  } else if (query.courseId) {
    where.batch = { courseId: query.courseId }
  }

  if (query.search) {
    const term = query.search.trim()
    where.AND = [
      {
        OR: [
          { student: { name: { contains: term, mode: 'insensitive' } } },
          { student: { phone: { contains: term } } },
          { idNumber: { contains: term, mode: 'insensitive' } },
          { id: term },
          { student: { id: term } },
        ],
      },
    ]
  }

  return where
}

export async function listUnpaidStudents(
  query: ListMonthlyPaymentsQuery,
): Promise<{ data: UnpaidStudentDto[]; meta: { total: number; page: number; pageSize: number } }> {
  const billingMonth = currentBillingMonth()
  const deadline = paymentDeadlineIso(billingMonth)
  const pastDeadline = isPastPaymentDeadline(undefined, billingMonth)
  const skip = (query.page - 1) * query.pageSize

  const approvedRows = await prisma.monthlyPayment.findMany({
    where: { billingMonth, status: MonthlyPaymentStatus.APPROVED },
    select: { enrollmentId: true },
  })
  const paidEnrollmentIds = approvedRows.map((row) => row.enrollmentId)
  const where = buildUnpaidEnrollmentWhere(query, paidEnrollmentIds)

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      select: {
        ...enrollmentSelect,
        student: { select: { id: true, name: true, phone: true, idNumber: true } },
      },
      orderBy: [{ enrolledAt: 'desc' }],
      skip,
      take: query.pageSize,
    }),
    prisma.enrollment.count({ where }),
  ])

  const enrollmentIds = enrollments.map((row) => row.id)
  const currentRequests = enrollmentIds.length
    ? await prisma.monthlyPayment.findMany({
        where: { enrollmentId: { in: enrollmentIds }, billingMonth },
        include: monthlyPaymentInclude,
      })
    : []
  const requestByEnrollmentId = new Map(
    currentRequests.map((row) => [row.enrollmentId, row]),
  )

  const accessGrants = enrollmentIds.length
    ? await prisma.monthlyPaymentAccessGrant.findMany({
        where: { enrollmentId: { in: enrollmentIds }, billingMonth },
        select: { enrollmentId: true },
      })
    : []
  const grantedEnrollmentIds = new Set(accessGrants.map((row) => row.enrollmentId))

  const data: UnpaidStudentDto[] = await Promise.all(
    enrollments.map(async (row) => {
      const enrollmentDto = toEnrollmentDto(row)
      const currentRequest = requestByEnrollmentId.get(row.id)
      const hasAccessGrant = grantedEnrollmentIds.has(row.id)
      const isAccessBlocked = await isEnrollmentPaymentBlocked(row.id, row.batchId)

      return {
        billingMonth,
        paymentDeadline: deadline,
        isPastDeadline: pastDeadline,
        isAccessBlocked,
        hasAccessGrant,
        isBlocked: row.isBlocked,
        student: {
          id: row.student.id,
          name: row.student.name,
          phone: row.student.phone,
          idNumber: row.student.idNumber ?? row.idNumber,
        },
        enrollment: enrollmentDto,
        currentMonthRequest: currentRequest ? toMonthlyPaymentDto(currentRequest) : null,
      }
    }),
  )

  return {
    data,
    meta: { total, page: query.page, pageSize: query.pageSize },
  }
}

export interface PaymentAccessResultDto {
  enrollmentId: string
  billingMonth: string
  hasAccessGrant: boolean
  isAccessBlocked: boolean
}

export async function setEnrollmentPaymentAccess(
  adminId: string,
  enrollmentId: string,
  input: SetPaymentAccessInput,
): Promise<PaymentAccessResultDto> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, batchId: true },
  })
  if (!enrollment) {
    throw notFound('Enrollment not found')
  }
  if (!enrollment.batchId) {
    throw validationError('Payment access overrides apply only to batch enrollments')
  }

  if (input.action === 'grant') {
    await prisma.$transaction([
      prisma.enrollment.update({
        where: { id: enrollmentId },
        data: { isBlocked: false },
      }),
      prisma.monthlyPaymentAccessGrant.upsert({
        where: {
          enrollmentId_billingMonth: {
            enrollmentId,
            billingMonth: input.billingMonth,
          },
        },
        create: {
          enrollmentId,
          billingMonth: input.billingMonth,
          grantedById: adminId,
        },
        update: {
          grantedById: adminId,
          grantedAt: new Date(),
        },
      }),
    ])
  } else {
    await prisma.monthlyPaymentAccessGrant.deleteMany({
      where: { enrollmentId, billingMonth: input.billingMonth },
    })
  }

  const hasAccessGrant = input.action === 'grant'
  const isAccessBlocked = await isEnrollmentPaymentBlocked(enrollmentId, enrollment.batchId)

  return {
    enrollmentId,
    billingMonth: input.billingMonth,
    hasAccessGrant,
    isAccessBlocked,
  }
}
