import { prisma } from '../../config/db.js'
import { MonthlyPaymentStatus } from '../../shared/enums.js'

export const MONTHLY_PAYMENT_DEADLINE_DAY = 20

/** Special billing month key for one-time enrollment fees in MonthlyPayment. */
export const ENROLLMENT_BILLING_MONTH = 'ENROLLMENT'

/** Default first-month / approve fee for live batch enrollment (৳1,020). */
export const DEFAULT_FIRST_MONTH_FEE_MINOR = 102_000

/** Human-facing student ID when none is assigned yet. */
export {
  formatScaStudentId,
  resolveStudentDisplayId,
} from '../../lib/student-id.js'

export function currentBillingMonth(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function paymentDeadlineForBillingMonth(billingMonth: string): Date {
  const [year, month] = billingMonth.split('-')
  return new Date(
    Number(year),
    Number(month) - 1,
    MONTHLY_PAYMENT_DEADLINE_DAY,
    23,
    59,
    59,
    999,
  )
}

export function paymentDeadlineIso(billingMonth: string): string {
  const [year, month] = billingMonth.split('-')
  const date = new Date(Number(year), Number(month) - 1, MONTHLY_PAYMENT_DEADLINE_DAY)
  return date.toISOString()
}

export function isPastPaymentDeadline(now = new Date(), billingMonth?: string): boolean {
  const month = billingMonth ?? currentBillingMonth(now)
  return now.getTime() > paymentDeadlineForBillingMonth(month).getTime()
}

export function isAdminWaiverPayment(
  amountMinor: number,
  priceMinor: number,
  isFullyPaid: boolean,
): boolean {
  return isFullyPaid && priceMinor > 0 && amountMinor < priceMinor
}

/** Fully paid when admin forces it, or cumulative approved payments cover the price. */
export function computeIsFullyPaid(
  priceMinor: number,
  paidSumMinor: number,
  markFullyPaid?: boolean,
): boolean {
  if (markFullyPaid === true) return true
  return priceMinor > 0 && paidSumMinor >= priceMinor
}

/** Remaining amount that can still be collected without exceeding price. */
export function remainingBalanceMinor(priceMinor: number, paidSumMinor: number): number {
  if (priceMinor <= 0) return Number.MAX_SAFE_INTEGER
  return Math.max(0, priceMinor - paidSumMinor)
}

export function paymentHistoryStatusLabel(
  amountMinor: number,
  priceMinor: number,
  isFullyPaid: boolean,
  baseStatus: string,
): string {
  if (isAdminWaiverPayment(amountMinor, priceMinor, isFullyPaid)) {
    return 'FULL_PAID_ADMIN_WAIVER'
  }
  if (isFullyPaid && baseStatus === MonthlyPaymentStatus.APPROVED) {
    return 'FULL_PAID'
  }
  if (isFullyPaid && baseStatus === 'FULL_PAID') {
    return 'FULL_PAID'
  }
  return baseStatus
}

export async function hasApprovedMonthlyPayment(
  enrollmentId: string,
  billingMonth: string,
): Promise<boolean> {
  const row = await prisma.monthlyPayment.findFirst({
    where: {
      enrollmentId,
      billingMonth,
      status: MonthlyPaymentStatus.APPROVED,
    },
    select: { id: true },
  })
  return !!row
}

export async function hasMonthlyPaymentAccessGrant(
  enrollmentId: string,
  billingMonth: string,
): Promise<boolean> {
  const row = await prisma.monthlyPaymentAccessGrant.findUnique({
    where: {
      enrollmentId_billingMonth: { enrollmentId, billingMonth },
    },
    select: { id: true },
  })
  return !!row
}

/** Batch (LIVE) enrollments lose content access after the 20th without an approved monthly payment. */
export async function isEnrollmentPaymentBlocked(
  enrollmentId: string,
  batchId: string | null,
  now = new Date(),
): Promise<boolean> {
  if (!batchId) return false

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      batch: { select: { priceMinor: true } },
      course: { select: { priceMinor: true } },
    },
  })

  // isFullyPaid is on Enrollment after migration 20260704160000; assert the
  // field so editors with a stale Prisma client still type-check.
  const fullyPaidFlag = Boolean(
    (enrollment as { isFullyPaid?: boolean | null } | null)?.isFullyPaid,
  )
  if (fullyPaidFlag) return false

  // Defense in depth: installments may already cover price while the flag is stale.
  if (enrollment) {
    const priceMinor =
      enrollment.batch?.priceMinor ?? enrollment.course?.priceMinor ?? 0
    if (priceMinor > 0) {
      const paidAgg = await prisma.monthlyPayment.aggregate({
        where: {
          enrollmentId,
          status: MonthlyPaymentStatus.APPROVED,
          amountMinor: { not: null },
        },
        _sum: { amountMinor: true },
      })
      const paidSum = paidAgg._sum.amountMinor ?? 0
      if (computeIsFullyPaid(priceMinor, paidSum)) return false
    }
  }

  const billingMonth = currentBillingMonth(now)

  if (enrollment?.billingStartMonth && billingMonth < enrollment.billingStartMonth) {
    return false
  }

  if (!isPastPaymentDeadline(now, billingMonth)) return false

  if (await hasApprovedMonthlyPayment(enrollmentId, billingMonth)) return false
  if (await hasMonthlyPaymentAccessGrant(enrollmentId, billingMonth)) return false

  return true
}
